#!/usr/bin/env node
/**
 * 锚点体检 / anchor health check.
 *
 * dsh-purge 的补丁按「字面锚点」匹配官方源码：官方一改文案，锚点就哑火。
 * optional 的补丁失效时是静默跳过，界面不报错，用户只会觉得「这功能怎么没了」。
 * 这个脚本把那份静默变成一份可读的清单。
 *
 * 用法：
 *   node scripts/check-anchors.mjs                           # 对比 dshTarget 下限与 npm latest
 *   node scripts/check-anchors.mjs 0.2.0-rc.2 0.2.1-alpha.3   # 指定两个版本
 *
 * 退出码：
 *   0  无新增锚点缺口，且这次检查的数据是完整的
 *   1  有强锚点在较新版本上失效（需要补锚点变体）
 *   3  检查**不可信**：关键包下载/解压失败，或必要目标消失 —— 绝不能当成「通过」
 *
 * 设计要点（都是踩过的坑）：
 * - 必须区分「该版本确实没有这个包」（registry 404）与「网络/HTTP/解压失败」。
 *   前者是信息，后者会让整次检查失去意义；后者必须失败退出，不能输出「无新增缺口」。
 * - 判定有效性看的是**必要目标是否齐全**，不是「解析到了几个文件」。
 *   只保留一个无关目标时仍然报 gaps: [] 是曾经的漏报来源。
 * - 不依赖外部 tar/curl：tgz 用 node:zlib 自解，下载按 curl → wget → fetch 依次尝试，
 *   Windows / Linux / macOS 都能跑。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// 官方包里与补丁目标相关的候选清单。某版本没有某个包是正常的（404），
// 不算失败；但下载/解压**出错**会让检查不可信，必须失败。
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

const QUIET = process.env.CHECK_ANCHORS_VERBOSE !== "1";
const note = (msg) => { if (!QUIET) process.stderr.write(msg); };

// ────────────────────────── tgz 解析（无外部依赖） ──────────────────────────

/** 读 tar 头里的 C 字符串（以 NUL 结尾，允许尾部空格）。 */
function cstr(buf, start, len) {
  const slice = buf.subarray(start, start + len);
  const end = slice.indexOf(0);
  return (end === -1 ? slice : slice.subarray(0, end)).toString("utf8").trim();
}

/**
 * 解一个 npm 包的 .tgz（gzip + ustar），返回 [{ path, data }]。
 * npm 包路径都短，只需处理普通 ustar 头与 pax 的 path 覆盖；
 * 目录项（type 5）跳过，内容由文件项自建父目录。
 */
export function readTarGz(buf) {
  const tar = zlib.gunzipSync(buf);
  const files = [];
  let off = 0;
  let pendingPath = null;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = cstr(header, 0, 100);
    const size = parseInt(cstr(header, 124, 12), 8) || 0;
    const type = String.fromCharCode(header[156] || 48);
    const prefix = cstr(header, 345, 155);
    const dataStart = off + 512;
    const dataEnd = dataStart + size;
    const next = dataStart + Math.ceil(size / 512) * 512;

    if (type === "x" || type === "g") {
      // pax 扩展头：只有 path 需要，其余（mtime/uid…）忽略。
      const body = tar.subarray(dataStart, dataEnd).toString("utf8");
      const m = body.match(/(?:^|\n)\d+ path=([^\n]+)\n/);
      if (m) pendingPath = m[1];
      off = next;
      continue;
    }
    let full = prefix ? `${prefix}/${name}` : name;
    if (pendingPath) { full = pendingPath; pendingPath = null; }
    // type "0" 与 "\0" 都是普通文件；"5" 是目录。
    if ((type === "0" || type === "\0" || header[156] === 0) && size >= 0 && dataEnd <= tar.length) {
      files.push({ path: full, data: tar.subarray(dataStart, dataEnd) });
    }
    off = next;
  }
  return files;
}

