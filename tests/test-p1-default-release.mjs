/**
 * P1-1 回归：停用时交还默认预设。
 *
 * 根因：官方 registry 的 Config 是
 *   { default: z.string().required(), selectedDefault: z.string().volatile() }
 * 宿主 defaultId = selectedDefault.get() ?? config.default。
 * 旧代码对 default 也调 .get()（`registry.config?.default?.get?.()`），
 * 字符串没有 .get → 恒 undefined → 走进 release-default-skipped，
 * settings.update() 从不执行，默认值继续指向已注销的 redteam。
 *
 * 本测试用**真实的 alpha.3 Config 形状**驱动插件 apply()，通过 ctx.effect
 * 注册的 disposer 触发停用路径，断言 selectedDefault 被写回 default。
 * 全程在临时 DSH_HOME 内，不触碰真实环境。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log("  PASS  " + name); pass += 1; }
  catch (e) { console.log("  FAIL  " + name + "\n        " + (e && e.message ? e.message : e)); fail += 1; }
};
const tAsync = async (name, fn) => {
  try { await fn(); console.log("  PASS  " + name); pass += 1; }
  catch (e) { console.log("  FAIL  " + name + "\n        " + (e && e.message ? e.message : e)); fail += 1; }
};

/** 官方 alpha.3 Config 形状：default 是普通字符串，selectedDefault 才是 volatile。 */
function makeOfficialRegistry({ defaultId = "standard", selectedDefaultId = null, persist } = {}) {
  let selected = selectedDefaultId;
  const writes = [];
  return {
    writes,
    config: {
      default: defaultId,                                   // 普通字符串，无 .get()
      selectedDefault: {
        get: () => selected,
        set: (v) => { selected = v; },
      },
    },
    get defaultId() { return this.config.selectedDefault.get() ?? this.config.default; },
    register: () => ({ dispose: () => {} }),
    _selected: () => selected,
    _setSelected: (v) => { selected = v; },
  };
}

/** 用最小 ctx 驱动插件 apply()，返回 disposer 与状态读取器。 */
async function drive({ registry, settings, dshHome }) {
  process.env.DSH_HOME = dshHome;
  const mod = await import(pathToFileURL(path.join(ROOT, "lib", "redteam", "index.js")).href + "?v=" + Math.random());
  const disposers = [];
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    agentPresets: registry,
    get: (k) => (k === "settings" ? settings : (k === "agentPresets" ? registry : undefined)),
    effect: (fn) => { disposers.push(fn()); return () => {}; },
    provide: () => {},
  };
  mod.apply(ctx);
  const statusFile = path.join(dshHome, "redteam", "preset-declare.json");
  return {
    dispose: () => { for (const d of disposers) d(); },
    status: () => { try { return JSON.parse(fs.readFileSync(statusFile, "utf8")); } catch { return null; } },
  };
}

function freshHome() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-p11-"));
  fs.mkdirSync(path.join(h, "redteam"), { recursive: true });
  return h;
}

console.log("\n=== P1-1 停用时交还默认预设 ===\n");

await tAsync("官方 Config 形状：selectedDefault=redteam 时，写回 config.default", async () => {
  const home = freshHome();
  const registry = makeOfficialRegistry({ defaultId: "standard", selectedDefaultId: "redteam" });
  const updates = [];
  const settings = {
    update: async (ns, patch) => {
      updates.push({ ns, patch });
      registry._setSelected(patch.selectedDefault);   // 模拟宿主把 volatile 值落盘
    },
  };
  const d = await drive({ registry, settings, dshHome: home });
  d.dispose();
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(updates.length, 1, "settings.update 应该被调用一次（旧代码恒为 0）");
  assert.equal(updates[0].ns, "agent-preset-registry");
  assert.equal(updates[0].patch.selectedDefault, "standard", "应写回 config.default");
  assert.notEqual(registry.defaultId, "redteam", "停用后宿主默认不应再指向 redteam");
  assert.equal(registry.defaultId, "standard");
  const st = d.status();
  assert.equal(st.phase, "released-default");
  assert.equal(st.ok, true);
  fs.rmSync(home, { recursive: true, force: true });
});

