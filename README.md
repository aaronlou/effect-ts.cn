# Effect 中文社区（effect-ts.cn）

[![CI](https://github.com/aaronlou/effect-ts.cn/actions/workflows/ci.yml/badge.svg)](https://github.com/aaronlou/effect-ts.cn/actions/workflows/ci.yml)
[![上游同步](https://github.com/aaronlou/effect-ts.cn/actions/workflows/upstream-sync.yml/badge.svg)](https://github.com/aaronlou/effect-ts.cn/actions/workflows/upstream-sync.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](./LICENSE)

中文世界 Effect 的第一入口：**官方文档的高质量中文译站 + 内容社区 + 由 Effect 与 DDD 自建的开源标本**。

- 产品与技术规划见 **[PLAN.md](./PLAN.md)**；译者规范见 **[docs/translation-guide.md](./docs/translation-guide.md)**；
  上线步骤见 **[docs/deployment.md](./docs/deployment.md)**。
- 站点当前状态：**已具备公开发布条件**（内容 + 搜索 + RSS + llms.txt 全部为构建期产物，不依赖后端）。

## 快速开始

```bash
pnpm install

# 一条命令跑起前后端（Astro 前台 :4321 + Effect API :8787）
pnpm dev

# 可选：接入模型（不配也能完整运行 —— extractive 模式：检索合成 + 引用 + 拒答，零成本）
cp .env.example .env                      # 填 DEEPSEEK_API_KEY=sk-...（或 LLM_BASE_URL + LLM_API_KEY）
pnpm --filter @ecn/api llm:check          # 一条命令验证模型真的接上了（打印提供方/模型/超时）

# 可选：本地 Postgres（默认 InMemory 模式不需要它）—— 在 .env 里设置 DATABASE_URL 后：
pnpm db:up                                # docker 起 Postgres；或用本机 postgres 亦可
```

- 前台：<http://localhost:4321>（`/api/*` 已由 dev 代理到后端）
- 后端：<http://localhost:8787>
  - `GET  /api/health` 健康检查
  - `GET  /api/questions` 问题列表 / `POST /api/questions` 提问 / `GET /api/questions/:id` 详情
  - `GET  /openapi.json` 自动生成的 OpenAPI（来自 `@effect/schema` 契约）

### 常用命令

```bash
pnpm typecheck            # 全仓类型检查（含 astro check）
pnpm test                 # 各包测试（api: domain/application；content: 内容门禁）
pnpm build                # contracts 编译 + api typecheck + astro 构建
pnpm content:check        # 内容门禁：frontmatter / 路径镜像 / 术语 / 元数据残留（PR 必过）
pnpm content:status       # 译文同步状态扫描
pnpm corpus:build         # 生成 AI 知识层语料（内容改动后必跑；CI 有新鲜度门禁）
pnpm mcp                  # 启动 MCP Server（stdio），把中文知识接进编码 Agent
pnpm --filter @ecn/api llm:check   # 用真实模型跑一次问答+报错诊断（验证 DeepSeek/OpenAI 兼容配置）
# 上游相关（需先 clone 官方内容仓库；路径用绝对路径）
pnpm --filter @ecn/content exec tsx src/cli.ts snapshot --dir <上游docs> -o snap.json
pnpm --filter @ecn/content exec tsx src/cli.ts diff --snapshot /abs/snap.json --docs /abs/apps/site/src/content/docs
pnpm --filter @ecn/content exec tsx src/cli.ts nav --dir <上游docs> -o apps/site/src/data/docs-nav.json
```

## 站点具备什么

| 能力 | 说明 |
| --- | --- |
| 文档译站 | 目录**镜像官方结构**（v4 主线 + v3 并存），未翻译页面自动生成**占位页**（读英文原文 + 认领翻译），站内无死链 |
| 可追溯同步 | 每篇译文标注 `upstreamPath` + `upstreamCommit`；每日流水线比对上游，落后/导航漂移自动开 issue |
| 站内搜索 | `⌘/Ctrl + K`，构建期索引（已译文字全、未译页面标题），零后端依赖 |
| 订阅与 AI 友好 | `/rss.xml`、`/llms.txt`、`sitemap-index.xml`、`robots.txt` |
| 阅读体验 | 侧边栏（镜像官方）、页内 TOC、上下页、版本切换、代码块「复制 / Playground」、官方 `Aside/Steps/Tabs` 组件 |
| 内容门禁 | PR 阶段拦截：frontmatter 必填、路径镜像、术语黑名单、`twoslash`/框架 import 残留、页内锚点失效 |
| 社区协作 | 行为准则、Issue 模板（翻译认领 / 站点问题）、PR 自查清单、术语表页面 |
| **AI 知识层** | 「问这一页 / 问文档」（⌘I）与「报错诊断」（`/debug`）：答案**逐句带引用**（页面+小节+基线），无依据直接拒答，并区分"文档没有"与"中文尚未翻译"；术语门禁同样约束 AI 输出 |
| **Agent 接入** | HTTP `/api/knowledge/ask`、MCP Server（`pnpm mcp`）、`/llms.txt`、`/llms-full.txt`、`/docs/<slug>.md` |

## 目录速览

```
apps/site     Astro 前台（内容集合/MDX，React islands，SEO 优先；AskPanel 问这一页）
apps/api      Effect 后端（@effect/platform HTTP，DDD 洋葱分层；含 Knowledge/Assistant 上下文）
apps/mcp      中文知识层的 MCP Server（stdio，离线自包含）
packages/knowledge  检索与答案合成（BM25F-lite、中文分词、话题归属、引用不变量）
packages/contracts  前后端共享 Effect Schema DTO + 错误码（Schema-first）
packages/content    内容管线 CLI（门禁校验 / 上游快照与 stale 比对 / 导航生成）
infra/        docker-compose（本地 Postgres）
docs/         译者指南、部署指南、术语黑名单
PLAN.md       产品与技术规划（含 DDD 设计与路线图）
```

## 技术栈与为什么

| 层 | 选型 | 一句话理由 |
|---|---|---|
| 前台 | Astro + React islands | 与官方 effect.website 同思路：内容/SEO 最优、默认零 JS |
| 后端 | Effect + `@effect/platform` | 类型化错误、显式依赖、结构化并发 —— dogfood |
| 契约 | `@effect/schema` | 一份 Schema → DTO + 类型 + OpenAPI，前后端零重复 |
| 数据 | PostgreSQL（`@effect/sql-pg`） | 关系模型 + 未来中文全文检索（pg_jieba） |
| 测试 | Vitest + Effect Test 思想 | 金字塔：domain → application → 集成 |

**后端 DDD 要点**（详见 PLAN §5）：
- 限界上下文：`Identity / Publishing / QnA / Curation / Notification`（Moderation 先内嵌）
- 每个上下文是垂直切片：`domain / application / infrastructure / interfaces`
- 端口（仓储/ID/事件）定义在 domain，适配在 infrastructure，用 Layer 一键替换
- 领域错误用 `Data.TaggedError`，wire 错误用 `@effect/schema` 的 `Schema.TaggedError`（在 interfaces 层完成映射）

> **Layer 可移植性的活例子**：同一个 `QuestionRepository` 端口，`bootstrap/main.ts` 按
> `DATABASE_URL` 是否存在，在 InMemory 仓储与 Postgres 仓储之间切换 —— 这就是依赖倒置 + DI 容器。
> 测试里也用 Layer 注入确定性 ID 与内存仓储。

### CI 与上游同步（“同步即信誉”自动化）

- `.github/workflows/ci.yml`：内容门禁 → `typecheck` → `test` → `build`。
- `.github/workflows/upstream-sync.yml`：每日定时（可手动触发）克隆**官方内容仓库
  `Effect-TS/website` 的 `apps/web/src/content/docs`**（官方文档真正的源 —— `Effect-TS/effect`
  仓库里并没有 `docs/`）→ 生成上游快照 → 比对译文落后 → 检查导航漂移 →
  自动开/更新 `upstream-sync` 标签的 issue。

本地可复用同一套能力：`packages/content` 的 `snapshot` / `diff` / `nav` / `check` 子命令。

## 公开发布清单

- [x] 内容：14 篇中文译文（新手黄金路径 Start Here 3/3 + Getting Started 7/7，另有错误管理 / 并发 / 依赖管理）
- [x] 可追溯同步：基线标注 + 每日比对 + 落后告警
- [x] 阅读闭环：镜像侧边栏、TOC、上下页、版本切换、未翻译占位页（无死链）
- [x] 体验：站内搜索（⌘K）、RSS、`llms.txt`、robots、sitemap、404、canonical/OG
- [x] 质量门禁：内容门禁（CI）+ 全仓 typecheck/test/build
- [x] 信任与协作：LICENSE、行为准则、Issue/PR 模板、术语表、非官方声明
- [x] 部署：静态托管步骤 + API 容器化（[docs/deployment.md](./docs/deployment.md)）
- [ ] 待办：官方 API 参考中文化；`<Tabs>` 交互切换；社区功能（Phase 2）

## 里程碑

- [x] Phase 0 · 地基：monorepo、Astro 壳、Effect/DDD 后端骨架、契约、CI
- [x] Phase 1 · 内容为主：镜像官方结构的译站、内容管线、门禁与自动化、首屏阅读体验
- [ ] Phase 1.5 · 内容扩充：Onboarding 之后的核心 Guides（错误管理、并发、Schema…）
- [ ] Phase 2 · 社区功能：身份认证、问答/评论、审核、通知
- [ ] Phase 3 · 增长：案例库、活动日历、全文检索（分词）、自托管 Playground

## 指向

- 官方站点：<https://effect.website/> · 官方内容仓库：<https://github.com/Effect-TS/website>
- 译者指南：[docs/translation-guide.md](./docs/translation-guide.md) · 部署指南：[docs/deployment.md](./docs/deployment.md)
- AI-Native 产品设计（Agent 时代的知识层）：[docs/ai-native.md](./docs/ai-native.md)
- Agent 接入指南（MCP / HTTP / 静态 .md）：[docs/agent-integration.md](./docs/agent-integration.md)
- 行为准则：[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) · 许可：[LICENSE](./LICENSE)
