# Effect 中文社区（effect-ts.cn）

中文世界 Effect 的第一入口：**官方文档的高质量中文译站 + 内容社区 + 由 Effect 与 DDD 自建的开源标本**。

- 产品与内容结构规划见 **[PLAN.md](./PLAN.md)**（内容结构 / 代码组织 / 技术选型 / DDD 设计 / 路线图）。
- 本仓库当前为 **Phase 0：可运行骨架**（见 PLAN §7）。

## 快速开始

```bash
pnpm install

# 一条命令跑起前后端（Astro 前台 :4321 + Effect API :8787）
pnpm dev

# 可选：本地 Postgres（默认 InMemory 模式不需要它）
cp apps/api/.env.example apps/api/.env   # 然后设置 DATABASE_URL
pnpm db:up                               # docker 起 Postgres；或用本机 postgres 亦可
```

- 前台：<http://localhost:4321>（`/api/*` 已由 dev 代理到后端）
- 后端：<http://localhost:8787>
  - `GET  /api/health` 健康检查
  - `GET  /api/questions` 问题列表
  - `POST /api/questions` 提问（`{title, body, tags}`）
  - `GET  /api/questions/:id` 问题详情
  - `GET  /openapi.json` 自动生成的 OpenAPI（来自 `@effect/schema` 契约）

### 常用命令

```bash
pnpm typecheck            # 全仓类型检查
pnpm test                 # 各包测试（api: domain/application；content: 内容门禁）
pnpm build                # contracts 编译 + api typecheck + astro 构建
pnpm content:check        # 内容门禁：frontmatter / 路径镜像 / 术语 / 元数据残留（PR 必过）
pnpm content:status       # 译文同步状态扫描
# 上游相关（需先 clone 官方内容仓库，路径用绝对路径）
pnpm --filter @ecn/content exec tsx src/cli.ts snapshot --dir <上游docs> -o snap.json
pnpm --filter @ecn/content exec tsx src/cli.ts diff --snapshot /abs/snap.json --docs /abs/apps/site/src/content/docs
pnpm --filter @ecn/content exec tsx src/cli.ts nav --dir <上游docs> -o apps/site/src/data/docs-nav.json
```

## 目录速览

```
apps/site     Astro 前台（内容集合/MDX，React islands，SEO 优先）
apps/api      Effect 后端（@effect/platform HTTP，DDD 洋葱分层）
packages/contracts  前后端共享 Effect Schema DTO + 错误码（Schema-first）
packages/content    内容管线 CLI（译文状态扫描，后续 sync/stale 比对）
infra/        docker-compose（本地 Postgres）
PLAN.md       产品与技术规划（含 DDD 设计与路线图）
```

## 技术栈与为什么

| 层 | 选型 | 一句话理由 |
|---|---|---|
| 前台 | Astro + React islands | 官方 effect.website 同思路：内容/SEO 最优、默认零 JS |
| 后端 | Effect + `@effect/platform` | 类型化错误、显式依赖、结构化并发 —— dogfood |
| 契约 | `@effect/schema` | 一份 Schema → DTO + 类型 + OpenAPI，前后端零重复 |
| 数据 | PostgreSQL（`@effect/sql-pg`） | 关系 + 未来中文全文检索（pg_jieba） |
| 测试 | Vitest + Effect Test 思想 | 金字塔：domain → application → interfaces → 集成 |

**后端 DDD 要点**（详见 PLAN §5）：
- 限界上下文：`Identity / Publishing / QnA / Curation / Notification`（Moderation 先内嵌）
- 每个上下文是垂直切片：`domain / application / infrastructure / interfaces`
- 端口（仓储/ID/事件）定义在 domain，适配在 infrastructure，用 Layer 一键替换
- 领域错误用 `Data.TaggedError`，wire 错误用 `@effect/schema` 的 `Schema.TaggedError`（anti-corruption 在 interfaces 层完成映射）

> **Layer 可移植性的活例子**：同一个 `QuestionRepository` 端口，`bootstrap/main.ts` 按
> `DATABASE_URL` 是否存在，在 InMemory 仓储与 Postgres 仓储之间切换 —— 这就是
> 依赖倒置 + DI 容器。测试里也用 Layer 注入确定性 ID 与内存仓储。

### CI 与上游同步（“同步即信誉”自动化）

- `.github/workflows/ci.yml`：PR/push 触发，校验 `typecheck` / `test` / `build`。
- `.github/workflows/upstream-sync.yml`：每日定时（可手动触发）克隆**官方内容仓库
  `Effect-TS/website` 的 `apps/web/src/content/docs`**（官方文档真正的源 —— `Effect-TS/effect`
  仓库里并没有 `docs/`，只有 `ai-docs/` 等）→ 生成上游快照 → 比对本地译文 →
  落后清单写入 `stale-report.json` 并自动开/更新 `upstream-sync` 标签的 issue，@相关译者。

本地即可复用同一套能力：`packages/content` 的 `snapshot` 与 `diff` 子命令
（见 README 上方“常用命令”）。

## 里程碑（当前：Phase 0）

- [x] Phase 0 · 地基：monorepo 脚手架、Astro 壳、Effect/DDD 后端骨架、契约、CI 就绪
- [ ] Phase 1 · 内容为王：Onboarding 全量精译、官方 Blog 译站、周刊创刊
- [ ] Phase 2 · 社区功能：身份认证、问答/评论、审核、通知
- [ ] Phase 3 · 增长：案例库、活动日历、全文搜索、自托管 Playground

## 指向

- 官方站点：<https://effect.website/>
- 官方仓库：<https://github.com/Effect-TS/effect>
- 本文档（可追溯翻译）模型：见 [`docs/translation-guide.md`](./docs/translation-guide.md)