/** 把 tar 项落到磁盘（npm 包以 `package/` 为前缀，直接按原样展开）。 */
function extractTarGz(buf, dest) {
  const files = readTarGz(buf);
  if (!files.length) throw new Error("tgz 里没有任何文件项");
  for (const f of files) {
    const rel = f.path.replace(/^\/+/, "");
    if (!rel || rel.includes("..")) continue;         // 防目录穿越
    const target = path.join(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.data);
  }
  return files.length;
}

// ────────────────────────── 下载（跨平台） ──────────────────────────

/**
 * 下载到文件。返回 { state, status, bytes, error }：
 *   ok      下载成功
 *   absent  registry 明确返回 404（该版本确实没有这个包）
 *   error   网络/HTTP/工具失败 —— 检查数据不完整
 */
export function downloadToFile(url, dest) {
  const attempts = [];
  // curl：尊重 http_proxy/https_proxy 环境变量，Windows 10+ 与各 *nix 都自带。
  attempts.push(() => {
    const out = execFileSync("curl", ["-sS", "-L", "--max-time", "60", "-o", dest, "-w", "%{http_code}", url], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return Number(String(out).trim());
  });
  // wget：老一点的环境常见。
  attempts.push(() => {
    try { fs.rmSync(dest, { force: true }); } catch { /* ignore */ }
    execFileSync("wget", ["-q", "-O", dest, url], { stdio: "pipe", timeout: 60000 });
    return 200;
  });

  const errors = [];
  for (const run of attempts) {
    try {
      const status = run();
      if (status === 404) return { state: "absent", status };
      if (status >= 200 && status < 300) {
        const bytes = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
        if (!bytes) return { state: "error", status, error: "下载得到空文件" };
        return { state: "ok", status, bytes };
      }
      errors.push(`HTTP ${status}`);
    } catch (e) {
      // 工具缺失（ENOENT）也走下一个候选；网络错误记下来。
      errors.push(String(e?.message || e).split("\n")[0]);
    }
  }
  return { state: "error", error: errors.join(" | ") };
}

export function latestVersion() {
  const tmp = path.join(os.tmpdir(), `dsh-purge-latest-${process.pid}.json`);
  const r = downloadToFile("https://registry.npmjs.org/@deepseek-ai/dsh", tmp);
  if (r.state !== "ok") throw new Error(`取 npm latest 失败：${r.error || r.state}`);
  const meta = JSON.parse(fs.readFileSync(tmp, "utf8"));
  fs.rmSync(tmp, { force: true });
  return meta["dist-tags"]?.latest ?? Object.keys(meta.versions).pop();
}

export function lowerBoundOfTarget() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const m = String(pkg.dshTarget || "").match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return m ? m[0] : null;
}

/**
 * 拉一个版本的全部官方包，摆成 aiBase 布局（ai/<pkg> → <pkg>/package），
 * 返回 { ai, packages, fetch: [{pkg,state,error}] , errors: [...] }。
 */
export function fetchVersion(version, dest, { pkgs = PKGS } = {}) {
  const base = path.join(dest, version);
  const ai = path.join(base, "ai");
  const packages = path.join(base, "packages");
  fs.mkdirSync(ai, { recursive: true });
  fs.mkdirSync(packages, { recursive: true });

  const report = [];
  for (const name of pkgs) {
    const sub = path.join(packages, name);
    const pkgJson = path.join(sub, "package", "package.json");
    if (fs.existsSync(pkgJson)) { report.push({ pkg: name, state: "cached" }); continue; }

    fs.rmSync(sub, { recursive: true, force: true });
    fs.mkdirSync(sub, { recursive: true });
    const tgzPath = path.join(sub, "pkg.tgz");
    const url = `https://registry.npmjs.org/@deepseek-ai/${name}/-/${name}-${version}.tgz`;
    const dl = downloadToFile(url, tgzPath);
    if (dl.state === "absent") {
      fs.rmSync(sub, { recursive: true, force: true });
      report.push({ pkg: name, state: "absent" });
      continue;
    }
    if (dl.state !== "ok") {
      fs.rmSync(sub, { recursive: true, force: true });
      report.push({ pkg: name, state: "error", error: dl.error || `HTTP ${dl.status}` });
      continue;
    }
    try {
      extractTarGz(fs.readFileSync(tgzPath), sub);
      if (!fs.existsSync(pkgJson)) throw new Error("解出来的包里没有 package.json");
      report.push({ pkg: name, state: "ok" });
    } catch (e) {
      fs.rmSync(sub, { recursive: true, force: true });
      report.push({ pkg: name, state: "error", error: `解压失败: ${e?.message || e}` });
    }
    fs.rmSync(tgzPath, { force: true });
  }

  // 建 aiBase 链接（Windows 上用 junction，失败则整体复制）。
  for (const name of pkgs) {
    const link = path.join(ai, name);
    const src = path.join(packages, name, "package");
    if (!fs.existsSync(src) || fs.existsSync(link)) continue;
    try {
      fs.symlinkSync(src, link, "junction");
    } catch {
      fs.cpSync(src, link, { recursive: true });
    }
  }

  const errors = report.filter((r) => r.state === "error");
  note(`  ${version}: ok=${report.filter((r) => r.state === "ok" || r.state === "cached").length} absent=${report.filter((r) => r.state === "absent").length} error=${errors.length}\n`);
  return { version, ai, packages, fetch: report, errors };
}

