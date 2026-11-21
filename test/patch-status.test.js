import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_PATCHES,
  applyReplacementsToText,
  filePatchOutcome,
  isPatchResultSoftOk,
  isSelfMarkedPatch,
  parseHostVersion,
  patchStatusReady,
  rollupDisplayStatus,
  rollupPatchStatus,
  tallyDisplayPatches,
} from "../lib/core.js";

const base = {
  applied: 0,
  already: 0,
  missing: 0,
  notFound: 0,
  drifted: 0,
  lastError: null,
  keyCount: 1,
  layoutSoft: false,
  strictFiles: false,
};

/* ---------------------------------------------------------------------------
 * 判据：上游漂移必须显性，不能落成 skipped（软成功）。
 * 这是"官方升级后插件静默失效、状态页却全绿"的唯一入口。
 * ------------------------------------------------------------------------- */

test("rollupPatchStatus: 文件在、原文对不上 → drifted 而不是 skipped", () => {
  assert.equal(rollupPatchStatus({ ...base, drifted: 1 }), "drifted");
});

test("rollupPatchStatus: pattern 还在 → pattern_not_found（可以打）", () => {
  assert.equal(rollupPatchStatus({ ...base, notFound: 1 }), "pattern_not_found");
});

test("rollupPatchStatus: 多文件补丁只要有一个文件漂移，整体就不是 applied", () => {
  // 1.1.91 把 drifted 提到 applied 之前（rollupPatchStatus 里有明确注释，展示层
  // rollupDisplayStatus 也是「有一条漂移就不是干净绿」）。旧的 applied 压过 drifted
  // 是 1.1.86 行为：多文件补丁一半打上、一半静默失效时状态页仍绿 —— 上游已推翻。
  assert.equal(rollupPatchStatus({ ...base, applied: 1, drifted: 1 }), "drifted");
  // 但「个别文件本来就不含这段代码」不算漂移（走 notFound），不能制造半打假告警。
  assert.equal(rollupPatchStatus({ ...base, applied: 1, notFound: 1 }), "applied");
});

test("rollupPatchStatus: 已落盘 + 真漂移 → drifted，不因曾经打上过就翻绿", () => {
  // 同上：already 也压不过真漂移（drifted>0 说明那份官方原文被改写/搬走了）。
  assert.equal(rollupPatchStatus({ ...base, already: 1, drifted: 1 }), "drifted");
  // 只有「这一份文件本来就没有这段代码」（notFound）+ layoutSoft，才继续算 already。
  assert.equal(rollupPatchStatus({ ...base, already: 1, notFound: 1, layoutSoft: true }), "already");
});

test("rollupPatchStatus: 写错误优先于 applied，不能把 EACCES 吞成绿", () => {
  assert.equal(
    rollupPatchStatus({ ...base, applied: 1, lastError: "write_error:EACCES" }),
    "write_error:EACCES",
  );
});

test("rollupPatchStatus: 文件全缺 → missing_file", () => {
  assert.equal(rollupPatchStatus({ ...base, missing: 1 }), "missing_file");
});

test("filePatchOutcome: 文件在、marker 没有、pattern 一条都不中 → drifted", () => {
  const patch = { id: 9801, replacements: [{ pattern: "NEEDLE_NOT_THERE", replace: "x" }] };
  assert.equal(filePatchOutcome("host text", patch, ""), "drifted");
});

test("filePatchOutcome: marker 在 → applied（不算漂移）", () => {
  const patch = {
    id: 9802,
    markers: ["[dsh-purge] marker"],
    replacements: [{ pattern: "NEEDLE_NOT_THERE", replace: "x" }],
  };
  assert.equal(filePatchOutcome("host [dsh-purge] marker text", patch, ""), "applied");
});

test("filePatchOutcome: pattern 还在 → pending", () => {
  const patch = { id: 9803, replacements: [{ pattern: "NEEDLE", replace: "x" }] };
  assert.equal(filePatchOutcome("a NEEDLE b", patch, ""), "pending");
});

test("自标记型补丁：pattern 就是本插件留下的痕迹，找不到 = 本来没加过，不算漂移", () => {
  const patch = {
    id: 9804,
    replacements: [{ pattern: "- id: tool-fs # [dsh-purge] minimal fs tool parity", replace: "x" }],
  };
  assert.equal(isSelfMarkedPatch(patch), true);
  assert.equal(filePatchOutcome("host text", patch, ""), "skipped");
});

test("自标记型判定：普通补丁不算自标记，#80 算", () => {
  assert.equal(isSelfMarkedPatch({ id: 9805, replacements: [{ pattern: "const a = 1;", replace: "x" }] }), false);
  const p80 = ALL_PATCHES.find((p) => p.id === 80);
  assert.ok(p80, "找不到 #80");
  assert.equal(isSelfMarkedPatch(p80), true);
});

/* ---------------------------------------------------------------------------
 * 就绪口径：drifted 必须让"已就绪"变红（可选补丁不阻断 apply，但状态仍在）。
 * ------------------------------------------------------------------------- */

