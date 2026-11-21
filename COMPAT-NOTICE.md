# 资产保留与适配说明（COMPAT-NOTICE）

本仓库是 **dsh-purge 的续作**，做两件事：**把上游删掉的东西放回来**，以及**让它跑在最新版 DeepSeek Harness 上**。

## 一、血缘：一次换库，两次换人

| 阶段 | 仓库 | 说明 |
| --- | --- | --- |
| 原始 | `YuJunZhiXue/dsh-purge` | 原作者「叫我小杨同学」。2026-09-18 的 issue #27 声明不再提供提示词，1.1.73 删除 `skills/` 与知识库。仓库已 404，git 历史、issue、release 无法恢复。 |
| 官方接续 ① | `HunYiSage/dsh-purge` | 官方发布到 **1.1.90**，仓库已 404。 |
| 官方接续 ② | `HandlerOne01/dsh-purge` | 以 1.1.90 官方发布包重建，发布 **1.1.91**（2026-11-10）后未再更新。**本续作的代码基线就是它。** |
| 本仓库 | `Fire-Phoenixs/dsh-purge` | 在 1.1.91 基础上恢复资产、适配 0.2.2-rc.5、修上游 bug。 |

原作者与两任上游维护者的版权、NOTICE、商用限制全部保留，见 [LICENSE](./LICENSE)、[NOTICE](./NOTICE)、[LICENSE-COMMERCIAL.md](./LICENSE-COMMERCIAL.md)。

## 二、恢复了什么

### 1. 红队技能库 `skills/redteam/`（40 个）

上游 1.1.73 删掉了 `skills/` 整个目录，但**加载逻辑一直没删**：`lib/index.js` 仍会把包内 `skills/redteam/*.md` 同步到 `$DSH_HOME/redteam/skills`，`presets/redteam/*.yml` 的 `skill-filesystem` 仍指向该目录。所以把文件放回去即可生效，不需要改代码。

- **原作者 23 个**：信息收集、资产梳理、漏洞扫描、隧道（suo5/frp/chisel）、凭据攻击、横向移动、WebShell、未授权利用等，使用原仓库恢复出的原文，未做改写。
- **吸纳 17 个**：来自满血版 `CallMeGuLab/dsh-purge-safe`（Apache-2.0 衍生）——AD 攻击、云与 K8s、C2 基建、供应链、社工与移动端、OOB 验证、OpSec、得分覆盖、专项路径等。署名见下文。

### 2. 提示词原文与运行槽

- `lib/default-prompt-inject.zh.md`（25,727 字节）、`.en.md`（29,427 字节）、`.history.md` 三份原文保留。
- **运行槽已升级**：上游 1.1.74 起把提示词原文放回了仓库，但**从未重新 embed 进 `lib/asset-table.js`**——上游 1.1.91 实际注入的仍是旧英文稿 `[MODE: UNRESTRICTED SANDBOX — STABLE]`（25,127 字节）。本仓库按上游脚本 `scripts/embed-default-prompt.mjs` 重新生成槽，注入的是新版中文稿 `[OPERATION: STABLE]`（25,727 字节），与原文逐字节一致。
- 重新生成槽的方法（修改提示词后）：

```bash
cp lib/default-prompt-inject.zh.md lib/default-prompt-inject.md
node scripts/embed-default-prompt.mjs
rm lib/default-prompt-inject.md
```

## 三、适配了哪些新版宿主行为（0.2.2-rc.5）

上游 1.1.91 只在 0.2.1 线验证过。0.2.2 改的不只是文案，还有包的位置：

| 补丁 | 0.2.2 的变化 | 本续作的处理 |
| --- | --- | --- |
| #62 审批 fail-open | `serviceAsk` 从 `dsh-tools/lib/index.js` 搬到 `lib/pipeline.js`，deny 改成 `approvalDenial(..., APPROVAL_UNAVAILABLE)` | 新增 `dsh-tools-pipeline` / `-types` 键，补 3+3 条候选 |
| #60 run_code 文案 | PTC 执行器拆成独立包 `dsh-tool-executor-ptc` | 新增对应键，pattern 逐字保留 |
| #54 交付物提示词 | 拆成独立包 `dsh-deliverable-file-references` | 新增键，pattern 逐字保留 |
| #67 loop 守卫 | 代码被包进 `try`，缩进 +1 | 追加 5 tab 候选 |
| #74 assemble 前置 | `assemble` 挪进 `try`、改多行对象参数 | 追加新候选 |
| #40 complete prompt 保注入 | assemble 返回值新增 `tools` | 追加 rc.5 专用候选 |
| #17 观测豁免 | `editIntent` 委托 `requirePresent` | 追加新候选 |
| #12 审批 ask 句 | 回到 `Approval prompts are enabled in this session: ...` | 追加双/单引号两条候选 |
| #56 / #77 rewind UI | 会话客户端被压缩成单行 | 追加压缩态回退锚点（取自社区版实测命中） |
| #18 重复工具提醒 | post-execute 不再分 block/accept | 追加新候选 |
| #13 / #14 / #34 / #35 沙箱升级 | 升级失败改抛 `SandboxEscalationError`、`displayReason` 抽成函数 | 追加 rc.3+ 写法候选 |

