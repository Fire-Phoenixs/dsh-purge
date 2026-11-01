import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rewritePromptAssembly } from "../lib/identity.js";
import { ANCHOR_SECTION, anchorTextFor } from "../lib/anchor.js";
import { readPresetDefinition } from "../lib/redteam/preset-composition.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assembledWith(sections = []) {
  return {
    sections: [{ name: "harness:identity", text: "host identity" }, ...sections],
    tools: [],
    contexts: [],
  };
}

/* ---------------------------------------------------------------------------
 * 锚点接线：waterfall 返回的 sections 数组顺序就是渲染顺序，
 * 锚点必须物理排在最后一位，不能只靠 order 字段。
 */
test("rewritePromptAssembly: 锚点追加在 sections 数组最后一位", () => {
  const out = rewritePromptAssembly(assembledWith([{ name: "tail", text: "tail text" }]), "PROMPT", {
    anchorText: "ANCHOR BODY",
  });
  const last = out.sections[out.sections.length - 1];
  assert.equal(last.name, ANCHOR_SECTION);
  assert.equal(last.text, "ANCHOR BODY");
  assert.equal(last.interpolate, false);
});

test("rewritePromptAssembly: 对象形式 options 也认 anchorText", () => {
  const out = rewritePromptAssembly(assembledWith(), {
    fallbackInject: "PROMPT",
    anchorText: "ANCHOR BODY",
    dropPurgeAfterFold: false,
  });
  const last = out.sections[out.sections.length - 1];
  assert.equal(last.name, ANCHOR_SECTION);
});

test("rewritePromptAssembly: 已有同名段先滤掉，不会出现两份", () => {
  const out = rewritePromptAssembly(
    assembledWith([{ name: ANCHOR_SECTION, text: "OLD ANCHOR" }]),
    "PROMPT",
    { anchorText: "NEW ANCHOR" },
  );
  const anchors = out.sections.filter((section) => section?.name === ANCHOR_SECTION);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].text, "NEW ANCHOR");
  assert.equal(out.sections[out.sections.length - 1].name, ANCHOR_SECTION);
});

test("rewritePromptAssembly: anchorText 为空时不注入锚点", () => {
  const out = rewritePromptAssembly(assembledWith([{ name: "tail", text: "tail text" }]), "PROMPT", {
    anchorText: "",
  });
  assert.equal(out.sections.some((section) => section?.name === ANCHOR_SECTION), false);
});

/* ---------------------------------------------------------------------------
 * 锚点语言：不能把英文开头句写死，否则中文会话（尤其红队模式）会被拽成英文。
 */
test("anchor: 要求跟随用户语言，不强制英文开头", () => {
  const text = anchorTextFor({});
  assert.match(text, /same language/);
  assert.equal(text.includes("Certainly! Here is"), false);
});

test("anchor: anchorMode=off 时不产出正文", () => {
  assert.equal(anchorTextFor({ anchorMode: "off" }), "");
  assert.notEqual(anchorTextFor({ anchorMode: "auto" }), "");
});

/* ---------------------------------------------------------------------------
 * 红队模式下拉文案：必须是中文单行，不能被上游英文模板盖回来。
 */
test("presets/redteam/preset.yml: 模式名与描述是中文单行", () => {
  const def = readPresetDefinition("redteam", path.join(repoRoot, "presets", "redteam"));
  assert.equal(def.name, "红队模式");
  assert.match(def.description, /攻防演练模式/);
  assert.equal(def.description.includes("\n"), false);
});
