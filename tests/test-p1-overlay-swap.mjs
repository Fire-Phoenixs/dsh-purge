/**
 * P1-2 回归：覆盖更新失败不得破坏现有安装。
 *
 * 旧实现「先 rm 再 cp」：rm 掉 lib/bin/docs 之后 cp 途中失败（占用/磁盘满/中断），
 * 旧文件已经没了、新文件没写完，插件下次加载直接失败，只能重装。
 *
 * 新实现事务式：暂存(并校验) → 备份 → 同卷 rename 切换 → 任一步失败就地回滚。
 * 本测试用**真实文件系统**做故障注入，验证旧安装始终完整。
 * 全程在临时目录内。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const upd = await import(pathToFileURL(path.join(ROOT, "lib", "update.js")).href);
const { stagedSwapOne, rollbackSwap } = upd.__testHooks;

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log("  PASS  " + name); pass += 1; }
  catch (e) { console.log("  FAIL  " + name + "\n        " + (e?.stack || e)); fail += 1; }
};

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-p12-"));
const mk = (name) => fs.mkdtempSync(path.join(tmpRoot, name + "-"));

/** 旧安装：含 lib/index.js、client.js、package.json（版本 old）。 */
function makeOldInstall(dir) {
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "dsh-purge", version: "1.1.0" }));
  fs.writeFileSync(path.join(dir, "lib", "index.js"), "// OLD index\n");
  fs.writeFileSync(path.join(dir, "client.js"), "// OLD client\n");
  fs.writeFileSync(path.join(dir, "cordis.patch.yml"), "# OLD yml\n");
}

/** 新版包：版本 new。opts 可制造残缺/坏包。 */
function makeNewPkg(dir, opts = {}) {
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  if (!opts.missingPackageJson) {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: opts.name ?? "dsh-purge", version: "1.2.0" }));
  }
  if (!opts.missingLibIndex) fs.writeFileSync(path.join(dir, "lib", "index.js"), "// NEW index\n");
  if (!opts.missingClient) fs.writeFileSync(path.join(dir, "client.js"), "// NEW client\n");
  if (!opts.missingYml) fs.writeFileSync(path.join(dir, "cordis.patch.yml"), "# NEW yml\n");
  if (opts.withPresets) {
    fs.mkdirSync(path.join(dir, "presets", "redteam"), { recursive: true });
    fs.writeFileSync(path.join(dir, "presets", "redteam", "agent.cordis.yml"), "id: redteam # NEW\n");
  }
  if (opts.withSkills) {
    fs.mkdirSync(path.join(dir, "skills", "redteam"), { recursive: true });
    fs.writeFileSync(path.join(dir, "skills", "redteam", "x.md"), "# NEW skill\n");
  }
  return dir;
}

const readVersion = (dir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version; }
  catch { return null; }
};
const assertOldIntact = (dir, label) => {
  assert.equal(readVersion(dir), "1.1.0", label + ": package.json 应仍是旧版本");
  assert.equal(fs.readFileSync(path.join(dir, "lib", "index.js"), "utf8"), "// OLD index\n", label + ": lib/index.js 应仍是旧内容");
  assert.equal(fs.readFileSync(path.join(dir, "client.js"), "utf8"), "// OLD client\n", label + ": client.js 应仍是旧内容");
  assert.equal(fs.readFileSync(path.join(dir, "cordis.patch.yml"), "utf8"), "# OLD yml\n", label + ": cordis.patch.yml 应仍是旧内容");
};

console.log("\n=== P1-2 覆盖更新的事务性与回滚 ===\n");

await t("正常路径：完整包可切换成功，版本与随包资源都更新", async () => {
  const dest = mk("ok-dest");
  makeOldInstall(dest);
  const pkg = makeNewPkg(mk("ok-pkg"), { withPresets: true, withSkills: true });
  const rec = await stagedSwapOne(dest, pkg, "t1");
  assert.equal(readVersion(dest), "1.2.0");
  assert.equal(fs.readFileSync(path.join(dest, "lib", "index.js"), "utf8"), "// NEW index\n");
  assert.ok(fs.existsSync(path.join(dest, "presets", "redteam", "agent.cordis.yml")), "presets 应随更新进来");
  assert.ok(fs.existsSync(path.join(dest, "skills", "redteam", "x.md")), "skills 应随更新进来");
  await rollbackSwap(rec);   // 清理
});

await t("坏包（缺 lib/index.js）在切换前就被拒绝，旧安装零改动", async () => {
  const dest = mk("bad-dest");
  makeOldInstall(dest);
  const pkg = makeNewPkg(mk("bad-pkg"), { missingLibIndex: true });
  await assert.rejects(() => stagedSwapOne(dest, pkg, "t2"), /关键文件|lib\/index\.js/);
  assertOldIntact(dest, "拒绝坏包后");
});

await t("坏包（package.json 无法解析）被拒绝，旧安装零改动", async () => {
  const dest = mk("badjson-dest");
  makeOldInstall(dest);
  const pkg = makeNewPkg(mk("badjson-pkg"));
  fs.writeFileSync(path.join(pkg, "package.json"), "{ this is not json");
  await assert.rejects(() => stagedSwapOne(dest, pkg, "t3"), /无法解析/);
  assertOldIntact(dest, "坏 json 被拒后");
});

