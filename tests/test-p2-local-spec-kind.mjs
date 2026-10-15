/**
 * P2-3 回归：`file:` 压缩包不得被当成源码目录。
 *
 * 旧代码：所有 `file:` / `link:` / 相对路径一律进入目录分支，更新时往
 * `<路径>/lib` 复制。当 spec 是 `file:/x/plugin.tar.gz` 时目标变成
 * `/x/plugin.tar.gz/lib` → ENOTDIR，更新失败且错误信息不知所云。
 *
 * 新实现：用 fs.statSync 判定真实类型（目录 / 归档 / 普通文件 / 不存在 / 无法判定），
 * 归档型 install 目标改为 profile 里已安装的插件目录，类型不合法则明确报错、不写入。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const upd = await import(pathToFileURL(path.join(ROOT, "lib", "update.js")).href);

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log("  PASS  " + name); pass += 1; }
  catch (e) { console.log("  FAIL  " + name + "\n        " + (e?.stack || e)); fail += 1; }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-p23-"));
const profileDir = path.join(tmp, "profiles", "web");
fs.mkdirSync(profileDir, { recursive: true });

// 造各种真实对象
const dirTarget = path.join(tmp, "src-plugin");
fs.mkdirSync(path.join(dirTarget, "lib"), { recursive: true });
fs.writeFileSync(path.join(dirTarget, "package.json"), JSON.stringify({ name: "dsh-purge", version: "1.0.0" }));

const tgzFile = path.join(tmp, "plugin.tgz");
fs.writeFileSync(tgzFile, "not really a tgz");
const tarGzFile = path.join(tmp, "plugin.tar.gz");
fs.writeFileSync(tarGzFile, "not really a tar.gz");
const zipFile = path.join(tmp, "plugin.zip");
fs.writeFileSync(zipFile, "not really a zip");
const plainFile = path.join(tmp, "notes.txt");
fs.writeFileSync(plainFile, "hello");

const dirLink = path.join(tmp, "linked-plugin");
fs.mkdirSync(dirLink, { recursive: true });

console.log("\n=== P2-3 本地依赖类型判定 ===\n");

t("isLinkSpec 仍正确识别本地路径型 spec（含 file:/link:/相对路径）", () => {
  for (const s of ["file:../x", "link:../x", "file:/abs/x", ".", "..", "./x", "../x", "file:x"]) {
    assert.equal(upd.isLinkSpec(s), true, `${s} 应判为本地路径`);
  }
  for (const s of ["dsh-purge", "https://github.com/a/b", "1.2.3", "@scope/pkg"]) {
    assert.equal(upd.isLinkSpec(s), false, `${s} 不应判为本地路径`);
  }
});

t("目录 → kind=dir", () => {
  const r = upd.localSpecKind(profileDir, `file:${dirTarget}`);
  assert.equal(r.kind, "dir");
  assert.equal(path.normalize(r.path), path.normalize(dirTarget));
});

t("相对路径 file: 目录 → kind=dir（按 profileDir 展开）", () => {
  const rel = path.relative(profileDir, dirTarget);
  const r = upd.localSpecKind(profileDir, `file:${rel}`);
  assert.equal(r.kind, "dir");
  assert.equal(path.normalize(r.path), path.normalize(dirTarget));
});

t("link: 目录 → kind=dir", () => {
  const r = upd.localSpecKind(profileDir, `link:${dirLink}`);
  assert.equal(r.kind, "dir");
});

t(".tgz 文件 → kind=archive（旧代码会把它当目录）", () => {
  const r = upd.localSpecKind(profileDir, `file:${tgzFile}`);
  assert.equal(r.kind, "archive", "tgz 必须是归档，不能被当目录");
});

t(".tar.gz 文件 → kind=archive", () => {
  assert.equal(upd.localSpecKind(profileDir, `file:${tarGzFile}`).kind, "archive");
});

t(".zip 文件 → kind=archive", () => {
  assert.equal(upd.localSpecKind(profileDir, `file:${zipFile}`).kind, "archive");
});

t("普通非归档文件 → kind=file（明确拒绝，不当作目录）", () => {
  const r = upd.localSpecKind(profileDir, `file:${plainFile}`);
  assert.equal(r.kind, "file");
});

t("不存在的路径 → kind=missing（不带归档扩展名）", () => {
  const r = upd.localSpecKind(profileDir, `file:${path.join(tmp, "nope")}`);
  assert.equal(r.kind, "missing");
});

t("不存在的 .tgz 路径 → kind=archive（仅在缺失时用扩展名兜底）", () => {
  const r = upd.localSpecKind(profileDir, `file:${path.join(tmp, "nope.tgz")}`);
  assert.equal(r.kind, "archive");
});

t("Windows 绝对路径也能解析（不因平台差异误判）", () => {
  // 在 POSIX 上传 Windows 风格路径只验证「不抛异常」；在 Windows 上则要求 kind=dir
  const winPath = process.platform === "win32" ? dirTarget : "C:\\some\\dir";
  const r = upd.localSpecKind(profileDir, `file:${winPath}`);
  assert.ok(["dir", "missing", "unknown", "file"].includes(r.kind), `不应抛异常，实际 ${r.kind}`);
  if (process.platform === "win32") assert.equal(r.kind, "dir");
});

t("大写扩展名也识别为归档（Windows 上常见）", () => {
  const upper = path.join(tmp, "plugin.TGZ");
  fs.writeFileSync(upper, "x");
  assert.equal(upd.localSpecKind(profileDir, `file:${upper}`).kind, "archive");
});

t("符号链接指向目录时按目录处理", () => {
  const linkPath = path.join(tmp, "symlink-dir");
  try {
    fs.symlinkSync(dirTarget, linkPath, "junction");
  } catch {
    return; // 无权限建符号链接就跳过（Windows 非管理员常见）
  }
  const r = upd.localSpecKind(profileDir, `file:${linkPath}`);
  assert.equal(r.kind, "dir", "statSync 跟随符号链接，应判为目录");
});

console.log(`\nP2-3 结果: ${pass} passed, ${fail} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
