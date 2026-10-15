/**
 * P2-4 回归：锚点体检脚本不得漏报关键目标丢失。
 *
 * 复现的缺陷（审查报告）：
 *   关键 system-prompt 目标缺失、只保留一个无关目标时，强补丁 #40 的检查结果
 *   仍是 gaps: []，脚本最终输出「无新增缺口」并退出 0。
 * 根因：
 *   - 下载/解压失败被 `catch { continue }` 吞掉（把网络错误当成「该版本没这个包」）；
 *   - only `touched > 0` 才记录缺口 → 完全没有目标时反而不进 gaps。
 *
 * 本测试用**构造的假干净树**驱动真实逻辑（不联网），覆盖：
 *   关键包下载失败 / 关键目标消失 / 正常版本变化 / 正常通过。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const chk = await import(pathToFileURL(path.join(ROOT, "scripts", "check-anchors.mjs")).href);
const core = await import(pathToFileURL(path.join(ROOT, "lib", "core.js")).href);

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log("  PASS  " + name); pass += 1; }
  catch (e) { console.log("  FAIL  " + name + "\n        " + (e?.stack || e)); fail += 1; }
};

console.log("\n=== P2-4 锚点体检不得漏报 ===\n");

// ── 1. tgz 解析器：自带实现必须真能解出文件 ──
t("readTarGz 能解出 npm 包的 package.json（不依赖外部 tar）", () => {
  // 用本机已缓存的官方包做真实样本；没有就跳过（不联网）。
  const cached = path.join(ROOT, ".scratch", "clean", "0.2.1-alpha.3", "dsh-system-prompt", "package", "package.json");
  const tgz = path.join(ROOT, ".scratch", "clean", "0.2.1-alpha.3", "dsh-system-prompt", "pkg.tgz");
  if (!fs.existsSync(tgz)) return;   // 无样本时跳过
  const files = chk.readTarGz(fs.readFileSync(tgz));
  assert.ok(files.length > 0, "应解出文件");
  const hit = files.find((f) => f.path.endsWith("package/package.json"));
  assert.ok(hit, "应包含 package/package.json");
  const parsed = JSON.parse(hit.data.toString("utf8"));
  assert.equal(parsed.name, "@deepseek-ai/dsh-system-prompt");
});

// ── 2. 下载状态区分：absent 与 error 不能混为一谈 ──
t("downloadToFile 对 404 返回 absent（该版本确实没有这个包）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p24-"));
  const dest = path.join(tmp, "x.tgz");
  const r = chk.downloadToFile("https://registry.npmjs.org/@deepseek-ai/pkgnamethatdoesnotexist-xyz", dest);
  // 无网络时会是 error；有网络时必须是 absent。两者都不能是 ok。
  assert.notEqual(r.state, "ok");
  if (r.state === "absent") assert.equal(r.status, 404);
  fs.rmSync(tmp, { recursive: true, force: true });
});

t("downloadToFile 对不可达主机返回 error（不是 absent）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p24-"));
  const dest = path.join(tmp, "x.tgz");
  const r = chk.downloadToFile("https://registry.npmjs.invalid/@deepseek-ai/dsh", dest);
  assert.equal(r.state, "error", "网络失败必须是 error，不能被当成该版本没有");
  assert.ok(r.error, "应带错误原因");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── 3. 关键包下载失败 → 退出码 3，且绝不输出「无新增缺口」──
const fakeFetch = (version, errors = []) => ({
  version, ai: `/fake/${version}/ai`, packages: `/fake/${version}/packages`,
  fetch: errors.map((e) => ({ pkg: e.pkg, state: "error", error: e.error })),
  errors,
});
const fakeRes = (gaps = [], resolved = 50, keyUsage = []) => ({ gaps, resolved, keyState: new Map(), keyUsage });

t("关键包下载失败 → exitCode=3 且结论说明数据不完整（不得输出通过）", () => {
  const out = chk.evaluate({
    versionA: "0.2.0-rc.2", versionB: "0.2.1-alpha.3",
    fetchA: fakeFetch("0.2.0-rc.2"),
    fetchB: fakeFetch("0.2.1-alpha.3", [{ pkg: "dsh-system-prompt", state: "error", error: "curl: (35) SSL connect error" }]),
    resA: fakeRes(), resB: fakeRes(),
    coverage: { gone: [], partial: [], never: [] },
  });
  assert.equal(out.exitCode, 3, `数据不完整必须退出 3，实际 ${out.exitCode}`);
  const text = out.lines.join("\n");
  assert.match(text, /数据不完整/, "要明确说明数据不完整");
  assert.doesNotMatch(text, /无新增锚点缺口/, "绝不能输出「无新增缺口」");
});

t("关键目标消失 → exitCode=3，不能因为还剩别的文件就判通过", () => {
  const base = (version, usage) => ({ ...fakeRes([], 3, usage) });
  const usageA = [{ id: 40, name: "COMPLETE_PROMPT_KEEP_INJECT", optional: false, keys: ["system-prompt"], resolvedKeys: ["system-prompt"], touched: 1 }];
  // 新版本里 system-prompt 解析不到（只剩一个无关 key 解析到了）
  const usageB = [{ id: 40, name: "COMPLETE_PROMPT_KEEP_INJECT", optional: false, keys: ["system-prompt"], resolvedKeys: [], touched: 0 }];
  const coverage = chk.compareCoverage(base("a", usageA), base("b", usageB));
  assert.equal(coverage.gone.length, 1, "应检出目标完全消失");

  const out = chk.evaluate({
    versionA: "0.2.0-rc.2", versionB: "0.2.1-alpha.3",
    fetchA: fakeFetch("0.2.0-rc.2"), fetchB: fakeFetch("0.2.1-alpha.3"),
    resA: base("a", usageA), resB: base("b", usageB),
    coverage,
  });
  assert.equal(out.exitCode, 3, `目标消失必须退出 3，实际 ${out.exitCode}`);
  const text = out.lines.join("\n");
  assert.match(text, /必要目标完全消失/);
  assert.doesNotMatch(text, /无新增锚点缺口/);
});

t("compareCoverage：optional 补丁的目标缺失不算必要目标消失", () => {
  const usageA = [{ id: 28, name: "LIANGSHEN_PHASE1_KEEP_INJECT", optional: true, keys: ["liangshen-tool-bootstrap"], resolvedKeys: ["liangshen-tool-bootstrap"], touched: 1 }];
  const usageB = [{ id: 28, name: "LIANGSHEN_PHASE1_KEEP_INJECT", optional: true, keys: ["liangshen-tool-bootstrap"], resolvedKeys: [], touched: 0 }];
  const coverage = chk.compareCoverage(fakeRes([], 3, usageA), fakeRes([], 3, usageB));
  assert.equal(coverage.gone.length, 0, "可选包未装是正常情况，不该判为必要目标消失");
});

// ── 4. 正常版本变化 / 正常通过 ──
t("正常版本变化（有新增缺口）→ exitCode=1（强锚点）", () => {
  const out = chk.evaluate({
    versionA: "a", versionB: "b",
    fetchA: fakeFetch("a"), fetchB: fakeFetch("b"),
    resA: fakeRes([], 50, []),
    resB: fakeRes([{ id: 99, name: "NEW_DRIFT", optional: false }], 50, [{ id: 99, optional: false, resolvedKeys: ["x"], touched: 1 }]),
    coverage: { gone: [], partial: [], never: [] },
  });
  assert.equal(out.exitCode, 1);
  assert.match(out.lines.join("\n"), /强锚点/);
});

t("正常版本变化（仅软补丁缺口）→ exitCode=0 但仍列出缺口", () => {
  const out = chk.evaluate({
    versionA: "a", versionB: "b",
    fetchA: fakeFetch("a"), fetchB: fakeFetch("b"),
    resA: fakeRes(), resB: fakeRes([{ id: 80, name: "MINIMAL_OFFICIAL_TOOLSET", optional: true }]),
    coverage: { gone: [], partial: [], never: [] },
  });
  assert.equal(out.exitCode, 0, "软补丁缺口不该卡 CI");
  assert.match(out.lines.join("\n"), /软补丁/);
});

t("数据完整、无新增缺口 → exitCode=0 且结论明确说数据完整", () => {
  const out = chk.evaluate({
    versionA: "a", versionB: "b",
    fetchA: fakeFetch("a"), fetchB: fakeFetch("b"),
    resA: fakeRes(), resB: fakeRes(),
    coverage: { gone: [], partial: [], never: [] },
  });
  assert.equal(out.exitCode, 0);
  assert.match(out.lines.join("\n"), /数据完整/);
});

// ── 5. 跨平台：不得硬编码 curl.exe ──
t("脚本不硬编码 curl.exe（Linux/macOS 可运行）", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "check-anchors.mjs"), "utf8");
  assert.doesNotMatch(src, /curl\.exe/, "不应硬编码 curl.exe");
  assert.doesNotMatch(src, /execFileSync\("tar"/, "不应依赖外部 tar（自带 tgz 解析）");
  assert.match(src, /execFileSync\("curl"/, "应回退到 POSIX 的 curl");
  assert.match(src, /"wget"/, "应有 wget 兜底");
});

// ── 6. 真实运行不崩（有网络则真跑，无网络则只验证不抛未捕获异常）──
t("脚本可被 import 且导出纯函数（便于测试，不自动执行主流程）", () => {
  for (const fn of ["readTarGz", "downloadToFile", "fetchVersion", "gapsFor", "compareCoverage", "evaluate", "latestVersion", "lowerBoundOfTarget"]) {
    assert.equal(typeof chk[fn], "function", `应导出 ${fn}`);
  }
});

t("gapsFor 在空树上返回空 gaps 且 resolved=0（不抛异常）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p24-empty-"));
  fs.mkdirSync(path.join(tmp, "ai"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "packages"), { recursive: true });
  const r = chk.gapsFor({ version: "t", ai: path.join(tmp, "ai"), packages: path.join(tmp, "packages"), fetch: [], errors: [] }, core);
  assert.equal(r.resolved, 0);
  assert.equal(r.gaps.length, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`\nP2-4 结果: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
