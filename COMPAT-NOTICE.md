# 资产保留说明（COMPAT-NOTICE）

本仓库是 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)（原作者：叫我小杨同学）的**续作 / 资产保留版**。
原作者在 2026-09-18 的 issue #27 中声明不再提供提示词，并在 2026-10-23 的「1.1.73: open-source local-lab only; drop skills and knowledge base」提交中删除了随包技能库与知识库。

本仓库在不改动原作者声明与署名要求的前提下，做两件事：

1. **跟随上游功能更新**：代码基线始终对齐上游 `master`（当前 `v1.1.86`），上游修什么、加什么，这里就同步什么。
2. **保留被删除的资产**：把上游已从仓库删除、但插件代码仍然支持的内容放回来，让它继续可用。

## 保留了哪些被删内容

### 1. 红队技能库 `skills/redteam/`（23 个技能）

上游 1.1.73 删除了 `skills/` 整个目录，但**加载逻辑并没有删**：

- `lib/index.js` 仍会把包内 `skills/redteam/*.md` 同步到 `$DSH_HOME/redteam/skills`；
- `lib/redteam/skill-availability.js` 仍以「本包 `skills/redteam`」作为候选技能根；
- `presets/redteam/agent.cordis.yml` 的 `skill-filesystem` 仍配置了 `!!js dshHomePath('redteam/skills')`。

也就是说，把技能文件放回原位，插件会自动同步并加载，不需要改任何代码。

包含：信息收集、资产梳理、漏洞扫描、隧道（suo5/frp/chisel）、凭据攻击、横向移动、WebShell、未授权利用等 23 份操作稿。

### 2. 默认提示词原文 `lib/default-prompt-inject.zh.md` / `.en.md`

- 上游从 1.1.74 起把提示词原文重新放回仓库（`.zh.md` 25,727 字符，`.en.md` 29,427 字符，另有 `.md.bak` 历史版）；
- 但上游的加密槽 `lib/asset-table.js` 最后一次生成停在 1.1.73，**新版提示词从未被 embed 进运行槽**——也就是说上游用户实际注入的仍是旧版 `[MODE: UNRESTRICTED SANDBOX]` 英文稿，只修了一个拼写；
- 本仓库保留这两份原文。若要让运行时真正用上新版提示词，执行：

```bash
cp lib/default-prompt-inject.zh.md lib/default-prompt-inject.md
node scripts/embed-default-prompt.mjs
rm lib/default-prompt-inject.md
```

`lib/default-prompt-inject.md` 是 embed 的输入文件，按上游 `.gitignore` 约定不进仓库。

### 3. 知识库

上游 1.1.73 同步删除了知识库（演练台的 nuclei 模板知识页依赖本机 `knowledge.db` 与模板路径）。本仓库不附带模板数据，`knowledge.db` 仍由各人环境适配页自行配置。

## 署名与权利

- 原始代码、原始提示词、项目名称、思路的一切权利与署名均归原作者 **YuJunZhiXue（叫我小杨同学）**。
- 上游 `LICENSE`（Apache-2.0）、`NOTICE`、`LICENSE-COMMERCIAL.md` 及 README 中的署名要求、违规商用公示、法律免责声明**全部原样保留**，任何二次开发同样适用。
- 本项目非盈利公益性质，严禁任何主体用于商业售卖、付费倒卖或黑灰产牟利，仅供技术参考与授权范围内的安全评测。

## 发布前必须替换的字段

本仓库从上游复制时保留了上游的仓库地址。建立你自己的仓库后，需要把这些字段改成新地址，否则安装与更新会指回原作者：

| 位置 | 字段 |
| --- | --- |
| `package.json` | `repository.url`、`homepage`、`bugs.url` |
| `package.json` | `dsh.install.tarball`、`dsh.install.zip`、`dsh.install.git` |
| `README.md` / `README.zh-CN.md` | 安装命令里的 tarball 链接 |
| `.github/workflows/release.yml` | 发版仓库门 `if: github.repository == ...` |
