// [dsh-purge] web preflight — 由 lib/bin-preflight.js 复制到宿主 lib 并 import 到 bin.js 顶部。
//
// 目的：dsh-purge 的「应用 → 自动重启」用 detached 子进程接管 server，父进程随即退出，
// 关窗/关终端都杀不到那个子进程；下一次 `dsh web` 会在 webserver 插件绑端口时撞
// EADDRINUSE，而 0.2.x 把 required 插件激活失败当 fatal，宿主直接起不来（issue #197）。
//
// 这里在 Cordis 激活之前做一次回收：先查 $DSH_HOME/dsh-purge/web-server-<port>.json，
// 记录失效时再按端口兜底；只杀命令行命中 `@deepseek-ai/dsh/lib/bin.js … web` 的进程。
// 只处理 `dsh web`，其它子命令零开销。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DSH_BIN = /@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js/;
const WEB_ARG = /(^|[\s"'])web([\s"']|$)/;

function run(file, args) {
  try {
    const r = spawnSync(file, args, { encoding: "utf8", windowsHide: true, timeout: 8000 });
    return r && r.status === 0 ? String(r.stdout || "") : "";
  } catch {
    return "";
  }
}

function cmdlineOf(pid) {
  if (process.platform === "win32") {
    return run("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue).CommandLine`,
    ]).trim();
  }
  return run("ps", ["-p", String(pid), "-o", "command="]).trim();
}

function isDshWeb(cmd) {
  return DSH_BIN.test(cmd) && WEB_ARG.test(cmd);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function kill(pid) {
  if (!pid || pid === process.pid) return false;
  if (process.platform === "win32") {
    const r = spawnSync("taskkill", ["/PID", String(pid), "/F"], { windowsHide: true, stdio: "ignore" });
    return !r.error && r.status === 0;
  }
  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

function listeningPids(port) {
  if (process.platform === "win32") {
    const out = run("netstat", ["-ano"]);
    const pids = [];
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (m && Number(m[2]) === port) pids.push(Number(m[3]));
    }
    return [...new Set(pids)];
  }
  const out = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  return [...new Set(out.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

function main() {
  if (!process.argv.slice(2).some((a) => a === "web")) return;
  const i = process.argv.indexOf("--port");
  const port = Number(i > -1 ? process.argv[i + 1] : process.env.PORT) || 3080;
  const home = String(process.env.DSH_HOME || "").trim() || path.join(os.homedir(), ".dsh");
  const record = path.join(home, "dsh-purge", `web-server-${port}.json`);

  try {
    let killed = 0;
    const killedPids = [];
    let rec = null;
    try {
      rec = JSON.parse(fs.readFileSync(record, "utf8"));
    } catch {
      rec = null;
    }
    const listeners = listeningPids(port);
    const recPid = Number(rec && rec.pid) || 0;
    let recStillAlive = false;
    if (recPid && alive(recPid)) {
      const cmd = cmdlineOf(recPid);
      // 命令行拿不到时，必须证明这个 pid 仍占着端口才杀：记录可能早于进程退出，
      // pid 被系统复用后盲目 taskkill 会杀掉无关进程。
      const ownsPort = listeners.includes(recPid);
      if (isDshWeb(cmd) || (!cmd && ownsPort)) {
        if (kill(recPid)) {
          killed += 1;
          killedPids.push(recPid);
        }
      }
      recStillAlive = alive(recPid);
    }
    // 杀不掉就留着记录，下一次启动再试；只有确认进程已经不在才清记录。
    if (rec && !recStillAlive) {
      try {
        fs.unlinkSync(record);
      } catch {
        /* ignore */
      }
    }

    if (!killed) {
      for (const pid of listeners) {
        if (pid === process.pid) continue;
        if (!isDshWeb(cmdlineOf(pid))) continue;
        if (kill(pid)) {
          killed += 1;
          killedPids.push(pid);
        }
      }
    }

    // taskkill 返回不代表端口已经释放。等被杀进程真正退出再让 Cordis 绑端口，
    // 否则还是会撞 EADDRINUSE。
    waitGone(killedPids);

    if (killed) {
      process.stderr.write(`[dsh-purge] reclaimed stale dsh web on :${port}, retrying boot\n`);
    }
  } catch {
    /* 回收失败不阻断启动 */
  }
}

function waitGone(pids, timeoutMs = 1500) {
  if (!pids.length) return;
  const deadline = Date.now() + timeoutMs;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline && pids.some((pid) => alive(pid))) {
    try {
      Atomics.wait(sleeper, 0, 0, 80);
    } catch {
      break;
    }
  }
}

main();