// ────────────────────────── 目标解析与缺口计算 ──────────────────────────

/** 官方干净树里，某个已解析路径对应的文件；越界返回 null。 */
export function cleanPathOf(fp, aiRoot, packagesRoot) {
  const n = path.normalize(String(fp));
  const aiN = path.normalize(aiRoot);
  if (!n.startsWith(aiN)) return null;
  const rel = n.slice(aiN.length).replace(/^[\\/]+/, "");
  const parts = rel.split(path.sep);
  const pkg = parts.shift();
  const cand = path.join(packagesRoot, pkg, "package", ...parts);
  return fs.existsSync(cand) ? cand : null;
}

/**
 * 按 ALL_PATCHES 顺序在一份干净树上跑全部补丁，返回：
 *   gaps      零改动且无 marker 的补丁（= 锚点打不上）
 *   resolved  解析到的目标文件数
 *   keys      每个补丁 key 的解析结果（用于判断必要目标是否消失）
 */
export function gapsFor(clean, core) {
  const targets = core.targetFiles(clean.ai);
  const vfs = new Map();
  const keyState = new Map();     // key -> true(解析到) / false(没解析到)
  for (const [key, val] of Object.entries(targets)) {
    let any = false;
    for (const fp of (Array.isArray(val) ? val : [val])) {
      if (!fp) continue;
      const cf = cleanPathOf(fp, clean.ai, clean.packages);
      if (!cf) continue;
      any = true;
      if (!vfs.has(cf)) vfs.set(cf, fs.readFileSync(cf, "utf8"));
    }
    keyState.set(key, any);
  }

  const asLf = (s) => String(s).replace(/\r\n/g, "\n");
  const gaps = [];
  const keyUsage = [];            // 每条补丁用到哪些 key
  for (const p of core.ALL_PATCHES) {
    const keys = Array.isArray(p.file) ? p.file : [p.file];
    const markers = [...(Array.isArray(p.markers) ? p.markers : []), ...(p.marker ? [p.marker] : [])];
    let touched = 0, changed = 0, settled = false;
    const resolvedKeys = [];
    for (const k of keys) {
      const val = targets[k];
      if (val == null) continue;
      for (const fp of (Array.isArray(val) ? val : [val])) {
        if (!fp) continue;
        const cf = cleanPathOf(fp, clean.ai, clean.packages);
        if (!cf || !vfs.has(cf)) continue;
        touched++;
        if (!resolvedKeys.includes(k)) resolvedKeys.push(k);
        const before = vfs.get(cf);
        if (markers.some((s) => asLf(before).includes(asLf(s)))) settled = true;
        const r = core.applyReplacementsToText(before, p, cf);
        if (r.changed) { vfs.set(cf, r.text); changed++; }
      }
    }
    keyUsage.push({ id: p.id, name: p.name, optional: !!p.optional, keys, resolvedKeys, touched });
    if (touched && changed === 0 && !settled) {
      gaps.push({ id: p.id, name: p.name, optional: !!p.optional, touched, resolvedKeys });
    }
  }
  return { gaps, resolved: vfs.size, keyState, keyUsage };
}