await t("包名不是 dsh-purge 时被拒绝（防止装错包）", async () => {
  const dest = mk("name-dest");
  makeOldInstall(dest);
  const pkg = makeNewPkg(mk("name-pkg"), { name: "some-other-plugin" });
  await assert.rejects(() => stagedSwapOne(dest, pkg, "t4"), /包名不是 dsh-purge/);
  assertOldIntact(dest, "包名不符被拒后");
});

await t("切换阶段失败（rename 抛错）时旧安装被完整恢复", async () => {
  const dest = mk("swapfail-dest");
  makeOldInstall(dest);
  const pkg = makeNewPkg(mk("swapfail-pkg"));
  // 故障注入：让 dest 下的 rename 在「搬入」阶段失败。
  const realRename = fs.promises.rename.bind(fs.promises);
  let n = 0;
  const spy = async (from, to) => {
    // 前若干次是「搬出到 backup」；之后模拟搬入时磁盘/占用失败
    n += 1;
    if (String(from).includes(".stage-") ) throw Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" });
    return realRename(from, to);
  };
  const orig = fs.promises.rename;
  fs.promises.rename = spy;
  try {
    await assert.rejects(() => stagedSwapOne(dest, pkg, "t5"), /EBUSY/);
  } finally {
    fs.promises.rename = orig;
  }
  assert.ok(n > 0, "注入点应被触发");
  assertOldIntact(dest, "切换失败回滚后");
});

await t("回滚后可以重试并成功（不是一次性损坏）", async () => {
  const dest = mk("retry-dest");
  makeOldInstall(dest);
  const pkg = makeNewPkg(mk("retry-pkg"));
  const orig = fs.promises.rename;
  let armed = true;
  fs.promises.rename = async (from, to) => {
    if (armed && String(from).includes(".stage-")) { armed = false; throw new Error("EACCES: denied"); }
    return orig(from, to);
  };
  try { await assert.rejects(() => stagedSwapOne(dest, pkg, "t6")); }
  finally { fs.promises.rename = orig; }
  assertOldIntact(dest, "首次失败后");
  // 再试一次，这次不注入故障
  const rec = await stagedSwapOne(dest, pkg, "t7");
  assert.equal(readVersion(dest), "1.2.0", "重试应成功");
  await rollbackSwap(rec);
});

await t("多目标部分失败：已切换的目标被回滚，两边都回到旧版", async () => {
  const destA = mk("multiA");
  const destB = mk("multiB");
  makeOldInstall(destA);
  makeOldInstall(destB);
  const pkg = makeNewPkg(mk("multi-pkg"));
  const done = [];
  let err = null;
  const orig = fs.promises.rename;
  try {
    done.push(await stagedSwapOne(destA, pkg, "t8"));
    // 让第二个目标的搬入失败
    fs.promises.rename = async (from, to) => {
      if (String(to).startsWith(destB) && String(from).includes(".stage-")) throw new Error("ENOSPC: no space left");
      return orig(from, to);
    };
    await stagedSwapOne(destB, pkg, "t9");
  } catch (e) {
    err = e;
    for (const rec of [...done].reverse()) await rollbackSwap(rec);
  } finally {
    fs.promises.rename = orig;
  }
  assert.ok(err, "应该抛错");
  assert.match(String(err.message), /ENOSPC/);
  assertOldIntact(destA, "多目标失败后 A");
  assertOldIntact(destB, "多目标失败后 B");
});

await t("用户数据不被覆盖（prompt-inject.md / redteam 事实库留在原位）", async () => {
  const dest = mk("userdata-dest");
  makeOldInstall(dest);
  fs.writeFileSync(path.join(dest, "prompt-inject.md"), "# USER PROMPT\n");
  fs.mkdirSync(path.join(dest, "redteam"), { recursive: true });
  fs.writeFileSync(path.join(dest, "redteam", "facts.db"), "USER DATA");
  const pkg = makeNewPkg(mk("userdata-pkg"));
  const rec = await stagedSwapOne(dest, pkg, "t10");
  assert.equal(fs.readFileSync(path.join(dest, "prompt-inject.md"), "utf8"), "# USER PROMPT\n", "用户提示词不该被更新覆盖");
  assert.equal(fs.readFileSync(path.join(dest, "redteam", "facts.db"), "utf8"), "USER DATA", "事实库不该被动");
  await rollbackSwap(rec);
});

await t("新版不再包含的旧随包资源被移出安装目录", async () => {
  const dest = mk("stale-dest");
  makeOldInstall(dest);
  fs.mkdirSync(path.join(dest, "presets", "redteam"), { recursive: true });
  fs.writeFileSync(path.join(dest, "presets", "redteam", "old.yml"), "# OLD preset\n");
  // 新版不带 presets/
  const pkg = makeNewPkg(mk("stale-pkg"));
  const rec = await stagedSwapOne(dest, pkg, "t11");
  assert.ok(!fs.existsSync(path.join(dest, "presets")), "新版不含 presets 时旧的应被移出");
  await rollbackSwap(rec);
});

await t("备份目录里保留了旧内容（可手工恢复）", async () => {
  const dest = mk("backup-dest");
  makeOldInstall(dest);
  const pkg = makeNewPkg(mk("backup-pkg"));
  const rec = await stagedSwapOne(dest, pkg, "t12");
  assert.ok(fs.existsSync(rec.backupDir), "应存在 backup 目录");
  assert.equal(fs.readFileSync(path.join(rec.backupDir, "lib", "index.js"), "utf8"), "// OLD index\n", "backup 里应是旧内容");
  await rollbackSwap(rec);
});

console.log(`\nP1-2 结果: ${pass} passed, ${fail} failed`);
fs.rmSync(tmpRoot, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
