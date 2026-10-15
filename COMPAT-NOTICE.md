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
本续作**只做一件事：让上游最后版本继续在新版 dsh 上正常工作**。全部改动都是增量的。

### 1. 合入上游三个未合并的修复 PR

上游明确说明「暂不收 issue / PR」，因此这三个已通过作者视角审阅、状态为
`mergeable=true / clean` 的修复一直没能并入。本续作按原提交原样 cherry-pick，
**保留原作者与原提交者身份**（commit author 未改写）：

| PR | 提交者 | 内容 |
| --- | --- | --- |
| [#119](https://github.com/YuJunZhiXue/dsh-purge/pull/119) | [@1723582064](https://github.com/1723582064) | `repairOfficialCliAfterUnpack` 存 `.bak` 漏 `await`，宿主 `fatal load failure` 退出（致命） |
| [#115](https://github.com/YuJunZhiXue/dsh-purge/pull/115) | [@lnuxe](https://github.com/lnuxe) | 兼容 `{{cwd}}` 变量未注册的 dsh 0.2.1-alpha.2（否则对话起不来） |
| [#110](https://github.com/YuJunZhiXue/dsh-purge/pull/110) | [@Minervaowl7](https://github.com/Minervaowl7) | 停用时交还默认预设指针；卸载清理认 `dsh.profile.bundles` |

### 2. 补齐 dsh 0.2.1-alpha.3 的锚点漂移

补丁体系按“字面锚点”匹配官方源码，官方一改文案补丁就哑火。逐条比对
`0.2.0-rc.2` 与 `0.2.1-alpha.3` 的官方源码后，需要补锚点的只有以下几处，
**全部采用「追加候选变体」写法，未改动任何既有补丁条目**：

| 补丁 | 锚点漂移原因 | 处理 |
| --- | --- | --- |
| `#26 MINIMAL_PERSONA_PURGE` | 官方 minimal 预设里 `persistent-shell` 前多了 `tool-fs` 段 | 追加一条以 `tool-fs` 收尾的变体 |
| `#32 WEB_SURFACE_IDENTITY_NEUTRAL` | `DSH_WEB_URL` 描述由 `Canonical local URL` 改为 `Advertised URL` | 追加两条变体（描述行 + 注释行） |
| `#40 COMPLETE_PROMPT_KEEP_INJECT` | 官方在 `return` 前新增 `requiredContexts`，`contexts` 语义变化 | 追加一条变体，原样保留 `requiredContexts` 语义 |
| `#77 REWIND_DROP_SENT_ON_APPEND` | `this.revised.clear()` 改为 `if (this.revised.size > 0) this.revised.clear()` | 追加一条变体 |
| `#53 WEB_SURFACE_PROHIBITION` | 官方已删除 `Do not start a replacement server…` 整段 | **无需处理**（官方删除 = 该补丁目的自动达成） |

`package.json` 的 `dshTarget` 由钉死单版本 `0.2.0-rc.2` 放宽为
`>=0.2.0-rc.2 <0.3.0-0`，继续只覆盖 dsh 0.2 线，不宣称支持 0.1.x。

### 3. 新增锚点体检脚本（增量、可选运行）

`scripts/check-anchors.mjs`：从 npm 拉官方干净源码，逐条验证 82 个补丁的锚点是否
还打得进去，输出失效清单。上游缺的正是这个——`optional: true` 的补丁锚点失效时
**静默跳过**，界面不会报错，用户只会觉得「这功能怎么没了」。

```sh
node scripts/check-anchors.mjs                        # 默认对比当前 dshTarget 下限与 latest
node scripts/check-anchors.mjs 0.2.0-rc.2 0.2.1-alpha.3
```

---

## 三、本续作明确**不做**的事 / Explicit non-goals

- **不提供、不分发、不新增提示词。** 上游 issue [#27](https://github.com/YuJunZhiXue/dsh-purge/issues/27) 已明确「不再提供提示词，提示词自己寻找」，并把明文提示词从 git 与 npm 双排除（`.gitignore` / `.npmignore`）。本续作沿用该决定：只维护插件引擎与补丁体系，提示词由使用者自行放入 `$DSH_HOME/prompt-inject.md`。
- **不重构补丁引擎。** 所有兼容性改动均为「追加候选变体」，既有补丁条目、既有 marker、既有回滚链（`.dshpurge.bak`）行为不变。
- **不改动原作者的任何声明性内容**：`LICENSE`、`docs/notice/*`（违规商用公示证据）、README 的署名与违规商用章节、`docs/redteam-upstream-*` 全部原样保留。
- **不主张接管上游。** 上游写的是「恢复维护时会在本 README 说明」，即作者留有回来的余地。若上游恢复维护，本仓库应让位。

---

## 四、与上游的关系 / Relationship to upstream

```
上游 master 6c1d638  ←  本续作的全部提交都落在它之后
        │
        ├── cherry-pick #119 / #115 / #110（原作者提交，身份未改写）
        └── 锚点增量 + dshTarget 放宽 + 体检脚本 + 本声明
```

除上述内容外，本仓库与上游逐字节一致。任何时刻都可以用
<https://github.com/YuJunZhiXue/dsh-purge> 或全量镜像
<https://github.com/mmparko/dsh-purge>（含 73 个原版 tag 与 issue/PR 存档）核对差异。

---

*English summary: This repository is a compatibility continuation of YuJunZhiXue/dsh-purge,
based on upstream master `6c1d638`. It cherry-picks three unreleased upstream fix PRs
(#119, #115, #110), adds anchor variants for dsh 0.2.1-alpha.3 compatibility, widens
`dshTarget` within the 0.2 line, and ships an anchor health-check script. All original
attribution, the MIT LICENSE, and the non-commercial terms remain in force. No prompts are
distributed (per upstream issue #27). Changes are additive only — no refactors.*