test("patchStatusReady: drifted 的非可选补丁不算就绪", () => {
  assert.equal(patchStatusReady("drifted", { optional: false }), false);
});

test("patchStatusReady: drifted 的可选补丁不阻断就绪", () => {
  assert.equal(patchStatusReady("drifted", { optional: true }), true);
});

test("patchStatusReady: applied / already 算就绪", () => {
  assert.equal(patchStatusReady("applied"), true);
  assert.equal(patchStatusReady("already"), true);
});

test("patchStatusReady: pending 不算就绪", () => {
  assert.equal(patchStatusReady("pending"), false);
});

test("patchStatusReady: skipped 不再天然就绪，可选补丁仍然就绪", () => {
  assert.equal(patchStatusReady("skipped", { optional: false }), false);
  assert.equal(patchStatusReady("skipped", { optional: true }), true);
});

/* ---------------------------------------------------------------------------
 * 展示层统计：drifted 不能被算进 ready。
 * ------------------------------------------------------------------------- */

test("tallyDisplayPatches: drifted 不计入 ready", () => {
  const out = tallyDisplayPatches([
    { status: "applied" },
    { status: "drifted" },
    { status: "skipped" },
  ]);
  assert.equal(out.applied, 1);
  assert.equal(out.drifted, 1);
  assert.equal(out.ready, 2, "只有 applied + skipped 计入 ready");
});

test("rollupDisplayStatus: 一组里只要有一条漂移，这组就不是干净绿", () => {
  assert.equal(rollupDisplayStatus(["applied", "drifted"]), "drifted");
  assert.equal(rollupDisplayStatus(["applied", "applied"]), "applied");
  assert.equal(rollupDisplayStatus(["pending", "drifted"]), "pending");
});

/* ---------------------------------------------------------------------------
 * 软成功口径：skipped 不再天然软成功；drifted 看得见但不阻断 Apply。
 * ------------------------------------------------------------------------- */

test("isPatchResultSoftOk: skipped 只有可选/自标记型才算软成功", () => {
  assert.equal(isPatchResultSoftOk({ status: "skipped" }, { id: 1, optional: false }), false);
  assert.equal(isPatchResultSoftOk({ status: "skipped" }, { id: 2, optional: true }), true);
});

test("isPatchResultSoftOk: drifted 不阻断 Apply（兼容 0.1.6 / 0.2.0 / 0.2.1-rc.2）", () => {
  assert.equal(isPatchResultSoftOk({ status: "drifted" }, { id: 3, optional: false }), true);
});

/* ---------------------------------------------------------------------------
 * 幂等：二次应用不得继续增长（历史事故是每次 apply +841 字符、永不收敛）。
 * ------------------------------------------------------------------------- */

test("applyReplacementsToText: 全部字面量 pattern 二次应用不叠加", () => {
  const offenders = [];
  for (const p of ALL_PATCHES) {
    const reps = (p.replacements || []).filter((r) => r.pattern && !(r.pattern instanceof RegExp));
    if (reps.length === 0) continue;
    // 用 pattern 本体合成输入：保证第一遍一定命中，从而真正检验收敛性。
    const src = reps.map((r) => String(r.pattern)).join("\n");
    const once = applyReplacementsToText(src, p, "");
    const twice = applyReplacementsToText(once.text, p, "");
    if (twice.text !== once.text) offenders.push(`#${p.id} ${p.name}`);
  }
  assert.deepEqual(offenders, [], `这些补丁二次应用还在变：${offenders.join(", ")}`);
});

test("插入型补丁 #92/#93：连续 apply 三次必须收敛（insertProbe 守卫）", () => {
  // 这两个补丁的 pattern 会原样保留在产物里（#92 前两行就是 pattern；#93 的 replace
  // 末尾又把 claimDesktopSingleInstance 调用拼回去），没有 insertProbe 时每次 apply
  // 都会再插一遍：实测 121→635→1149→1663（#93 70→1703→3336→4969），正是
  // 「每次 apply +841 字符、永不收敛」那类事故。这里锁死「第 2、3 次 changed=false 且长度不变」。
  for (const id of [92, 93]) {
    const p = ALL_PATCHES.find((x) => x.id === id);
    assert.ok(p, `找不到 #${id}`);
    const reps = (p.replacements || []).filter((r) => r.pattern && !(r.pattern instanceof RegExp));
    assert.ok(reps.length > 0, `#${id} 应当有字面量 pattern`);
    assert.ok(
      reps.every((r) => typeof r.insertProbe === "string" && r.insertProbe.length > 0),
      `#${id} 的插入型 replacement 必须声明 insertProbe，否则重复 apply 会无限追加`,
    );
    const src = reps.map((r) => String(r.pattern)).join("\n");
    let text = applyReplacementsToText(src, p, "").text;
    const afterFirst = text.length;
    for (let pass = 2; pass <= 3; pass += 1) {
      const r = applyReplacementsToText(text, p, "");
      assert.equal(r.changed, false, `#${id} 第 ${pass} 次 apply 仍 changed=true（会无限膨胀）`);
      assert.equal(r.text.length, afterFirst, `#${id} 第 ${pass} 次 apply 长度从 ${afterFirst} 变成 ${r.text.length}`);
      text = r.text;
    }
  }
});

