#!/usr/bin/env node
/**
 * 跑全部回归测试 / run every regression suite.
 *
 * 用法：
 *   node scripts/run-tests.mjs            # 全部
 *   node scripts/run-tests.mjs p1 p2-1    # 只跑名字里含这些片段的套件
 *
 * 套件在 tests/（scripts/ 下被 .gitignore 的本地草稿规则覆盖）。
 * 离线友好：不联网的套件总会跑；需要网络的（P2-4 的下载断言、锚点体检）在无代理
 * 环境下会自行降级为「不可达即 error」，不会让整套挂掉。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TESTS = path.join(ROOT, "tests");
const filters = process.argv.slice(2).map((s) => s.toLowerCase());

if (!fs.existsSync(TESTS)) {
  console.error(`找不到测试目录: ${TESTS}`);
  process.exit(2);
}

const suites = fs.readdirSync(TESTS)
  .filter((f) => /^test-.*\.mjs$/.test(f))
  .sort()
  .filter((f) => !filters.length || filters.some((x) => f.toLowerCase().includes(x)));

if (!suites.length) {
  console.error("没有匹配的测试套件。");
  process.exit(2);
}

let passed = 0, failed = 0;
const failures = [];
for (const suite of suites) {
  const file = path.join(TESTS, suite);
  const res = spawnSync(process.execPath, [file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const out = `${res.stdout || ""}${res.stderr || ""}`;
  const summary = out.split(/\r?\n/).filter((l) => l.includes("结果:")).pop() || "(无结果行)";
  const ok = res.status === 0;
  if (ok) passed += 1; else { failed += 1; failures.push({ suite, out }); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${suite.padEnd(34)} ${summary.trim()}`);
}

if (failures.length) {
  console.log("\n============ 失败详情 ============");
  for (const f of failures) {
    console.log(`\n--- ${f.suite} ---`);
    console.log(f.out.trim());
  }
}

console.log(`\n套件合计: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
