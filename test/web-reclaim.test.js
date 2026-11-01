import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearRecord,
  dshHomeDir,
  looksLikeDshWeb,
  parseLsofPids,
  parseNetstatListeners,
  readRecord,
  recordPath,
  waitGone,
  writeRecord,
} from "../lib/web-reclaim.js";

test("recordPath 落在 $DSH_HOME/dsh-purge 下，按端口区分", () => {
  const home = path.join(os.tmpdir(), "dsh-home-x");
  assert.equal(recordPath(home, 3080), path.join(home, "dsh-purge", "web-server-3080.json"));
  assert.equal(recordPath(home, 4000), path.join(home, "dsh-purge", "web-server-4000.json"));
});

test("write/read/clear 记录往返", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-rec-"));
  try {
    writeRecord(home, 3080, 4321, { url: "http://127.0.0.1:3080/?token=x" });
    const rec = readRecord(home, 3080);
    assert.equal(rec.pid, 4321);
    assert.equal(rec.port, 3080);
    assert.ok(rec.at);
    assert.ok(clearRecord(home, 3080));
    assert.equal(readRecord(home, 3080), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("readRecord 对坏文件返回 null 而不抛", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-bad-"));
  try {
    fs.mkdirSync(path.join(home, "dsh-purge"), { recursive: true });
    fs.writeFileSync(path.join(home, "dsh-purge", "web-server-3080.json"), "{not json", "utf8");
    assert.equal(readRecord(home, 3080), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
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

test("waitGone 对空列表/已退出 pid 立即返回", () => {
  const t0 = Date.now();
  waitGone([]);
  waitGone([0, -1, 999999]);
  assert.ok(Date.now() - t0 < 1000, "不应为已退出的进程等到超时");
});

test("preflight 侧车：记录 pid 只有仍在监听端口时才允许盲杀", () => {
  const side = fs.readFileSync(new URL("../lib/web-preflight-entry.js", import.meta.url), "utf8");
  assert.match(side, /const ownsPort = listeners\.includes\(recPid\)/);
  assert.match(side, /isDshWeb\(cmd\) \|\| \(!cmd && ownsPort\)/);
  assert.match(side, /if \(rec && !recStillAlive\)/);
  assert.match(side, /waitGone\(killedPids\)/);
});
