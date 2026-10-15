/**
 * P2-2 回归：更新文件清单必须覆盖随包资源，且不碰用户数据。
 *
 * 旧 COPY_NAMES 缺 presets/ skills/ scripts/，会出现「package.json 已更新、
 * 预设与技能仍是旧版」的混合安装：后端读到的 preset 结构与技能文件版本对不上。
 *
 * 本测试校验：
 *   1. COPY_NAMES 覆盖 package.json files 白名单里的随包目录；
 *   2. 用户数据名不在 COPY_NAMES 里；
 *   3. 关键文件判定集合是 COPY_NAMES 的子集；
 *   4. 用真实仓库快照验证「更新后各组成部分来自同一版本」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const upd = await import(pathToFileURL(path.join(ROOT, "lib", "update.js")).href);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log("  PASS  " + name); pass += 1; }
  catch (e) { console.log("  FAIL  " + name + "\n        " + (e?.stack || e)); fail += 1; }
};

// 通过测试钩子读到内部常量（stagedSwapOne 用到它们）。
const hooks = upd.__testHooks;
assert.ok(hooks, "需要 __testHooks");

console.log("\n=== P2-2 更新清单一致性 ===\n");

// 从 lib/update.js 源码里读出 COPY_NAMES（模块私有，不导出）。
const src = fs.readFileSync(path.join(ROOT, "lib", "update.js"), "utf8");
function listLiteral(name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m"));
  if (!m) throw new Error(`找不到 ${name}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}
const COPY_NAMES = listLiteral("COPY_NAMES");
const CRITICAL = listLiteral("UPDATE_CRITICAL_FILES");
const USER_DATA = listLiteral("USER_DATA_NAMES");

await t("COPY_NAMES 包含全部随包目录（lib/bin/docs/presets/skills/scripts）", () => {
  for (const need of ["lib", "bin", "docs", "presets", "skills", "scripts"]) {
    assert.ok(COPY_NAMES.includes(need), `清单缺 ${need}（这正是旧版的缺陷）`);
  }
});

await t("package.json files 白名单里的每个顶层资源都在 COPY_NAMES 里（两边一致）", () => {
  const whitelist = (pkg.files || []).filter((f) => !f.startsWith("!"));
  const missing = whitelist.filter((f) => {
    // files 里可能写通配/子路径；只校验顶层名字
    const top = f.split("/")[0];
    return !COPY_NAMES.includes(top);
  });
  assert.deepEqual(missing, [], `files 白名单里这些不在更新清单中：${missing.join(", ")}`);
});

await t("COPY_NAMES 里没有开发用文件（.npmignore/.gitignore/.github）", () => {
  for (const bad of [".npmignore", ".gitignore", ".github", ".scratch"]) {
    assert.ok(!COPY_NAMES.includes(bad), `不该把 ${bad} 装进用户目录`);
  }
});

await t("用户数据名不在 COPY_NAMES 里（不会覆盖用户内容）", () => {
  for (const u of USER_DATA) {
    assert.ok(!COPY_NAMES.includes(u), `${u} 是用户数据，不该随包覆盖`);
  }
  // 边界必须显式声明，避免以后有人顺手加进清单
  for (const need of ["prompt-inject.md", "redteam", ".agent-presets"]) {
    assert.ok(USER_DATA.includes(need), `USER_DATA_NAMES 应声明 ${need}`);
  }
});

await t("关键文件集合的顶层名都在 COPY_NAMES 里（校验不会要求清单外的资源）", () => {
  // 关键文件可能是子路径（lib/index.js），比对的是它的顶层名（lib）。
  for (const c of CRITICAL) {
    const top = c.split("/")[0];
    assert.ok(COPY_NAMES.includes(top), `关键文件 ${c} 的顶层 ${top} 不在 COPY_NAMES 里，校验会永远失败`);
  }
  for (const need of ["package.json", "lib/index.js", "client.js", "cordis.patch.yml"]) {
    assert.ok(CRITICAL.includes(need), `关键文件应包含 ${need}`);
  }
});

await t("关键文件在真实仓库里都存在（校验不会因缺文件而误拒）", () => {
  for (const c of CRITICAL) {
    assert.ok(fs.existsSync(path.join(ROOT, c)), `仓库里应存在关键文件 ${c}`);
  }
});

await t("真实快照：更新后版本号、后端、客户端、预设、技能来自同一版本", async () => {
  // 用仓库当前内容当「新版包」，切到一个旧版占位目录，验证各部分都更新。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-p22-"));
  const dest = path.join(tmp, "installed");
  fs.mkdirSync(path.join(dest, "lib"), { recursive: true });
  fs.mkdirSync(path.join(dest, "presets", "redteam"), { recursive: true });
  fs.mkdirSync(path.join(dest, "skills", "redteam"), { recursive: true });
  fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "dsh-purge", version: "0.0.1" }));
  fs.writeFileSync(path.join(dest, "lib", "index.js"), "// OLD\n");
  fs.writeFileSync(path.join(dest, "client.js"), "// OLD client\n");
  fs.writeFileSync(path.join(dest, "cordis.patch.yml"), "# OLD\n");
  fs.writeFileSync(path.join(dest, "presets", "redteam", "old.yml"), "# OLD preset\n");
  fs.writeFileSync(path.join(dest, "skills", "redteam", "old.md"), "# OLD skill\n");

  const rec = await hooks.stagedSwapOne(dest, ROOT, "p22test");

  // 1) 版本号来自新版
  const v = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8")).version;
  assert.equal(v, pkg.version, "package.json 应是新版");
  // 2) 后端代码来自新版
  assert.equal(
    fs.readFileSync(path.join(dest, "lib", "core.js"), "utf8"),
    fs.readFileSync(path.join(ROOT, "lib", "core.js"), "utf8"),
    "lib/ 应整体来自新版",
  );
  // 3) 客户端来自新版
  assert.equal(
    fs.readFileSync(path.join(dest, "client.js"), "utf8"),
    fs.readFileSync(path.join(ROOT, "client.js"), "utf8"),
    "client.js 应来自新版",
  );
  // 4) 预设目录来自新版（旧 preset 被移出，不再残留）
  assert.ok(!fs.existsSync(path.join(dest, "presets", "redteam", "old.yml")), "旧预设应被移出，避免混合版本");
  assert.ok(fs.existsSync(path.join(dest, "presets", "redteam", "agent.cordis.yml")), "新版预设应就位");
  // 5) 技能目录同上
  assert.ok(!fs.existsSync(path.join(dest, "skills", "redteam", "old.md")), "旧技能应被移出");
  const skills = fs.readdirSync(path.join(dest, "skills", "redteam"));
  assert.ok(skills.length > 5, `技能应随更新进来（实际 ${skills.length} 个）`);

  await hooks.rollbackSwap(rec);
  fs.rmSync(tmp, { recursive: true, force: true });
});

await t("真实快照：scripts/ 随更新进来（check-anchors 等工具可用）", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-p22b-"));
  const dest = path.join(tmp, "installed");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "dsh-purge", version: "0.0.1" }));
  const rec = await hooks.stagedSwapOne(dest, ROOT, "p22b");
  assert.ok(fs.existsSync(path.join(dest, "scripts", "check-anchors.mjs")), "scripts/ 应随更新进来");
  assert.ok(fs.existsSync(path.join(dest, "COMPAT-NOTICE.md")), "COMPAT-NOTICE.md 应随更新进来");
  await hooks.rollbackSwap(rec);
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`\nP2-2 结果: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