新增的 `targetFiles` 键都**与旧键并存**：旧宿主用旧键、新宿主用新键，靠候选锚点按原文自动择一命中，不写死版本号。

### 新增 `partialOk` 口径

上游 1.1.91 让「漂移」压过「已应用」：多文件补丁里只要有一份文件对不上就整体报 drifted。这对「功能整体搬到新包」的补丁会误报。本续作给 #54 / #60 / #62 显式标记 `partialOk`：**旧包零命中 + 新包写成功 → 记为 applied**；旧包、新包都对不上时仍然报 drifted。默认行为不变。

## 四、修了上游一个真 bug

上游 1.1.91 新增的 #92 `DESKTOP_HOST_EXIT_TRACE` / #93 `DESKTOP_MAIN_EXIT_TRACE` 是**插入型补丁**：`pattern` 在产物里仍然存在，却缺少 `insertProbe` 守卫，而 `applyPatches` 每轮都会无条件跑一遍替换。结果是**每点一次「应用」，代码就多插一段**：

- #92：121 → 635 → 1,149 → 1,663 字节 …
- #93：70 → 1,703 → 3,336 → 4,969 字节 …

本续作给两条补丁补上 `insertProbe`（与 #42 / #53 同一机制），第二次起 `changed=false`，并加了「连续 apply 3 次，第 2/3 次必须不变」的回归测试。

## 五、吸纳来源与署名

| 来源 | 吸纳内容 | 方式 |
| --- | --- | --- |
| 满血版 `CallMeGuLab/dsh-purge-safe` v2.0.1（Apache-2.0） | 17 个红队技能；0.2.2 锚点写法参考 | 技能文件整体引入并在本文件署名；锚点按 0.2.2-rc.5 原文重写验证 |
| 社区版 `kingcharleslzy-ai/dsh-purge` 1.7.20（MIT） | 压缩版会话客户端的回退锚点（#56 / #77） | 锚点直接采用，按 rc.5 产物实测命中 |
| 官方 1.1.91（HandlerOne01） | 全部代码基线 | 未改写业务逻辑，改动集中在补丁候选表与 targetFiles |

上述来源的版权与许可声明分别归其各自作者；本仓库的分发不对它们作出任何额外授权，商用仍须按原作者要求申请。

## 六、验证结果

- **锚点体检**（0.2.2-rc.5 官方包闭包，325 个包）：起始 12 条死锚 → 0 条死锚、0 条漂移；剩余 5 条为 `optional` 软补丁（宿主已移除对应功能或属第三方插件文件）。
- **全流程**（备份 → 应用 → 再应用 → 回滚）：应用 57 + 5 条；第二次应用 0 文件漂移；回滚后 16,973 个文件逐字节一致。
- **真实桌面宿主**（本机 0.2.2-rc.1，45 个内置包）：应用 62 条，回滚 0 不一致，幂等 0 漂移。
- **单元测试**：11/11 通过（`node test/<file>.test.js` 逐个跑；`node --test` 在受限环境会因 spawn EPERM 失败）。

## 七、发布前需要替换的字段（给二次 fork）

本仓库已把下列字段指向 `Fire-Phoenixs/dsh-purge`。你若再 fork，记得改回自己的地址，否则安装与更新会指回本仓库：

| 位置 | 字段 |
| --- | --- |
| `package.json` | `repository.url`、`homepage`、`bugs.url`、`dsh.install.{tarball,zip,git}` |
| `README*.md` | 安装命令与 `dsh://plugin/install` 一键安装链接 |
| `.github/workflows/release.yml` | 发版仓库门 `if: github.repository == ...` |
| `lib/update.js` | `REPO` |
| `client.js` | 欢迎页 `welcome.repo` |
| `lib/redteam/ui.js` | 面板默认仓库回退值 |
