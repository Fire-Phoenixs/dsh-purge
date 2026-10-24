# 兼容性续作声明 / Compatibility Continuation Notice

本仓库是 **[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)** 的
**兼容性续作（compatibility continuation）**，不是重写、不是分叉改名、不主张任何原创性。

---

## 一、署名 / Attribution

| 项 | 内容 |
| --- | --- |
| 上游项目 | **dsh-purge — DeepSeek Harness 破甲** |
| 原作者 | **YuJunZhiXue**（[@YuJunZhiXue](https://github.com/YuJunZhiXue)） |
| 上游仓库 | <https://github.com/YuJunZhiXue/dsh-purge> |
| 续作起点 | 上游 `master` @ `6c1d638`（`docs: 暂停更新说明`，2026-10-12） |
| 许可证 | **MIT**，`LICENSE` 原样保留、未做任何改动 |
| 原始资产 | 提示词、补丁体系、红队演练台（`lib/redteam`）、22 个 `skills/redteam` 技能、`docs/notice` 违规商用公示截图 —— **一切权利与署名均归原作者** |

上游 README 的「[署名要求](https://github.com/YuJunZhiXue/dsh-purge#署名要求)」在本仓库继续生效：
**借用本项目的名称、思路、代码或提示词，必须署名并写明来源仓库。**
**非盈利条款同样沿用：不得用于卖课、卖插件、卖 token、倒卖等收费行为。**

---

## 二、本续作做了什么 / What this continuation changes

上游在 2026-10-12 公告：*「不再发版、暂不收 issue / PR，也不保证跟进新版 dsh」*。
本续作**只做一件事：让上游最后版本继续在指定版本的 dsh 上正常工作**。当前钉住
**dsh 0.2.1-rc.3**；改动集中在锚点与版本范围上，不重构补丁引擎、不改原作者声明。

### 1. 合入上游三个未合并的修复 PR

上游明确说明「暂不收 issue / PR」，因此这三个已通过作者视角审阅、状态为
`mergeable=true / clean` 的修复一直没能并入。本续作按原提交原样 cherry-pick，
**保留原作者与原提交者身份**（commit author 未改写）：

| PR | 提交者 | 内容 |
| --- | --- | --- |
| [#119](https://github.com/YuJunZhiXue/dsh-purge/pull/119) | [@1723582064](https://github.com/1723582064) | `repairOfficialCliAfterUnpack` 存 `.bak` 漏 `await`，宿主 `fatal load failure` 退出（致命） |
| [#115](https://github.com/YuJunZhiXue/dsh-purge/pull/115) | [@lnuxe](https://github.com/lnuxe) | 兼容 `{{cwd}}` 变量未注册的 dsh 0.2.1-alpha.2（否则对话起不来） |
| [#110](https://github.com/YuJunZhiXue/dsh-purge/pull/110) | [@Minervaowl7](https://github.com/Minervaowl7) | 停用时交还默认预设指针；卸载清理认 `dsh.profile.bundles` |

### 2. 钉住 dsh 0.2.1-rc.3，删除多版本兼容层

补丁体系按“字面锚点”匹配官方源码，官方一改文案补丁就哑火。此前为了横跨多个版本，
每条补丁在 `replacements` 数组里堆了若干候选变体，还配了一套跨版本自动体检脚本。
本版把范围收回到**单一版本**，把「兼容」当成一条要长期供养的分支砍掉：

- **锚点收敛到 rc.3**：21 条补丁里共删除 59 个候选变体（原本给 0.1.5 / 0.1.7 / 0.2.0 / 0.2.1-alpha 等旧版本准备），这些候选在 0.2.1-rc.3 官方源码上全部零命中。现在每条补丁只保留在 rc.3 上实测命中的锚点；命中判定用顺序模拟（后一个候选可能匹配前一个候选的产物）。
- **删掉五条只为旧版本/旧文案服务的补丁**（补丁总数 82 → 77）：`#21 BASH_TIMEOUT_RESTORE` 只用于把更早版本插件写坏的 `timeoutMs: 600000` 改回 60000；`#80 MINIMAL_OFFICIAL_TOOLSET` 只用于撤掉更早版本插件往 minimal 预设里加的 fs/web 工具；`#50 SESSION_REFERENCE_FRAMING_NEUTRAL` 想把跨会话引用改回 0.1.7 的 untrusted 措辞，而 rc.3 原文本已是 untrusted；`#53 WEB_SURFACE_PROHIBITION` 的两段目标文案官方在 rc.3 已删除/改写；`#88 HUNG_PROMPT_STRICT_NEEDLE` 只补一个 `[dsh-purge-88]` 标记，严格针逻辑已并入 `#87`。这五条在干净的 rc.3 官方源码上命中数都是 0 —— 它们服务的是旧版插件留下的脏值或旧版文案，不是 rc.3 源码。
- **`dshTarget` 钉成 `>=0.2.1-rc.3 <0.2.2-0`**（原为 `>=0.2.0-rc.2 <0.3.0-0`），不再宣称覆盖整个 0.2 线。
- **取消「兼容」分组**：`#40 COMPLETE_PROMPT_KEEP_INJECT` 的 layer 从「0.1.5 兼容」改回「提示词」，`#47 ANTHROPIC_OAUTH_NO_CLAUDE_IDENTITY`、`#49 ANTHROPIC_OAUTH_CLI_NEUTRAL` 的 layer 从「0.2.0 兼容」改到「代码」；`client.js` 里对应的分组文案、层名映射与 `GROUP_ORDER` 一并删除，补丁分组只剩 提示词 / 代码 / 工具（外加引擎）。
- **不再静默跳过**：目标文件读到、锚点对不上，状态由 `skipped` 改为 `unmatched`（界面显示「没对上」），`applyPatches` 的汇总状态同步改为 `unmatched`。

#### rc.3 复核结果

1.1.72 记录的 5 条锚点漂移，在 rc.3 上复核如下：

| 补丁 | 1.1.72 的漂移 | rc.3 复核 |
| --- | --- | --- |
| `#26 MINIMAL_PERSONA_PURGE` | minimal 预设里 `persistent-shell` 前多了 `tool-fs` 段 | 已收敛进唯一候选（该锚点为 rc.3 唯一命中） |
| `#32 WEB_SURFACE_IDENTITY_NEUTRAL` | `DSH_WEB_URL` 描述由 `Canonical local URL` 改为 `Advertised URL` | 已收敛进唯一候选 |
| `#40 COMPLETE_PROMPT_KEEP_INJECT` | 官方在 `return` 前新增 `requiredContexts`，`contexts` 语义变化 | 已收敛进唯一候选 |
| `#77 REWIND_DROP_SENT_ON_APPEND` | `this.revised.clear()` 改为 `if (this.revised.size > 0) this.revised.clear()` | 已收敛进唯一候选 |
| `#53 WEB_SURFACE_PROHIBITION` | 官方已删除 `Do not start a replacement server…` 整段 | 该段落官方早已删除，补丁无需存在 |

- 验证口径：以 npm 上 `@deepseek-ai/dsh@0.2.1-rc.3` 的依赖闭包建树（291 个官方包），解析出 50 个补丁目标文件，把 77 条补丁按顺序全部跑一遍——**0 条锚点缺口**，无新增失效；再用 `patchStatus` 在干净树上端到端复核，状态只剩 `pending` / `applied` / `missing_file` / `na`，没有 `unmatched`。
- 发行源整体切到本仓库一节不变，见下一节。

### 3. 发行源切到本仓库（安装 / 更新不再依赖上游）

上游已公告暂停维护并可能删库。原版的安装与更新链路全部指向上游，一旦上游消失，
存量用户的更新检查就会断在这里。本续作把**发行链路**整体切到本仓库：

| 位置 | 原值 | 现值 |
| --- | --- | --- |
| `package.json` `dsh.install.{tarball,zip,git}` | `YuJunZhiXue/dsh-purge` | `Fire-Phoenixs/dsh-purge` |
| `package.json` `repository` / `homepage` / `bugs` | 上游 | 本仓库 |
| `lib/update.js` `REPO` | `YuJunZhiXue/dsh-purge` | `Fire-Phoenixs/dsh-purge` |
| `lib/redteam/ui.js` 默认仓库兜底 | 上游 | 本仓库 |
| `client.js` 内用户须知里的源码链接 | 上游 | 本仓库（**另加一行**署名链接指向上游） |
| `.github/workflows/release.yml` 发版仓库门 | 上游 | 本仓库 |
| README 全部安装 / 唤起 / clone / tarball / Releases 链接 | 上游 | 本仓库 |

**署名性质的上游链接一律保留、不替换**：`LICENSE` 来源、README「署名要求」章节、
违规商用公示、`docs/redteam-upstream-*`、以及新增的 `upstream` 徽章与
`welcome.originRepo` 指向 —— 这些是许可与署名的依据，不是发行入口。

上游 73 个 tag 已全部同步到本仓库，`lib/update.js` 的版本列表（走
`api.github.com/repos/<REPO>/tags`）与下载（走 `codeload.github.com/<REPO>`）
因此都落在本仓库，不依赖上游 Releases。

### 4. 不做跨版本自动体检

1.1.72 曾附带一个锚点体检脚本 `scripts/check-anchors.mjs`（连同测试
`tests/test-p2-check-anchors.mjs`、`release.yml` 里的 “Anchor health check (non-blocking)” 步骤、
`package.json` 的 `check-anchors` script 入口）：从 npm 拉多个版本的官方源码逐条比对锚点。
本版**全部移除**——跨版本自动比对正是这次要删掉的自动检测：它让「到底支持哪个版本」
始终含糊，也让文档不得不跟着每个版本漂。

如需自行核对某个宿主，方法就写在文档里、不依赖任何脚本：以 npm 上
`@deepseek-ai/dsh@0.2.1-rc.3` 的依赖闭包建一棵干净的树，把全部补丁按 `ALL_PATCHES` 顺序跑一遍，
报出「零改动且无 marker」的补丁即可。

---

## 三、本续作明确**不做**的事 / Explicit non-goals

- **不提供、不分发、不新增提示词。** 上游 issue [#27](https://github.com/YuJunZhiXue/dsh-purge/issues/27) 已明确「不再提供提示词，提示词自己寻找」，并把明文提示词从 git 与 npm 双排除（`.gitignore` / `.npmignore`）。本续作沿用该决定：只维护插件引擎与补丁体系，提示词由使用者自行放入 `$DSH_HOME/prompt-inject.md`。
- **不重构补丁引擎。** 补丁条目、marker 与回滚链（`.dshpurge.bak`）的行为不变；锚点只收敛到 rc.3 实测命中的候选，不新增猜测性变体。
- **不改动原作者的任何声明性内容**：`LICENSE`、`docs/notice/*`（违规商用公示证据）、README 的署名与违规商用章节、`docs/redteam-upstream-*` 全部原样保留。
- **不冒充原作者**：发行源换成自己的仓库，但署名义务指向上游；用户须知里同时给出本仓库（安装/更新）与原仓库（署名/许可）两个链接，不制造「这是原作者新仓库」的误导。
- **不主张接管上游。** 上游写的是「恢复维护时会在本 README 说明」，即作者留有回来的余地。若上游恢复维护，本仓库应让位。

---

## 四、与上游的关系 / Relationship to upstream

```
上游 master 6c1d638  ←  本续作的全部提交都落在它之后
        │
        ├── cherry-pick #119 / #115 / #110（原作者提交，身份未改写）
        └── 锚点钉死 rc.3 + dshTarget 收紧 + 删除多版本兼容层 + 本声明
```

除上述内容外，本仓库与上游逐字节一致。任何时刻都可以用
<https://github.com/YuJunZhiXue/dsh-purge> 或全量镜像
<https://github.com/mmparko/dsh-purge>（含 73 个原版 tag 与 issue/PR 存档）核对差异。

---

*English summary: This repository is a compatibility continuation of YuJunZhiXue/dsh-purge,
based on upstream master `6c1d638`. It cherry-picks three unreleased upstream fix PRs
(#119, #115, #110) and pins the anchors to **dsh 0.2.1-rc.3** only
(`dshTarget: >=0.2.1-rc.3 <0.2.2-0`): 59 old multi-version candidate variants dropped,
the five legacy-only patches #21 / #80 / #50 / #53 / #88 removed, the “compat” patch group
retired, and the cross-version anchor health-check script deleted, because automatic
cross-version comparison is exactly what this release stops doing. Anchors were verified
against the pristine rc.3 sources — 291 official packages, 50 patch target files, 77
patches, zero gaps. All original attribution, the MIT LICENSE, and the non-commercial terms remain in
force. No prompts are distributed (per upstream issue #27). No refactors.*
