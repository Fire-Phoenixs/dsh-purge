import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const client = readFileSync(join(root, "client.js"), "utf8");

function rule(selector) {
	const at = client.indexOf(selector);
	if (at < 0) return "";
	const brace = client.indexOf("{", at);
	const end = client.indexOf("}", brace);
	return brace < 0 || end < 0 ? "" : client.slice(brace + 1, end);
}

test("#196 暗色宿主主按钮不再使用近白色品牌底", () => {
	// 宿主暗色下 --dsw-alias-brand-primary = #f9fafb，直接拿它作底会白底白字。
	for (const selector of [
		'body[data-ds-dark-theme] .dshp-btn-primary',
		'.dshp-root[data-theme="dusk"] .dshp-btn-primary',
		'.dshp-dock[data-theme="dusk"] .dshp-btn-primary',
		'body[data-ds-dark-theme] .rt-btn-primary',
		'.dshp-dock[data-theme="dusk"] .rt-btn-primary',
		'.dshp-dock[data-theme="dusk"] .dshp-dock-body .rt-btn-primary',
	]) {
		const body = rule(selector);
		assert.match(body, /background:#3d8f68!important/, selector);
		assert.match(body, /color:#fff!important/, selector);
	}
});

test("#196 暗色主按钮悬停仍有可读底色", () => {
	const body = rule('body[data-ds-dark-theme] .dshp-btn-primary:hover:not(:disabled)');
	assert.match(body, /background:#347a59!important/);
});

test("#196 报告步骤序号圆点暗色下保持绿底白字", () => {
	const at = client.indexOf('body[data-ds-dark-theme] .rt-rep-step-no,.dshp-dock[data-theme="dusk"] .rt-rep-step-no');
	assert.notEqual(at, -1);
	const body = client.slice(at, client.indexOf("}", at));
	assert.match(body, /background:#3d8f68/);
	assert.match(body, /color:#fff/);
});
