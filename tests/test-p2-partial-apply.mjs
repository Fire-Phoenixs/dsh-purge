/**
 * P2-1 回归：部分文件写入失败不得被汇总为「应用成功」。
 *
 * 旧逻辑：rollupPatchStatus 先判 `applied > 0` 就 return "applied"，lastError 永不可达。
 * 于是「目标 A 写成功、目标 B 写失败（EACCES）」被汇总成 applied，
 * 界面显示完全成功、还会照常安排重启，用户不知道有一半补丁没打上。
 *
 * 本测试直接驱动 applyPatches()，用真实文件 + 目录权限制造 EACCES，
 * 覆盖：一份成功一份失败 / 读取失败 / 全部成功 / 全部已应用 / 可选包未装的正常跳过。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const core = await import(pathToFileURL(path.join(ROOT, "lib", "core.js")).href);

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log("  PASS  " + name); pass += 1; }
  catch (e) { console.log("  FAIL  " + name + "\n        " + (e?.stack || e)); fail += 1; }
};

console.log("\n=== P2-1 部分失败不得判成功 ===\n");

// 直接测汇总函数：这是缺陷所在的那一层，可精确构造各种计数组合。
const rollup = (over) => core.__testRollupPatchStatus({
  applied: 0, already: 0, missing: 0, notFound: 0,
  lastError: null, keyCount: 1, layoutSoft: false, strictFiles: false, failures: [],
  ...over,
});

await t("一份成功 + 一份写失败(EACCES) → partially_applied，不是 applied", () => {
  const st = rollup({
    applied: 1, keyCount: 2,
    lastError: "write_error:EACCES: permission denied",
    failures: [{ path: "/x/b.js", kind: "write_error", error: "EACCES: permission denied" }],
  });
  assert.equal(st, "partially_applied", `期待 partially_applied，实际 ${st}`);
});

await t("一份成功 + 一份锚点未命中 → 也是部分成功（严格补丁）", () => {
  const st = rollup({
    applied: 1, notFound: 1, keyCount: 2,
    failures: [{ path: "/x/b.js", kind: "pattern_not_found", error: "" }],
  });
  assert.equal(st, "partially_applied");
});

await t("layoutSoft 补丁部分未命中仍算 applied（不误伤既有软补丁语义）", () => {
  const st = rollup({ applied: 1, notFound: 1, keyCount: 2, layoutSoft: true, failures: [] });
  assert.equal(st, "applied");
});

await t("全部成功 → applied", () => {
  assert.equal(rollup({ applied: 2, keyCount: 2 }), "applied");
});

await t("全部已应用 → already", () => {
  assert.equal(rollup({ already: 2, keyCount: 2 }), "already");
});

await t("读取失败（无成功）→ read_error", () => {
  const st = rollup({ lastError: "read_error", failures: [{ path: "/x/a.js", kind: "read_error", error: "EACCES" }] });
  assert.equal(st, "read_error");
});

await t("strictFiles 下写入失败 → 返回错误而非 applied", () => {
  const st = rollup({
    applied: 1, keyCount: 2, strictFiles: true,
    lastError: "write_error:EACCES",
    failures: [{ path: "/x/b.js", kind: "write_error", error: "EACCES" }],
  });
  assert.notEqual(st, "applied");
  assert.match(String(st), /EACCES/);
});

await t("目标文件全不存在 → missing_file（正常跳过语义保留）", () => {
  assert.equal(rollup({ missing: 2, keyCount: 2 }), "missing_file");
});

await t("原文对不上且非严格 → skipped（正常跳过语义保留）", () => {
  assert.equal(rollup({ notFound: 1, keyCount: 1 }), "pattern_not_found");
  assert.equal(rollup({ notFound: 0, keyCount: 1 }), "skipped");
});

await t("部分成功在 summarizeApplyReport 里单列 partial 且计入 failed", () => {
  const report = [
    { patch_id: 1, status: "applied" },
    { patch_id: 2, status: "partially_applied", failures: [{ path: "/x/b.js", kind: "write_error", error: "EACCES" }] },
    { patch_id: 3, status: "skipped" },
  ];
  const s = core.summarizeApplyReport(report);
  assert.equal(s.partial.length, 1, "应单列 partial");
  assert.equal(s.failed.length, 1, "partial 必须计入 failed（否则 complete 会误判为真）");
  assert.equal(s.applied, 1);
  const detail = core.partialFailureDetail(s.partial[0]);
  assert.match(detail, /EACCES/, "失败明细要能定位到具体文件");
  assert.match(detail, /b\.js/);
});

await t("isPatchResultSoftOk 不把 partial 当成功（否则界面会显示成功）", () => {
  const row = { patch_id: 2, status: "partially_applied" };
  assert.equal(core.isPatchResultSoftOk(row), false);
  // 对照：这些仍按成功处理，语义没被扩大化
  assert.equal(core.isPatchResultSoftOk({ status: "applied" }), true);
  assert.equal(core.isPatchResultSoftOk({ status: "already" }), true);
  assert.equal(core.isPatchResultSoftOk({ status: "skipped" }), true);
  assert.equal(core.isPatchResultSoftOk({ status: "na" }), true);
  assert.equal(core.isPatchResultSoftOk({ status: "missing_file" }), true);
});

// —— 端到端：真实 applyPatches 上制造「一份成功一份失败」——
// 用 filesOverride 把补丁目标指到受控文件（走的是生产代码同一条路径），
// 把第二个目标设成**只读目录下的文件**以制造真实写入失败。
await t("端到端：applyPatches 遇到一份写失败时汇总为 partially_applied", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-p21-"));
  const dirA = path.join(tmp, "a");
  const dirB = path.join(tmp, "b");
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });
  const fileA = path.join(dirA, "index.js");
  const fileB = path.join(dirB, "index.js");
  const NEEDLE = "const MARKER_NEEDLE = \"ORIGINAL\";";
  fs.writeFileSync(fileA, NEEDLE + "\n");
  fs.writeFileSync(fileB, NEEDLE + "\n");

  // saveText 走 atomicWriteFile：在同目录建临时文件再 rename。
  // 把 b 目录设为只读 → 建临时文件失败 → write_error。Windows 上目录只读位不拦，
  // 因此改用「把目标换成目录」这种跨平台同样失败的手段。
  let blocked = fileB;
  if (process.platform === "win32") {
    fs.rmSync(fileB);
    fs.mkdirSync(fileB);              // 目标变成目录：读会 EISDIR、写会失败
  } else {
    fs.chmodSync(dirB, 0o500);        // 只读目录
  }

  const patch = {
    id: 99900,
    name: "TEST_PARTIAL_WRITE",
    file: ["t-a", "t-b"],
    replacements: [{ pattern: NEEDLE, replace: "const MARKER_NEEDLE = \"PATCHED\";" }],
  };
  const report = await core.applyPatches("/nonexistent-ai-base", [patch], {
    filesOverride: { "t-a": fileA, "t-b": blocked },
  });

  const row = report.find((r) => r.patch_id === 99900);
  assert.ok(row, "应有该补丁的结果行");
  assert.notEqual(row.status, "applied", `一份成功一份失败不得判 applied（实际 ${row.status}）`);
  assert.ok(row.applied <= 1, "最多只有一份真正写成功");

  if (process.platform !== "win32") fs.chmodSync(dirB, 0o700);
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`\nP2-1 结果: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
