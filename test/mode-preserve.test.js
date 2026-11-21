import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeHostFileAtomic } from "../lib/hide-console.js";
import { atomicCopyFile, atomicCopyFileSync, backupAll, revertAll, targetFiles } from "../lib/core.js";

const isPosix = process.platform !== "win32";
const TMP = () => fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-mode-"));

test("writeHostFileAtomic 继承原文件权限（Linux 启动器丢 +x 的回归）", () => {
  if (!isPosix) return;
  const dir = TMP();
  const fp = path.join(dir, "bin.js");
  fs.writeFileSync(fp, "#!/usr/bin/env node\nconsole.log(1);\n");
  fs.chmodSync(fp, 0o755);
  writeHostFileAtomic(fs, fp, "#!/usr/bin/env node\nconsole.log(2);\n");
  assert.equal(fs.statSync(fp).mode & 0o777, 0o755);
  assert.match(fs.readFileSync(fp, "utf8"), /console\.log\(2\)/);
});

test("atomicCopyFile / atomicCopyFileSync 保留权限位", async () => {
  if (!isPosix) return;
  const dir = TMP();
  const src = path.join(dir, "a.sh");
  fs.writeFileSync(src, "#!/bin/sh\necho hi\n");
  fs.chmodSync(src, 0o750);
  const dst1 = path.join(dir, "b.sh");
  await atomicCopyFile(src, dst1);
  assert.equal(fs.statSync(dst1).mode & 0o777, 0o750);
  const dst2 = path.join(dir, "c.sh");
  atomicCopyFileSync(src, dst2);
  assert.equal(fs.statSync(dst2).mode & 0o777, 0o750);
});

test("备份与还原都不改变宿主文件权限", async () => {
  if (!isPosix) return;
  const root = TMP();
  const ai = path.join(root, "ai");
  const dir = path.join(ai, "dsh-agent-instructions", "lib");
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, "index.js");
  fs.writeFileSync(fp, 'export const WORKSPACE_CONTEXT_INTRO = "raw";\n');
  fs.chmodSync(fp, 0o755);
  const before = fs.statSync(fp).mode & 0o777;

  await backupAll(ai);
  const bak = fp + ".dshpurge.bak";
  assert.ok(fs.existsSync(bak));
  assert.equal(fs.statSync(bak).mode & 0o777, before, "备份必须继承原文件权限");

  // 模拟补丁写入（走 atomicWrite 等价路径）后还原
  fs.writeFileSync(fp, 'export const WORKSPACE_CONTEXT_INTRO = "raw"; // [dsh-purge]\n');
  fs.chmodSync(fp, 0o755);
  await revertAll(ai);
  assert.equal(fs.readFileSync(fp, "utf8"), 'export const WORKSPACE_CONTEXT_INTRO = "raw";\n');
  assert.equal(fs.statSync(fp).mode & 0o777, before, "还原后权限必须回到原值");
  assert.ok(targetFiles(ai));
});
