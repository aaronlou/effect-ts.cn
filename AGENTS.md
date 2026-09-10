# AGENTS.md —— 给编码 Agent 的仓库契约

> 面向 Claude Code / Cursor / DSH 等编码 Agent：读完这一份，你应该能**一次做对这个仓库的改动**。
> 人类贡献者请看 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [docs/translation-guide.md](./docs/translation-guide.md)。

## 这个仓库是什么

Effect 中文社区站（effect-ts.cn）。三件事同时成立：

1. **官方文档的中文译站** —— 内容在 `apps/site/src/content/docs/`，目录**镜像官方** `v3/`、`v4/` 结构；
2. **可溯源的中文知识层** —— 检索 + 引用 + 拒答，同时服务人和 Agent（HTTP / MCP / 静态 `.md`）；
3. **Effect + DDD 的开源标本** —— `apps/api` 本身就是教材，分层被当作示范。

## 动手之前：三条硬约束

1. **依赖方向单向**：`apps/api/src/contexts/*/domain/` **不得** import `infrastructure/` 或 `interfaces/`。
2. **代码块与上游逐字节一致**。译文只翻译代码块之外的行；上游的工具元数据（`twoslash`、`name="..."`、`showLineNumbers`）必须剥掉，框架 import（`@astrojs/starlight`）必须删掉，但 `<Aside>` / `<Steps>` / `<Tabs>` / `<TabItem>` **标签保留**（本站有同名实现）。
3. **核心术语保留英文**：`Effect` / `Layer` / `Fiber` / `Schema` / `Stream` / `defect` / `Effect.gen`。禁用译法见 `docs/glossary.json`，命中即 CI 失败。

## 改完之后：必须跑的门禁

```bash
pnpm content:check     # 译文 frontmatter / 路径镜像 / 术语 / 元数据残留
pnpm typecheck         # 全仓（含 astro check）
pnpm test              # knowledge / content / mcp / api
pnpm build             # contracts 编译 + api typecheck + astro 构建
```

**只要改了译文或博客正文，追加这一步**（否则 CI 的"语料新鲜度"门禁会失败）：

```bash
pnpm build            # 1) 构建页面（引用锚点从构建产物提取）
pnpm corpus:build     # 2) 重建语料（引用摘要 + 内容指纹）
pnpm build            # 3) 再构建一次，让 /cite/* 反映新语料
git add packages/knowledge/data/corpus.json
```

> 第 3 步不能省：`corpus` 的锚点来自构建产物，而 `/cite/<digest>.json` 由语料驱动 ——
> 这是一个往返依赖。只改正文、没增删标题时，`pnpm corpus:build && pnpm build` 一趟即可。

CI 还会跑五个**产物级**门禁，本地可自行复核：

| 门禁 | 命令 | 作用 |
| --- | --- | --- |
| 语料新鲜度 | 见 CI | 语料必须与内容一致 |
| 代码块一致性 | `pnpm --filter @ecn/content exec tsx src/cli.ts code:check --upstream <上游docs> [--docs <译文目录>] [--proposals .proposals]` | 译文/提案的代码块与上游**逐字节**一致、`##`/`###` 标题数量一致（只留语言标记，Expressive Code 注解视为元数据） |
| 引用协议 | `pnpm cite:check` | 引用摘要 / 内容指纹 / `/cite/*` 与语料一致（引用可解引用） |
| 提案队列 | `pnpm proposals:check` | `.proposals/` 内的提案合规（治理不变量 + 同一道内容门禁） |
| 静态检索 | 见 CI | 构建产物必须答对 5 个金标问句、对 2 个无关问句无结果 |
| 引用锚点 | 见 CI | 每个引用锚点都能在构建产物里点到 |

## 常见任务 → 动哪些文件

| 任务 | 动作 |
| --- | --- |
| 新增/更新一篇译文 | 在 `apps/site/src/content/docs/<version>/<path>.mdx` 建文件，路径必须镜像 `upstreamPath`；frontmatter 见下节；然后 `pnpm build && pnpm corpus:build` |
| 改检索 / 答案 / 拒答 | `packages/knowledge/src/`（纯函数、零运行时依赖）。改完必须 `pnpm test`：有 recall@3 金标、引用不变量、两条拒答路径的断言 |
| 加一个 HTTP 接口 | 契约先进 `packages/contracts/src/`（`@effect/schema`），再在 `apps/api/src/interfaces/http/api.ts` 声明，实现放对应 `GroupLive` |
| 加一个 MCP 工具 / 资源 | `apps/mcp/src/server.ts` 的 `TOOLS` / `RESOURCES` / `PROMPTS`，并补 `apps/mcp/test/mcp.test.ts` |
| 改社区入口、群聊链接 | 只改 `apps/site/src/data/community.ts`（唯一事实来源），**不要**在各页面硬编码链接 |
| 内容同步 / 判断是否落后上游 | `packages/content` CLI：`status` / `snapshot` / `diff` / `nav` / `check` / `corpus` / `cite:check` / `proposals:*` |

## 译文 frontmatter（必填）

```mdx
---
title: 中文标题
status: reviewing            # pending | translating | reviewing | published | stale
upstreamPath: v4/.../x.mdx   # 必须与本地路径一致，且存在于 docs-nav.json
upstreamCommit: <40 位小写 hex>  # 翻译时对照的上游 commit
translators: [你的标识]
reviewers: []                # status=published 时必须非空
---
```

## 两条"Agent 不许做"的规则

1. **不许把 `status` 写成 `published`，也不许给自己填 `reviewers`。** 发布由人类维护者决定。
2. **未经人工审阅的内容不得进入主分支。** 你起草的译文 / FAQ / 术语提案一律走**提案队列**：

```bash
# 1) 写提案（模板见 .proposals/_template.translation.json）
# 2) 自检（会套用与人工投稿完全相同的门禁规则）
pnpm --filter @ecn/content exec tsx src/cli.ts proposals:check
```

提案里 `status` 只能是 `reviewing` / `translating`，`reviewers` 必须为空 —— 这两条是校验器强制的。

## 别做的事

- ❌ 不要发明中文术语（宁可保留英文 + 一句解释）。术语表可提案修订，但要走 PR。
- ❌ 不要为了让测试变绿而放宽断言 —— 测试断言的是**能力**（必须答对 / 必须拒答），不是缺陷。数据不对就修数据。
- ❌ 不要引入 Discord 等海外 SNS：本社区只提供中文读者可用的渠道（微信群 / GitHub）。
- ❌ 不要把模型记忆当事实来源。任何 AI 答案的引用必须来自检索结果，`citations` 为空即拒答。

## 消费这个站（而不是改它）

你要是想**用**这份中文知识，而不是改这个仓库：

- **MCP（推荐，离线自包含）**：`pnpm mcp`，工具 `search_docs` / `get_page` / `ask` / `cite` / `glossary` / `translation_status`
- **HTTP**：`POST /api/knowledge/ask`、`POST /api/knowledge/explain`、`GET /api/knowledge/stats`
- **静态**：`/llms.txt`、`/llms-full.txt`、`/docs/<slug>.md`
- **引用可验证**：答案里的每条引用都带 `citationId` 与 `citeUrl`（`/cite/<digest>.json`），可独立核对引用是否为原文子串、以及译文基线是否已漂移

接入细节见 [docs/agent-integration.md](./docs/agent-integration.md)。
