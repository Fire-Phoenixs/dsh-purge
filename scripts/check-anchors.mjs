#!/usr/bin/env node
/**
 * 锚点体检 / anchor health check.
 *
 * dsh-purge 的补丁按「字面锚点」匹配官方源码：官方一改文案，锚点就哑火。
 * optional 的补丁失效时是静默跳过，界面不报错，用户只会觉得「这功能怎么没了」。
 * 这个脚本把那份静默变成一份可读的清单。
 *
 * 用法：
 *   node scripts/check-anchors.mjs                           # 对比 package.json 的 dshTarget 下限与 latest
 *   node scripts/check-anchors.mjs 0.2.0-rc.2 0.2.1-alpha.3   # 指定两个版本
 *
 * 退出码：0 = 无新增缺口；1 = 有强锚点在较新版本上失效（CI 可据此卡住）。
 *
 * 做法：从 npm 拉官方 tarball 到一个临时目录，把每个包摆成 aiBase 布局
 * （ai/<pkg> -> <pkg>/package），再让内核自己的 targetFiles() 解析 key，
 * 然后按 ALL_PATCHES 顺序跑 applyReplacementsToText()。顺序应用很关键——
 * 补丁之间会接力（例如 #1 改写 intro、#2 再把它回滚）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const core = await import(pathToFileURL(path.join(ROOT, "lib", "core.js")).href);

const PKGS = [
  "dsh-acp-app", "dsh-agent-instructions", "dsh-agent-loop", "dsh-agent-preset",
  "dsh-api-session-controller", "dsh-app-boot", "dsh-base", "dsh-client-ui-conversation",
  "dsh-client-ui-deliverables", "dsh-compaction-tool-result-pruner",
  "dsh-experimental-auto-review", "dsh-fs-observation-policy", "dsh-fs-sandbox",
  "dsh-headless", "dsh-hooks-claude-code", "dsh-hooks-codex", "dsh-llm-deepseek",
  "dsh-permission-presets", "dsh-persona", "dsh-repeat-tool-reminder", "dsh-sandbox",
  "dsh-sandbox-local", "dsh-sandbox-policy", "dsh-sdk-app", "dsh-sdk-minimal",
  "dsh-session", "dsh-session-format-v0-to-v1", "dsh-session-log-deepseek",
  "dsh-session-reference", "dsh-settings", "dsh-subagent", "dsh-system-prompt",
  "dsh-tool-bash", "dsh-tool-fs", "dsh-tool-pwsh", "dsh-tool-subagent", "dsh-tool-todo",
  "dsh-tool-web", "dsh-tools", "dsh-user-approval", "dsh-web-app",
];

const quiet = process.env.CHECK_ANCHORS_VERBOSE !== "1";
const note = (msg) => { if (!quiet) process.stderr.write(msg); };

function curl(url, out) {
  const args = ["-sS", "-L", "--max-time", "60"];
  if (out) args.push("-o", out);
  args.push(url);
  return execFileSync("curl.exe", args, { encoding: out ? undefined : "utf8" });
}

function latestVersion() {
  const meta = JSON.parse(curl("https://registry.npmjs.org/@deepseek-ai/dsh"));
  return meta["dist-tags"]?.latest ?? Object.keys(meta.versions).pop();
}

function lowerBoundOfTarget() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const m = String(pkg.dshTarget || "").match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return m ? m[0] : null;
}

/** 拉一个版本的全部官方包，并摆出 aiBase 布局，返回 { ai, packages }。 */
function fetchVersion(version, dest) {
  const base = path.join(dest, version);
  const ai = path.join(base, "ai");
  const packages = path.join(base, "packages");
  const probe = path.join(ai, "dsh-web-app", "presets", "minimal.patch.yml");
  if (fs.existsSync(probe)) return { ai, packages };

  fs.mkdirSync(ai, { recursive: true });
  fs.mkdirSync(packages, { recursive: true });
  let ok = 0;
  for (const name of PKGS) {
    const sub = path.join(packages, name);
    if (!fs.existsSync(path.join(sub, "package", "package.json"))) {
      fs.mkdirSync(sub, { recursive: true });
      try {
        curl(`https://registry.npmjs.org/@deepseek-ai/${name}/-/${name}-${version}.tgz`, path.join(sub, "pkg.tgz"));
        execFileSync("tar", ["-xzf", path.join(sub, "pkg.tgz"), "-C", sub], { stdio: "pipe" });
      } catch {
        continue; // 该版本没有这个包：不算失败
      }
    }
    // 官方包内容在 <sub>/package；内核按 aiBase/<pkg>/... 取文件，所以这里做一层链接。
    const link = path.join(ai, name);
    if (!fs.existsSync(link)) {
      try {
        fs.symlinkSync(path.join(sub, "package"), link, "junction");
      } catch {
        fs.cpSync(path.join(sub, "package"), link, { recursive: true });
      }
    }
    ok++;
  }
  note(`  fetched ${version}: ${ok}/${PKGS.length} packages\n`);
  return { ai, packages };
}