await tAsync("当前默认不是 redteam 时，不应触碰用户选择", async () => {
  const home = freshHome();
  const registry = makeOfficialRegistry({ defaultId: "standard", selectedDefaultId: "minimal" });
  const updates = [];
  const settings = { update: async (ns, p) => { updates.push(p); registry._setSelected(p.selectedDefault); } };
  const d = await drive({ registry, settings, dshHome: home });
  d.dispose();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(updates.length, 0, "用户选了别的预设，不该被覆盖");
  assert.equal(registry.defaultId, "minimal");
  fs.rmSync(home, { recursive: true, force: true });
});

await tAsync("selectedDefault 为 null（未设）时不动", async () => {
  const home = freshHome();
  const registry = makeOfficialRegistry({ defaultId: "standard", selectedDefaultId: null });
  const updates = [];
  const settings = { update: async (ns, p) => { updates.push(p); } };
  const d = await drive({ registry, settings, dshHome: home });
  d.dispose();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(updates.length, 0);
  fs.rmSync(home, { recursive: true, force: true });
});

await tAsync("config.default 不可用（空串）时明确记录 skipped，不误报成功", async () => {
  const home = freshHome();
  const registry = makeOfficialRegistry({ defaultId: "", selectedDefaultId: "redteam" });
  const updates = [];
  const settings = { update: async (ns, p) => { updates.push(p); } };
  const d = await drive({ registry, settings, dshHome: home });
  d.dispose();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(updates.length, 0, "坏兜底值不该被写进去");
  const st = d.status();
  assert.equal(st.phase, "release-default-skipped");
  assert.equal(st.ok, false, "不能误报成功");
  fs.rmSync(home, { recursive: true, force: true });
});

await tAsync("settings 服务不可用时明确记录 skipped", async () => {
  const home = freshHome();
  const registry = makeOfficialRegistry({ defaultId: "standard", selectedDefaultId: "redteam" });
  const d = await drive({ registry, settings: undefined, dshHome: home });
  d.dispose();
  await new Promise((r) => setTimeout(r, 30));
  const st = d.status();
  assert.equal(st.phase, "release-default-skipped");
  assert.equal(st.ok, false);
  fs.rmSync(home, { recursive: true, force: true });
});

await tAsync("settings.update 抛错时记录 failed，不误报成功", async () => {
  const home = freshHome();
  const registry = makeOfficialRegistry({ defaultId: "standard", selectedDefaultId: "redteam" });
  const settings = { update: async () => { throw new Error("EACCES: permission denied"); } };
  const d = await drive({ registry, settings, dshHome: home });
  d.dispose();
  await new Promise((r) => setTimeout(r, 40));
  const st = d.status();
  assert.equal(st.phase, "release-default-failed");
  assert.equal(st.ok, false);
  assert.match(String(st.error), /EACCES/);
  fs.rmSync(home, { recursive: true, force: true });
});

await tAsync("写成功但值没落（并发覆盖）时不报成功", async () => {
  const home = freshHome();
  const registry = makeOfficialRegistry({ defaultId: "standard", selectedDefaultId: "redteam" });
  // update 返回成功，但 volatile 值被别处改回 redteam
  const settings = { update: async () => { registry._setSelected("redteam"); } };
  const d = await drive({ registry, settings, dshHome: home });
  d.dispose();
  await new Promise((r) => setTimeout(r, 40));
  const st = d.status();
  assert.equal(st.ok, false, "读回发现仍指向 redteam，不能报成功");
  assert.equal(st.phase, "release-default-failed");
  fs.rmSync(home, { recursive: true, force: true });
});

await tAsync("兼容 volatile 形状的 config.default（回归保护，不误伤未来宿主）", async () => {
  const home = freshHome();
  let selected = "redteam";
  const registry = {
    config: {
      default: { get: () => "cordis" },                    // 另一种形状：volatile
      selectedDefault: { get: () => selected },
    },
    register: () => ({ dispose: () => {} }),
    _setSelected: (v) => { selected = v; },
    _selected: () => selected,
  };
  const updates = [];
  const settings = { update: async (ns, p) => { updates.push(p); selected = p.selectedDefault; } };
  const d = await drive({ registry, settings, dshHome: home });
  d.dispose();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].selectedDefault, "cordis");
  fs.rmSync(home, { recursive: true, force: true });
});

console.log(`\nP1-1 结果: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