test("applyReplacementsToText: 没有残留 pattern 时 changed=false", () => {
  const patch = { id: 9901, replacements: [{ pattern: "NOT_PRESENT_ANYWHERE", replace: "x" }] };
  const r = applyReplacementsToText("hello world", patch, "");
  assert.equal(r.changed, false);
  assert.equal(r.text, "hello world");
});

test("#77 锚点容错：官方在中间插一行也照样命中，且二次应用不叠加", () => {
  const p77 = ALL_PATCHES.find((p) => p.id === 77);
  assert.ok(p77, "找不到 #77");
  // 0.2.1-rc.2 起的官方原文：中间多了一行 revised.clear()
  const host =
    "\t\t\tappend(record) {\n" +
    "\t\t\t\tconst event = record.event;\n" +
    "\t\t\t\tif (this.inputs.has(event.seq)) return \"none\";\n" +
    "\t\t\t\tif (this.revised.size > 0) this.revised.clear();\n" +
    "\t\t\t\tthis.inputs.set(event.seq, record);\n";
  const once = applyReplacementsToText(host, p77, "");
  assert.equal(once.changed, true, "rc.2 的原文应当命中");
  assert.ok(once.text.includes("isRewindMarker(event)"), "应当注入回退判断");
  assert.ok(once.text.includes("if (this.revised.size > 0) this.revised.clear();"), "官方那行必须原样保留");
  const twice = applyReplacementsToText(once.text, p77, "");
  assert.equal(twice.text, once.text, "二次应用不得再插一遍");
});

/* ---------------------------------------------------------------------------
 * 命中数契约：官方同名代码多一处就该拒写，而不是把两处一起改掉。
 * ------------------------------------------------------------------------- */

test("applyReplacementsToText: expect 命中数不符时拒写并回传实际命中数", () => {
  const patch = { id: 9902, replacements: [{ pattern: "NEEDLE", replace: "X", expect: 1 }] };
  const r = applyReplacementsToText("NEEDLE NEEDLE", patch, "");
  assert.ok(r.hitMismatch, "应当回传 hitMismatch");
  assert.equal(r.hitMismatch.expected, 1);
  assert.equal(r.hitMismatch.actual, 2);
  assert.equal(r.text, "NEEDLE NEEDLE", "拒写时原文必须原样返回");
  assert.equal(r.changed, false);
});

test("applyReplacementsToText: expect 命中数一致时正常替换", () => {
  const patch = { id: 9903, replacements: [{ pattern: "NEEDLE", replace: "X", expect: 1 }] };
  const r = applyReplacementsToText("a NEEDLE b", patch, "");
  assert.equal(r.hitMismatch, undefined);
  assert.equal(r.text, "a X b");
});

test("applyReplacementsToText: expect=1 但一处都没命中也算不符（不许静默跳过）", () => {
  const patch = { id: 9905, replacements: [{ pattern: "NEEDLE", replace: "X", expect: 1 }] };
  const r = applyReplacementsToText("nothing here", patch, "");
  assert.ok(r.hitMismatch, "0 次命中同样是失配");
  assert.equal(r.hitMismatch.actual, 0);
  assert.equal(r.changed, false);
});

test("applyReplacementsToText: 未声明 expect 时保持旧行为（全量替换）", () => {
  const patch = { id: 9904, replacements: [{ pattern: "N", replace: "X" }] };
  const r = applyReplacementsToText("N N", patch, "");
  assert.equal(r.hitMismatch, undefined);
  assert.equal(r.text, "X X");
});

test("applyReplacementsToText: 正则 pattern 的 expect 同样生效（官方复制成两份就拒写）", () => {
  const patch = { id: 9906, replacements: [{ pattern: /NEEDLE/g, replace: "X", expect: 1 }] };
  const r = applyReplacementsToText("NEEDLE NEEDLE", patch, "");
  assert.ok(r.hitMismatch, "正则也必须遵守命中数契约");
  assert.equal(r.hitMismatch.actual, 2);
  assert.equal(r.text, "NEEDLE NEEDLE", "拒写时原文必须原样返回");
});

/* ---------------------------------------------------------------------------
 * 宿主版本门禁
 * ------------------------------------------------------------------------- */

test("parseHostVersion: 拆出主次修订与预发布段", () => {
  assert.deepEqual(parseHostVersion("0.2.1-rc.3"), {
    major: 0, minor: 2, patch: 1, pre: ["rc", "3"],
  });
  assert.equal(parseHostVersion("not-a-version"), null);
  assert.deepEqual(parseHostVersion("v1.2.3"), { major: 1, minor: 2, patch: 3, pre: [] });
});
