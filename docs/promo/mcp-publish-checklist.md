# MCP server 发布清单

包已**完全准备好**，只差你的 npm 凭据。以下按顺序执行即可。

- 包名：`effect-ts-cn-mcp`
- 注册表名：`io.github.aaronlou/effect-ts-cn`
- 版本：`0.1.0`
- 产物：`dist/cli.js`（零依赖单文件，语料内联，压缩后 1.3MB）

> ⚠️ **顺序不能反**：MCP 注册表只托管元数据、不托管产物，
> 它要求 npm 上先有包；文章里的 `npx` 也一样。
> 所以**先 npm publish，再提交注册表，最后发文章**。

---

## 第 1 步：发布到 npm

```bash
pnpm mcp:publish              # 推荐：自动处理目录与 npm 日志目录两个坑
# 或者
cd apps/mcp && npm publish
```

**这个账号开了 2FA，所以发布时要带一次性验证码**（实测报 403
`Two-factor authentication or granular access token with bypass 2fa enabled is required`）：

```bash
pnpm mcp:publish --otp=123456     # 你验证器上的 6 位数字
```

想以后不用每次输：去 npm 建一个 **granular access token**（勾上 *bypass 2FA*），
放进 GitHub Secrets，就能让 CI 在打 tag 时自动发布。

`pnpm mcp:publish` 这个包装脚本解决两个**都会让人以为"包有问题"**的失败模式：

| 失败 | 现象 | 真正原因 |
| --- | --- | --- |
| 目录不对 | `ENOENT .../apps/package.json` | 少 `cd` 了一层，报错完全看不出来 |
| npm 日志目录不可写 | `Log files were not written` + 失败 | `~/.npm` 混进了 root 所有的文件，与包无关。根治：`sudo chown -R 501:20 ~/.npm` |

发布前建议先 dry-run 看一眼产物：

```bash
pnpm mcp:pack                     # = npm publish --dry-run
```

它应当列出 **4 个文件**：`dist/cli.js`(7.8MB)、`package.json`、`server.json`、`README.md`，
且 `dependencies` 是**空的** —— 这个包把一切打进产物，声明任何运行时依赖都会让 `npx` 解析失败。

发完立刻验证（在**空目录**里跑，模拟别人的环境）：

```bash
cd /tmp && npx -y effect-ts-cn-mcp
# 应往 stderr 打一行：已启动：提供 search_docs / get_page / ask / glossary / ...
# Ctrl-C 退出
```

出问题时的回退：**72 小时内可以 `npm unpublish effect-ts-cn-mcp@0.1.0`**，之后只能发新版本。

---

## 第 2 步：提交到官方 MCP Registry

注册表还在 preview 阶段，规范可能变；以 [官方 quickstart](https://modelcontextprotocol.org/registry/quickstart) 为准。

```bash
# 装 CLI（macOS/Linux）
brew install mcp-publisher        # 或从 GitHub releases 下载

# 认证（GitHub 方式，需要你的 GitHub 账号）
mcp-publisher login github

# 发布（server.json 已在 apps/mcp/ 下准备好）
cd apps/mcp
mcp-publisher publish
```

`server.json` 与 `package.json` 里的 `mcpName` **必须一致**（都已是 `io.github.aaronlou/effect-ts-cn`）——
这是注册表验证"这个 npm 包确实属于你"的方式，不一致会直接拒绝。

---

## 第 3 步：聚合站（它们的收录量比官方注册表大）

官方注册表的数据会被下面这些聚合，但**很多聚合站也接受直接提交**，而且它们各自的流量更大：

| 站点 | 提交方式 | 备注 |
| --- | --- | --- |
| [Glama](https://glama.ai/mcp/servers) | 自动索引 GitHub | 把仓库加上 `mcp` topic，通常几天内自动出现 |
| [Smithery](https://smithery.ai) | 网页提交 / CLI | 需要仓库可访问 |
| [PulseMCP](https://www.pulsemcp.com) | 网页提交 | 人工审核，会看 README 质量 |
| [mcp.so](https://mcp.so) | 网页提交 | 中文项目相对少，是个差异点 |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | GitHub PR | 按分类加一行，见下 |

**给 awesome-mcp-servers 的 PR 条目**（放进 Documentation / Knowledge 类）：

```markdown
- [aaronlou/effect-ts.cn](https://github.com/aaronlou/effect-ts.cn) 📇 ☁️ 🏠 - MCP server for the Chinese translation of the official Effect documentation (234 pages, v3 + v4). Every result carries a verifiable citation: it links back to the exact section and records which upstream commit the translation was based on.
```

> 先确认该列表当前的分类名与图标约定，格式以仓库 CONTRIBUTING 为准。

---

## 现成文案（各站提交时可直接用）

**一句话（tagline，≤ 60 字）**

```
Effect 官方文档的中文译文检索，每条结果都可核验
```

**短描述（≤ 160 字）**

```
检索 Effect（TypeScript 的 effect system）官方文档的中文译文，共 234 页（v3 + v4）。
每条结果都带可点回原文小节的引用，并记录该译文对着哪次上游提交译的。零依赖、离线自包含。
```

**长描述（英文，给海外聚合站）**

```
An MCP server for the Chinese translation of the official Effect documentation
(effect.website) — 234 pages covering both v3 and v4.

Unlike asking a model about a library from its training data, every result comes
from the actual corpus and carries a verifiable citation: the exact section
anchor, the upstream commit the translation was based on, and a JSON record you
can open to check the quoted text.

Zero dependencies, fully offline (the corpus is bundled into the artifact).
```

**分类标签**

```
documentation, knowledge-base, typescript, effect, chinese, i18n, offline
```

---

## 第 4 步：发文章

`docs/promo/ai-mcp-article.md`（《别再问 AI「这个库怎么用」了，把文档喂给它》）。
**必须在第 1 步之后**，否则读者照着 `npx` 会拿到 404。

---

## 之后的版本更新

改了语料或工具逻辑之后：

1. `apps/mcp/package.json` 与 `server.json` 的 `version` **同时**升号（两处必须一致）
2. `npm publish`
3. `cd apps/mcp && mcp-publisher publish`

注册表**不允许改已发布版本的元数据**，只能发新版本 —— 所以升号那一步别忘。