/**
 * 目标覆盖对比。分三档，严重度不同：
 *
 *  gone    （严重）强锚点补丁在旧版**能**解析到目标、在新版**完全**解析不到。
 *           补丁连落脚点都没了，必须重新定位目标文件。
 *  partial （信息）补丁的**部分** key 在新版消失，但仍有 key 可解析。
 *           典型情形：官方删掉了一个组件（例如 dsh-user-approval 在 0.2.1-alpha.3
 *           移除了 ./invariant 导出与 lib/invariant.js）。补丁本身仍在工作，
 *           只是少了一个落点 —— 报出来供人确认，不阻塞 CI。
 *  never   （信息）两版都解析不到任何目标。第三方包未装（梁神）、桌面壳在
 *           npm 布局里不存在等情形，属环境相关，不是版本漂移。
 *
 * 判定只看**非 optional** 补丁：optional 补丁本来就可能因用户没装对应包而缺目标。
 */
export function compareCoverage(a, b) {
  const gone = [];
  const partial = [];
  const never = [];

  for (const rowA of a.keyUsage) {
    if (rowA.optional || !rowA.resolvedKeys.length) continue;
    const rowB = b.keyUsage.find((x) => x.id === rowA.id);
    if (!rowB) { gone.push({ ...rowA, keys: rowA.resolvedKeys, reason: "新版里该补丁已不存在" }); continue; }
    if (!rowB.resolvedKeys.length) {
      gone.push({ ...rowA, keys: rowA.resolvedKeys, reason: "新版完全解析不到目标" });
      continue;
    }
    const lost = rowA.resolvedKeys.filter((k) => !rowB.resolvedKeys.includes(k));
    if (lost.length) partial.push({ ...rowA, keys: lost, reason: "部分目标消失（补丁仍有落点）" });
  }

  for (const rowB of b.keyUsage) {
    if (!rowB.optional && !rowB.resolvedKeys.length && !rowB.touched) {
      const rowA = a.keyUsage.find((x) => x.id === rowB.id);
      if (!rowA || !rowA.resolvedKeys.length) never.push(rowB);
    }
  }
  return { gone, partial, never };
}

// ────────────────────────── 主流程 ──────────────────────────