/** 官方干净树里，某个已解析路径对应的文件；找不到返回 null。 */
function cleanPathOf(fp, aiRoot, packagesRoot) {
  const n = path.normalize(String(fp));
  const aiN = path.normalize(aiRoot);
  if (!n.startsWith(aiN)) return null;
  const rel = n.slice(aiN.length).replace(/^[\\/]+/, "");
  const parts = rel.split(path.sep);
  const pkg = parts.shift();
  const cand = path.join(packagesRoot, pkg, "package", ...parts);
  return fs.existsSync(cand) ? cand : null;
}

/** 按 ALL_PATCHES 顺序在一份干净树上跑全部补丁，返回零改动且无 marker 的补丁。 */
function gapsFor(version, clean, install) {
  const targets = core.targetFiles(clean.ai);
  const vfs = new Map();
  for (const val of Object.values(targets)) {
    for (const fp of Array.isArray(val) ? val : [val]) {
      if (!fp) continue;
      const cf = cleanPathOf(fp, clean.ai, clean.packages);
      if (cf && !vfs.has(cf)) vfs.set(cf, fs.readFileSync(cf, "utf8"));
    }
  }
  if (vfs.size === 0) {
    throw new Error(`无法在 ${version} 上解析任何补丁目标文件（aiBase 布局没摆对）`);
  }

  const asLf = (s) => String(s).replace(/\r\n/g, "\n");
  const gaps = [];
  for (const p of core.ALL_PATCHES) {
    const keys = Array.isArray(p.file) ? p.file : [p.file];
    const markers = [...(Array.isArray(p.markers) ? p.markers : []), ...(p.marker ? [p.marker] : [])];
    let touched = 0, changed = 0, settled = false;
    for (const k of keys) {
      const val = targets[k];
      if (val == null) continue;
      for (const fp of Array.isArray(val) ? val : [val]) {
        if (!fp) continue;
        const cf = cleanPathOf(fp, clean.ai, clean.packages);
        if (!cf || !vfs.has(cf)) continue;
        touched++;
        const before = vfs.get(cf);
        if (markers.some((s) => asLf(before).includes(asLf(s)))) settled = true;
        const r = core.applyReplacementsToText(before, p, cf);
        if (r.changed) { vfs.set(cf, r.text); changed++; }
      }
    }
    if (touched && changed === 0 && !settled) gaps.push({ id: p.id, name: p.name, optional: !!p.optional });
  }
  return { gaps, resolved: vfs.size };
}

const [argA, argB] = process.argv.slice(2);
const versionA = argA || lowerBoundOfTarget();
const versionB = argB || latestVersion();
if (!versionA || !versionB) {
  console.error("用法: node scripts/check-anchors.mjs [旧版本] [新版本]");
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-anchors-"));
let tmpUsed = false;
try {
  process.stderr.write(`锚点体检: ${versionA} -> ${versionB}\n`);
  const cleanA = fetchVersion(versionA, tmp); tmpUsed = true;
  const cleanB = versionB === versionA ? cleanA : fetchVersion(versionB, tmp);

  const resA = gapsFor(versionA, cleanA, true);
  const resB = versionB === versionA ? resA : gapsFor(versionB, cleanB, true);

  const idA = new Set(resA.gaps.map((g) => g.id));
  const newly = resB.gaps.filter((g) => !idA.has(g.id));
  const line = (g) => `  #${String(g.id).padStart(3)}  ${g.name.padEnd(36)} ${g.optional ? "[软]" : "[强]"}`;

  console.log(`\n== ${versionA} 缺口 (${resA.gaps.length}，已解析目标文件 ${resA.resolved}) ==`);
  for (const g of resA.gaps) console.log(line(g));
  console.log(`\n== ${versionB} 缺口 (${resB.gaps.length}，已解析目标文件 ${resB.resolved}) ==`);
  for (const g of resB.gaps) console.log(line(g));
  console.log(`\n== ${versionB} 新增缺口 (${newly.length}) ==`);
  for (const g of newly) console.log(line(g));

  let code = 0;
  if (newly.length) {
    const hard = newly.filter((g) => !g.optional);
    console.log(
      `\n结论：${versionB} 上有 ${newly.length} 条补丁锚点失效`
      + (hard.length ? `，其中 ${hard.length} 条是强锚点（必须补变体）` : "（均为软补丁，可择机补）")
      + "。补法：在对应 patch 的 replacements 数组末尾追加一条针对新文案的候选变体，不要改既有条目。",
    );
    code = hard.length ? 1 : 0;
  } else {
    console.log(`\n结论：${versionB} 上无新增锚点缺口。`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(code);
} catch (error) {
  if (!tmpUsed) fs.rmSync(tmp, { recursive: true, force: true });
  console.error(`锚点体检失败: ${error?.message || error}`);
  process.exit(2);
}
