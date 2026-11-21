import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  dshHomeDir,
  looksLikeDshWeb,
  parseLsofPids,
  parseNetstatListeners,
  pidAlive,
  recordPath,
  writeRecord,
} from "../lib/web-reclaim.js";

test("recordPath 落在 $DSH_HOME/dsh-purge 下，按端口区分", () => {
  const home = path.join(os.tmpdir(), "dsh-home-x");
  assert.equal(recordPath(home, 3080), path.join(home, "dsh-purge", "web-server-3080.json"));
  assert.equal(recordPath(home, 4000), path.join(home, "dsh-purge", "web-server-4000.json"));
});

test("writeRecord 落盘的记录文件即宿主 preflight 的读取契约（1.1.87 起 readRecord/clearRecord 已删）", () => {
  // 1.1.87 把 readRecord / clearRecord 当死代码删掉，记录文件的读侧逻辑整体搬进
  // lib/web-preflight-entry.js（见 lib/web-reclaim.js 里已无这两个导出）。
  // 这里不再测已不存在的导出，而是直接校验 writeRecord 写出的文件格式——
  // 那正是侧车消费的那份契约（pid / port / 额外字段 / at），并用 fs 读回验证覆盖写。
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-rec-"));
  try {
    const fp = writeRecord(home, 3080, 4321, { url: "http://127.0.0.1:3080/?token=x" });
    assert.equal(fp, recordPath(home, 3080), "writeRecord 必须返回记录文件路径");
    const rec = JSON.parse(fs.readFileSync(fp, "utf8"));
    assert.equal(rec.pid, 4321);
    assert.equal(rec.port, 3080);
    assert.equal(rec.url, "http://127.0.0.1:3080/?token=x", "额外字段要落进记录");
    assert.ok(rec.at, "记录必须带 at 时间戳");
    // 同端口再写一次是覆盖而不是追加（侧车按 pid 判活，看到旧 pid 会误杀）。
    writeRecord(home, 3080, 5555);
    assert.equal(JSON.parse(fs.readFileSync(fp, "utf8")).pid, 5555);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("preflight 侧车：坏记录文件不抛，按「没有记录」继续回收", () => {
  // 原 readRecord 的容错口径（坏 JSON → null，不抛）随读侧逻辑一起搬进侧车：
  // 解析整体包在 try/catch 里，失败就 rec = null，绝不让坏文件阻断启动
  // （借鉴 lib/web-preflight-entry.js 的 source contract，侧车有顶层副作用不适合 import）。
  const side = fs.readFileSync(new URL("../lib/web-preflight-entry.js", import.meta.url), "utf8");
  assert.match(side, /try \{\s*\r?\n\s*rec = JSON\.parse\(fs\.readFileSync\(record, "utf8"\)\)/);
  assert.match(side, /catch \{\s*\r?\n\s*rec = null;/);
});

test("dshHomeDir 优先 DSH_HOME，其次 ~/.dsh", () => {
  assert.equal(dshHomeDir({ DSH_HOME: " D:\\dsh-home " }), "D:\\dsh-home");
  assert.equal(dshHomeDir({}), path.join(os.homedir(), ".dsh"));
});

test("looksLikeDshWeb 只认 dsh bin.js + web 子命令", () => {
  const win =
    '"node"   "C:\\Users\\X\\AppData\\Roaming\\npm\\\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" web';
  const posix = "/usr/bin/node /usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js web --port 3080";
  assert.equal(looksLikeDshWeb(win), true);
  assert.equal(looksLikeDshWeb(posix), true);

  // 同机其它 node 进程不能被误杀
  assert.equal(looksLikeDshWeb('"node" "C:\\app\\server.js" web'), false);
  assert.equal(looksLikeDshWeb('"node" "…\\@deepseek-ai\\dsh\\lib\\bin.js" desktop'), false);
  assert.equal(looksLikeDshWeb(""), false);
  assert.equal(looksLikeDshWeb(undefined), false);
});

test("parseNetstatListeners 抽出 LISTENING 行", () => {
  const out = [
    "  TCP    127.0.0.1:3080         0.0.0.0:0              LISTENING       28276",
    "  TCP    127.0.0.1:3080         127.0.0.1:50511        TIME_WAIT       0",
    "  TCP    [::1]:4000             [::]:0                 LISTENING       999",
  ].join("\r\n");
  const rows = parseNetstatListeners(out);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { address: "127.0.0.1", port: 3080, pid: 28276 });
  assert.equal(rows[1].pid, 999);
});

test("parseLsofPids 处理多行/空输出", () => {
  assert.deepEqual(parseLsofPids("1234\n5678\n"), [1234, 5678]);
  assert.deepEqual(parseLsofPids(""), []);
  assert.deepEqual(parseLsofPids("   \n"), []);
});

test("waitGone 已随回收逻辑迁进 preflight 侧车：空列表/已退出 pid 立即返回", () => {
  // waitGone 不再是 lib/web-reclaim.js 的导出，而是 web-preflight-entry.js 里的局部函数
  // （入口脚本有顶层副作用，import 进来会真的执行回收，不能当单测目标）。行为等价拆两半守：
  //   1) 判活口径 pidAlive 仍由本模块导出，对非法/已退出 pid 立刻返回 false；
  //   2) 侧车的等待循环只在还有 alive 的 pid 时自旋，空列表直接 return。
  const t0 = Date.now();
  assert.equal(pidAlive(0), false);
  assert.equal(pidAlive(-1), false);
  assert.equal(pidAlive(999999), false);
  assert.ok(Date.now() - t0 < 1000, "不应为已退出的进程等到超时");
  const side = fs.readFileSync(new URL("../lib/web-preflight-entry.js", import.meta.url), "utf8");
  assert.match(side, /function waitGone\(pids, timeoutMs = 1500\)/);
  assert.match(side, /if \(!pids\.length\) return;/, "空列表必须直接返回，不能空转到超时");
  assert.match(side, /pids\.some\(\(pid\) => alive\(pid\)\)/, "只有还有存活 pid 才继续等");
  assert.match(side, /waitGone\(killedPids\)/, "绑端口前必须等被杀进程真正退出");
});

test("preflight 侧车：记录 pid 只有仍在监听端口时才允许盲杀", () => {
  const side = fs.readFileSync(new URL("../lib/web-preflight-entry.js", import.meta.url), "utf8");
  assert.match(side, /const ownsPort = listeners\.includes\(recPid\)/);
  assert.match(side, /isDshWeb\(cmd\) \|\| \(!cmd && ownsPort\)/);
  assert.match(side, /if \(rec && !recStillAlive\)/);
  assert.match(side, /waitGone\(killedPids\)/);
});