export function evaluate({ versionA, versionB, fetchA, fetchB, resA, resB, coverage }) {
  const lines = [];
  const dataErrors = [...fetchA.errors.map((e) => ({ v: versionA, ...e })), ...fetchB.errors.map((e) => ({ v: versionB, ...e }))];
  const line = (g) => `  #${String(g.id).padStart(3)}  ${g.name.padEnd(36)} ${g.optional ? "[软]" : "[强]"}`;

  lines.push(`\n== ${versionA} 缺口 (${resA.gaps.length}，已解析目标文件 ${resA.resolved}) ==`);
  for (const g of resA.gaps) lines.push(line(g));
  lines.push(`\n== ${versionB} 缺口 (${resB.gaps.length}，已解析目标文件 ${resB.resolved}) ==`);
  for (const g of resB.gaps) lines.push(line(g));

  const idA = new Set(resA.gaps.map((g) => g.id));
  const newly = resB.gaps.filter((g) => !idA.has(g.id));
  lines.push(`\n== ${versionB} 新增缺口 (${newly.length}) ==`);
  for (const g of newly) lines.push(line(g));

  if (coverage.gone.length) {
    lines.push(`\n== 必要目标完全消失 (${coverage.gone.length}) ==`);
    for (const d of coverage.gone) {
      lines.push(`  #${String(d.id).padStart(3)}  ${d.name.padEnd(36)} ${d.reason}`);
      lines.push(`        丢失 key: ${d.keys.join(", ")}`);
    }
  }
  if (coverage.partial.length) {
    lines.push(`\n== 部分目标消失 (${coverage.partial.length}，补丁仍有落点，供确认) ==`);
    for (const d of coverage.partial) {
      lines.push(`  #${String(d.id).padStart(3)}  ${d.name.padEnd(36)} ${d.reason}`);
      lines.push(`        丢失 key: ${d.keys.join(", ")}`);
    }
  }
  if (coverage.never.length) {
    lines.push(`\n== 强锚点补丁两版都无目标 (${coverage.never.length}，环境相关，非版本漂移) ==`);
    for (const d of coverage.never) lines.push(`  #${String(d.id).padStart(3)}  ${d.name}`);
  }
  if (dataErrors.length) {
    lines.push(`\n== 检测数据不完整 (${dataErrors.length}) ==`);
    for (const e of dataErrors) lines.push(`  ${e.v}  ${e.pkg}: ${e.error}`);
  }

  // 数据不完整 → 这次检查不可信，绝不能输出「通过」。
  if (dataErrors.length) {
    lines.push(
      `\n结论：有 ${dataErrors.length} 个包未能取得（网络/HTTP/解压失败），本次检查数据不完整，`
      + `不能据此判定兼容性。请修复网络或代理后重跑。`,
    );
    return { exitCode: 3, lines, newly, dataErrors };
  }
  // 必要目标**完全**消失同样让结论不可信：补丁连落脚点都没有，谈不上「无缺口」。
  if (coverage.gone.length) {
    lines.push(
      `\n结论：${versionB} 上有 ${coverage.gone.length} 条强锚点补丁的目标完全消失。`
      + `目标不再存在说明官方布局变了，需要重新定位这些补丁的目标文件。`,
    );
    return { exitCode: 3, lines, newly, dataErrors, gone: coverage.gone };
  }
  if (newly.length) {
    const hard = newly.filter((g) => !g.optional);
    const partialNote = coverage.partial.length
      ? `；另有 ${coverage.partial.length} 条补丁部分目标消失（见上，不阻塞）`
      : "";
    lines.push(
      `\n结论：${versionB} 上有 ${newly.length} 条补丁锚点失效`
      + (hard.length ? `，其中 ${hard.length} 条是强锚点（必须补变体）` : "（均为软补丁，可择机补）")
      + partialNote
      + "。补法：在对应 patch 的 replacements 数组末尾追加一条针对新文案的候选变体，不要改既有条目。",
    );
    return { exitCode: hard.length ? 1 : 0, lines, newly, dataErrors };
  }
  const partialNote = coverage.partial.length
    ? `；有 ${coverage.partial.length} 条补丁部分目标消失（见上，补丁仍在工作，不阻塞）`
    : "";
  lines.push(`\n结论：${versionB} 上无新增锚点缺口，且本次检查数据完整${partialNote}。`);
  return { exitCode: 0, lines, newly, dataErrors };
}

async function main(argv) {
  const core = await import(pathToFileURL(path.join(ROOT, "lib", "core.js")).href);
  const [argA, argB] = argv;
  const versionA = argA || lowerBoundOfTarget();
  const versionB = argB || latestVersion();
  if (!versionA || !versionB) {
    console.error("用法: node scripts/check-anchors.mjs [旧版本] [新版本]");
    return 2;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-anchors-"));
  try {
    process.stderr.write(`锚点体检: ${versionA} -> ${versionB}\n`);
    const cleanA = fetchVersion(versionA, tmp);
    const cleanB = versionB === versionA ? cleanA : fetchVersion(versionB, tmp);

    const resA = gapsFor(cleanA, core);
    const resB = versionB === versionA ? resA : gapsFor(cleanB, core);
    const coverage = versionB === versionA
      ? { gone: [], partial: [], never: [] }
      : compareCoverage(resA, resB);

    const out = evaluate({ versionA, versionB, fetchA: cleanA, fetchB: cleanB, resA, resB, coverage });
    for (const l of out.lines) console.log(l);
    return out.exitCode;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 仅在直接执行时跑主流程；被 import 时只提供上面的纯函数供测试使用。
const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`锚点体检失败: ${e?.message || e}`);
      process.exit(2);
    });
}
