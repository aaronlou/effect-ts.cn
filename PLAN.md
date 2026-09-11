# Effect 中文社区（effect-ts.cn）产品与技术规划

> 状态：规划 v1 · 目标读者：共建者 / 开发者
> 参照物：<https://effect.website/>（官方，Astro 内容站，v4 RC 主线 + v3 并存）、Effect 生态仓库（Effect-TS/effect 等）
> 本规划回答三件事：**内容结构**（产品）、**代码组织**（工程）、**开发框架**（技术栈 + DDD 后端设计）。

---

## 0. 一句话定位

**做中文世界「Effect 的第一入口」：官方文档的中文高质量译站 + 围绕 Effect 的内容与问答社区 + 由 Effect 自己驱动的工程示范。**

不是"把英文站翻译一遍"，而是：
- **可追溯地同步**官方（内容带上游 commit，漂移可查）；
- **内容分层**：该人工精译的（Onboarding/核心 Guides）精译，该机器辅助的（API Reference）就低成本覆盖；
- **是社区不是仓库**：问答、投稿、周刊、活动、案例是增值点；
- **Dogfooding**：网站本身就是 Effect + DDD 的教学标本，读者看文档学到的架构，在这个站的源码里能"看到活的"。

### 差异化（为什么值得做）

| 对手/参照 | 现状 | 我们的不同 |
|---|---|---|
| effect.website | 英文，面向全球 | 中文母语内容、中文场景案例、中文问答、时区友好的活动 |
| 已存在的纯翻译镜像站（如 effect-ts-zh-website） | 静态文档镜像，缺工程化同步与社区 | 上游 hash 同步 + 覆盖率仪表盘 + 问答/投稿/周刊等社区功能 + 全文搜索 |
| 散落的掘金/知乎/公众号文章 | 无体系、易过时、无校对 | 有版本锚点、有术语表、有审校流程、集中收录 |

> **读本文前请先分清"目标"与"现状"**：§1–§8 描述**目标形态**；仓库里**真实存在**的东西见
> [§11 实现现状](#11-实现现状与代码同步滚动更新)。一句话概括：
> 骨架已按 §4 落地，但上下文与分层**尚未铺满**（只实现 QnA / Knowledge / Assistant 三个上下文，
> Identity / Publishing / Curation / Notification 未开工）；而 §10 的 AI 知识层
> （`apps/mcp`、`packages/knowledge`）是**提前兑现**，已超出 §7 Phase 1 的范围。

---

## 1. 产品内容结构（信息架构）

### 1.1 导航 IA（一级栏目）

```
首页 Home
├─ 为什么用 Effect（中文着陆页，官方首页内容的本地化演绎）
├─ 最新动态：版本发布速递 / 周刊摘选 / 近期讨论 / 翻译进度

文档 Docs（中文译站，主线随官方版本：v4 (rc) / v3 切换）
├─ Onboarding  新手路径（Getting Started 等）—— 精译优先区
├─ Guides      指南（错误管理 / 依赖 / 资源 / 可观测 / 调度 / 并发 /
│               Stream/Sink / Schema / Platform / 各生态包与集成）—— 按优先级分批精译
├─ Reference   API 参考（自动生成 + 机器辅助翻译 + 术语表注入，标注"非人工精译"）
└─ 翻译状态仪表盘（按版本/目录的覆盖率、同步滞后天数）

教程 Learn（中文原创路径，不抄官方）
├─ 系列课程：从 Promise 到 Effect / 从零写一个 Effect 服务（带 Playground 练习）
├─ 小抄 Cheat Sheets：Effect ↔ Promise / async-await 对照表
├─ 中文视频与 Workshop 回放（官方 + 社区录制，字幕索引）
└─ 实战范例库：可直接在 Playground 跑的中文注释示例

博客 Blog
├─ 译站（官方 Blog/Release 精选翻译，页面带原文链接与"翻译于 upstream@xxx"）
├─ 原创专栏（社区投稿，分类：实战 / 源码解读 / 踩坑 / 生态 / 中文团队案例）
└─ 周刊 Effect Weekly（定期聚合：Release、好文、热门问答、生态动态）

问答 Q&A（社区核心，参考 Stack Overflow 的克制版）
├─ 提问 / 回答 / 采纳 / 投票 / 标签
├─ 每个问题可"同步到 GitHub Discussion"（种子内容来自中文平台公开问答 / GitHub 精选）
└─ 代码块可一键 "在 Playground 运行"

案例 Showcase
├─ 生产案例（官方案例的本地化介绍 + 中文团队案例征集）
└─ 提交模板（背景 / 规模 / 踩坑 / 收益，Schema 校验）

社区 Community
├─ 群聊入口（微信群 / 群规）—— 中文社区只用中文可用的渠道，不透传海外 SNS
├─ 活动日历：线下聚会、Office Hours 中文场、直播字幕
├─ 贡献者榜 + 翻译贡献榜（数据透明，榜上有名是社区荣誉而非游戏化）
├─ 投稿 / 发起活动 / 上报案例 表单
└─ 行为准则（Code of Conduct）、审核规则

资源 Resources
├─ 术语表 Glossary（官方术语中英对照，社区可提案修订）
├─ 中文资料聚合（文章/视频/仓库，按版本与主题索引）
├─ 品牌与徽章（"Powered by Effect" 之类，随官方 brand assets 翻译版）
└─ 关于 / 版权 / 转载规范 / 隐私

搜索：站内全文搜索（Cmd/Ctrl + K），中文分词支持
```

### 1.2 内容类型与职责划分（谁负责、放哪里、如何判"过时"）

| 内容类型 | 形式/载体 | 所有权 | 生命周期与同步 |
|---|---|---|---|
| 官方文档翻译 | MDX，存 `packages/content/docs/**` | 社区翻译贡献者 + 审校人 | 每个文件 frontmatter 记录 `upstreamRepo/upstreamPath/upstreamCommit/translatedAt/status`；CI 比对上游改动 → 标 `stale` |
| API Reference | 生成 + 机翻草稿 | 脚本 + AI 辅助 | 跟随上游构建，仅术语/错误消息人工抽审 |
| 官方 Blog 译站 | MDX | 译站编辑 | 同上 hash 机制 |
| 原创投稿 | MDX + 元数据 Schema | 作者 + 编辑审校 | 有版本锚点（针对的 Effect 版本必填） |
| 周刊 | 程序生成骨架 + 编辑填肉 | 编辑轮值 | 定时任务提示生成，人工发布 |
| 问答/评论/投票 | 数据库（Postgres） | 社区用户 | 走 apps/api，举报/审核流程 |
| 案例 | 结构化 Schema + Markdown | 提交者 + 编辑 | 审核后发布 |

**翻译状态机**：`pending → translating → reviewing → published`；上游改动后自动降级为 `stale`（页面顶部显示"本页落后上游 N 个提交 / 译者：xxx"，附"去更新此页"按钮直达 GitHub）。

**术语策略**（taste 关键点）：核心术语**不翻译或首次出现时中英对照**——`Effect / IO / Stream / Fiber / Layer / Schema / Effect.gen / 副作用` 等。宁可保留英文术语 + 中文解释，也不要发明让人对不上官方文档的新词。术语表是公开可提案的（GitHub PR 驱动）。

### 1.3 与官方内容的关系（版权与署名）

- 翻译页顶部/底部显著标注：原文地址、原文 commit、译者与审校人、翻译遵循的许可（MIT，与官方一致）。
- 页面提供 `原文 ↗` 与 `本页在 GitHub 编辑` 双入口 —— 与官方"零漂移、可交叉跳转"。
- 官方 Logo/品牌严格按 [Logo guidelines](https://effect.website/brand-assets/) 使用；社区自有的视觉元素单独设计，避免混淆。

---

## 2. 产品体验原则（"这个时代的 taste"）

1. **内容 > 功能**：先把一篇文档做对，再谈社区功能。功能服务于"让中文用户更快学会、更好提问"。
2. **同步即信誉**：翻译质量的可信度来自可追溯性，任何一页都能说清"对着上游哪次提交译的"。
3. **代码永远可运行**：文档/回答/文章里的代码示例一律可复制、可"在 Playground 打开"（接入官方 Play 或自托管 runner），并尽量带 Try 链接。
4. **AI 时代友好**：站点提供 `llms.txt` / 可下载的纯文本子集，让中文 Effect 知识可被 LLM 检索（官方已有 LLM Guide 文化，中文站跟进）；文章结构清晰、无广告弹窗、尊重 RSS。
5. **Dogfood**：这个站的每个"社区功能"都是一节 DDD + Effect 的活教材；开源全部源码。
6. 细节：深色模式、Cmd+K 搜索、键盘可达、`<html lang="zh-CN">`、中文 SEO（含标题/描述/OG）、页面极轻（默认零 JS，交互用 islands）、RSS/Atom、链接检查与 404 兜底。

---

## 3. 技术选型与理由

> 约束：TypeScript + Node.js + Effect 生态；后端必须 DDD；同时要"有时代 taste"——即用成熟、可维护、利于内容社区的默认项，Effect 用在其最擅长的地方，而不是为了炫技。

| 维度 | 选择 | 理由 |
|---|---|---|
| 运行时 | Node.js ≥ 22（本机 v25 可开发），TypeScript strict | 官方支持矩阵内的 LTS |
| 包管理/仓库 | pnpm workspace monorepo | Effect 官方同款工程组织，依赖提升可控 |
| 编译/检查 | `tsc`（或可选 `tsgo` 提速）+ eslint 规则（参考 Effect 仓库自身的 [tsgo linter](https://github.com/Effect-TS/tsgo) 集） | 先保守后加速 |
| **前台站点** | **Astro**（内容集合 + MDX + 静态/SSR 混合 + 按需 islands） | 官方 effect.website 本身就是 Astro（`/_astro/*` 产物）；内容站 SEO、体积、Markdown 生态最优；社区交互用 React islands 局部注入，默认零 JS |
| 前台交互 | React 18/19 islands：搜索、Playground 运行器、投票/回答等小组件 | 与 Astro 官方推荐一致；避免重型 SPA |
| 文档渲染 | MDX + Shiki 代码高亮 + 自定义"运行示例"组件 | 代码体验是 Effect 站的灵魂 |
| **后端** | **Effect（v4/最新稳定）** + `@effect/platform`（Http/Server、Cookies）+ 自有 DDD 分层 | Dogfood + 类型安全全链路 |
| API 契约 | `@effect/schema` 定义 DTO，一份 Schema 前后端共享；生成 OpenAPI | 契约单源、客户端类型零手写（DDD 的 anti-corruption 层天然实现） |
| 数据库 | **PostgreSQL**（`@effect/sql-postgres`）+ SQL migration | 中文全文检索需要 `pg_jieba` 等分词；关系数据多；DDD 事务边界清晰。dev 用 docker compose |
| 认证 | GitHub OAuth + 服务端会话（Effect 服务） | 中文开发者 GitHub 覆盖率高；无密码存储负担 |
| 搜索 | 文档静态部分：Pagefind/MinSearch（前端零成本）；社区/问答部分：Postgres FTS（`pg_jieba`）；后续可升级 Meilisearch | 分阶段，先不做大索引设施 |
| 测试 | Vitest + Effect Test（TestClock/TestServices）+ Schema.Arbitrary 属性测试；集成测试用 Testcontainers | 与 Effect 测试哲学一致，DDD 测试金字塔落地 |
| 定时任务 | Effect Schedule/Stream（周刊提醒、stale 巡检、统计汇总） | 展示调度能力 |
| 可观测 | Effect Logger + Metrics + OpenTelemetry 导出 | 官方标配 |
| 部署 | 前台 → Cloudflare Pages（或静态 CDN）；API → Fly.io / 单 VPS + Docker；DB → Neon/Supabase 或自托管 | 先本地 `pnpm dev` 全栈跑通，部署后置可替换 |
| 内容管线 | `packages/content`：Effect CLI 脚本做上游同步、hash 比对、stale 标记、术语抽检、进度统计 | 翻译工作流工程化是"同步即信誉"的兑现 |

**为什么要 Astro 而不是 Next.js**：本站是"文档+内容+轻交互"为主，SEO 与体积优先；交互重的问答/编辑器是"内容页里的 islands"。Next 的优势（全栈同构）我们用显式的 `apps/api` 获得，反而让 DDD 边界更干净——**前端不直连数据库，只调 Effect API**。若日后需要边渲染边取社区数据，Astro SSR 端直接调 api 的 SDK 即可。

---

## 4. 代码仓库组织

```
effect-ts.cn/
├─ apps/
│  ├─ site/                          # Astro 前台（公开内容：文档/博客/问答浏览/案例/落地页）
│  │  ├─ astro.config.mjs            #  集成 react、mdx、shiki、sitemap、i18n
│  │  ├─ src/
│  │  │  ├─ content/                 #  内容集合（Astro Content Layer）
│  │  │  │  ├─ docs/                 #    官方文档中文译站（镜像官方目录结构 + 版本目录 v3/v4）
│  │  │  │  ├─ blog/                 #    译站文章 + 原创投稿
│  │  │  │  ├─ learn/                #    课程/小抄/范例
│  │  │  │  └─ showcase/             #    案例
│  │  │  ├─ layouts/ components/ ui/ #   React islands & 布局
│  │  │  ├─ lib/                     #    api 客户端（由 packages/contracts 生成/复用）、搜索
│  │  │  └─ pages/                   #    路由（含 404、rss.xml、llms.txt、sitemap）
│  │  └─ public/
│  └─ api/                           # Effect HTTP 后端：社区业务，DDD 见 §5
│     ├─ src/
│     │  ├─ bootstrap/               #   main.ts：Config → Layers → HttpServer → run
│     │  ├─ interfaces/              #   HTTP 层：路由、Schema 校验、认证守卫、错误→HTTP 映射
│     │  ├─ application/             #   用例（写）/ 查询（读）编排，事务边界
│     │  ├─ domain/                  #   纯领域（零 I/O 依赖）
│     │  ├─ infrastructure/          #   适配器：Postgres 仓储、OAuth、邮件、ID、事件总线、搜索
│     │  └─ contexts/                #   限界上下文，见 §5.2（identity/publishing/qna/...）
│     └─ migrations/                 #   SQL migration（按 context 分目录）
├─ packages/
│  ├─ contracts/                     # 前后端共享：Effect Schema DTO、OpenAPI、错误码、权限
│  ├─ content/                       # 内容管线 CLI：上游同步/hash/stale/术语抽检/进度仪表数据
│  ├─ ui/                            # 前端共享组件（文档框架、代码块、问答 UI）
│  └─ tsconfig/ eslint/ 等工程底座    # 或并入根目录配置
├─ docs/                             # 规划、ADR（架构决策记录）、贡献指南、术语提案
├─ .github/workflows/                # sync-upstream / ci / stale-check / translate-check / deploy
├─ pnpm-workspace.yaml  package.json  tsconfig.base.json
└─ PLAN.md
```

依赖方向（单向，靠 imports 纪律 + eslint 守护）：

```
apps/site ──(contracts)──▶ apps/api
packages/ui ──▶ apps/site
apps/api ──▶ packages/contracts（只读 DTO）
domain 绝不 import infrastructure / interfaces
```

---

## 5. 后端 DDD 设计（重点）

### 5.1 限界上下文划分（Bounded Contexts）

按**社区业务能力**切，不按技术切；每个 context 是一个垂直切片（自己的 domain/application/infrastructure/interfaces 子包），用**共享内核 + 领域事件**协作：

```
┌─────────────────────────────────────────────────────────┐
│  IdentityContext     用户/账号/会话/OAuth/资料            │
│   └ 聚合：User、Account（登录方式）、Session              │
├─────────────────────────────────────────────────────────┤
│  PublishingContext   原创投稿/译站管理：稿件、审校、发布    │
│   └ 聚合：Draft（稿件状态机）、PublishedArticle            │
├─────────────────────────────────────────────────────────┤
│  QnAContext          问答：问题、回答、采纳、投票、标签     │
│   └ 聚合：Question、Answer（Question 持有采纳约束）        │
├─────────────────────────────────────────────────────────┤
│  CurationContext     收藏/精选/标签统一/合集               │
│   └ 聚合：Collection；Tag 作为共享内核的值对象            │
├─────────────────────────────────────────────────────────┤
│  NotificationContext 站内通知/订阅/周刊触达（消费领域事件） │
│   └ 聚合：Notification、Subscription                      │
├─────────────────────────────────────────────────────────┤
│  ModerationContext   举报/审核/封禁（跨上下文支撑）        │
├─────────────────────────────────────────────────────────┤
│  EventContext（二期）活动/日历/RSVP                        │
└─────────────────────────────────────────────────────────┘
        共享内核（Shared Kernel，放 domain/shared 或 contracts）：
        UserId/PostId/QuestionId 等 Branded ID、时间值对象、领域事件信封、错误基类
```

> MVP 收敛为 **Identity、Publishing、QnA、Curation、Notification** 五个上下文，Moderation 以"审核状态字段 + 权限"先内嵌，二期再抽成独立上下文。**宁可少而深**。

### 5.2 单个上下文内部的洋葱分层（以 QnA 为例的目录）

```
src/contexts/qna/
├─ domain/
│  ├─ model/
│  │  ├─ question.ts          # 聚合根：Question（实体）
│  │  ├─ answer.ts            # 实体（Answer 是 Question 聚合内成员还是独立聚合？
│  │  │                       #   取舍：采纳需改 Question，故 Answer 归属 Question 聚合，限制聚合大小）
│  │  ├─ vote.ts              # 值对象 + 领域规则（一人一票）
│  │  └─ tag.ts               # 值对象（引用共享内核 Tag）
│  ├─ events/                 # 领域事件：QuestionPosted / AnswerAccepted / Voted...
│  ├─ ports/                  # 端口（仓库等依赖倒置）
│  │  └─ question-repository.ts
│  ├─ services/               # 领域服务（跨聚合规则）：AcceptPolicy
│  └─ errors.ts               # TaggedError 层级：QnaDomainError/QuestionNotFound...
├─ application/
│  ├─ use-cases/              # 用例（命令→领域→持久化→发布事件）
│  │  ├─ ask-question.ts
│  │  ├─ accept-answer.ts
│  │  └─ ...
│  ├─ queries/                # 读模型查询（CQRS 式轻读：直接查投影，不走聚合）
│  ├─ dto/                    # 应用层 DTO（入/出参，映射到 contracts 的 Schema）
│  └─ errors.ts               # 应用错误（用例级编排错误）
├─ infrastructure/
│  ├─ persistence/
│  │  ├─ postgres-question-repository.ts   # 实现 domain/ports
│  │  └─ projections/                      # 读模型投影（如 question-list 投影）
│  ├─ id.ts / clock.ts                     # 基础设施能力（或放共享 infrastructure）
├─ interfaces/
│  ├─ http/
│  │  ├─ question-routes.ts    # Effect Http Router
│  │  ├─ dto-schemas.ts        # 入参 Schema（↔ contracts）
│  │  └─ error-mapping.ts      # 领域/应用错误 → HTTP 状态码与错误体
│  └─ ...
└─ (bootstrap) 由 context.ts 导出该上下文的 Http Router + Layers
```

### 5.3 战术建模 ↔ Effect 的对应关系（这是"用 Effect 做 DDD"的关键一页）

| DDD 概念 | Effect 落地方式 |
|---|---|
| 实体 / 值对象 | `@effect/schema` 的 `Schema.Class` + `readonly`；不可变更新返回新实例 |
| ID / Branded 类型 | `Brand`/Schema Brand：`UserId`、`QuestionId`——编译期防止拿错 ID |
| 领域错误 | `Data.TaggedError` 子类层级（`QnaDomainError` ← `QuestionNotFound`…），**error channel 与领域规则一一对应** |
| 领域/应用服务 | `Context.Tag` 服务类，方法签名直接写 `Effect<Success, Error, Requirements>`——**依赖即类型** |
| 端口（仓储接口） | domain 里定义为 `Context.Tag`（纯接口形状，方法返回领域对象）；实现放在 infrastructure |
| 依赖注入/组装 | `Layer`：`QuestionRepo.Live`、`Postgres.Live`、`Clock`；`Context.provide` 按需组合；测试注入内存实现 |
| 应用用例的事务边界 | `@effect/sql` 的 `Transaction`：一个用例 = 一个事务（聚合内变更），跨上下文用**领域事件最终一致** |
| 领域事件 | 事件 = Schema 类；发布经 `Queue`/`PubSub`（进程内）+ **outbox 表 + 消费者**（跨服务/可恢复） |
| 读模型 | 独立投影表 + 查询服务（`@effect/sql` 直查 + Schema 解码），不让查询污染聚合 |
| 并发/定时 | `Effect.fork`/结构化并发跑后台任务；周刊提醒用 `Schedule.cron`；`@effect/platform` 提供日志/时钟抽象便于测试 |
| 配置与密钥 | `Config`（Effect）+ 环境变量，绝不打进代码 |
| 输入校验（anti-corruption） | interfaces 层用 Schema decode，非法输入在边界被拦下，域内只接收已保证不变量（用 branded/refined 类型强化） |

**QnA 的聚合一致性示例（AcceptAnswer 用例）**：
> `Question` 聚合内同时持有 `Answer` 与 `AcceptedAnswerId`，因此"采纳回答"是一个聚合内操作——单事务、无跨聚合一致性难题；同时限制 Question 下回答数/投票的载入策略（大列表走投影）。投票"一人一票"用唯一约束兜底 + 领域规则前置。

### 5.4 错误与 API 契约（Schema-first）

- `packages/contracts` 存放所有进出 HTTP 的 DTO 与错误码 Schema（如 `ApiError` = tagged union：`not-found | forbidden | validation | conflict…`）。
- interfaces 层把领域/应用错误统一映射为 ApiError；**前端类型 = 后端 Schema 导出的类型**，零重复。
- 生成 OpenAPI（`/openapi.json`）与概览页，作为 API 文档与调试入口。

### 5.5 测试策略（DDD 测试金字塔 + Effect）

```
domain 单元测试（纯函数/状态机/不变量）   → 占比最高，快
application 用例测试                      → 内存仓储 Layer + TestClock
interfaces 契约测试                      → Schema 解码 + HTTP 路由断言
integration 全链路                        → Testcontainers Postgres
属性测试                                 → Schema.Arbitrary + fast-check
```

---

## 6. 内容同步管线（让"同步即信誉"落地）

1. **镜像上游目录**：CI 定时（或手动触发）克隆 `Effect-TS/effect`（docs）与 `Effect-TS/website`（blog），产出 `upstream-snapshot.json`（路径 → commit hash → mtime）。
2. **hash 比对**：`packages/content` CLI 对每个中文文件读 frontmatter 里的 `upstreamCommit`，与快照比对 → 生成 `stale` 清单 → 打开 GitHub Issue/PR 草稿给译者。
3. **翻译助手**：CLI 用 AI（可选）生成初译草稿 → 译者人工精译 → 审校人 approve → `status: published`。
4. **质量门禁**：CI 检查——术语表一致性（禁翻词列表命中即报警）、上游代码块未改动、链接有效、frontmatter 完整、示例可编译。
5. **仪表盘数据**：CLI 输出 JSON 给前台 `/docs/translation-status` 页面与首页进度条渲染。

---

## 7. 里程碑路线图

**Phase 0 · 地基（2–3 周）**
- 仓库脚手架：pnpm workspace、Astro site、Effect api 骨架、contracts、CI、dev 全栈跑通
- 设计系统（浅/深色、排版、术语注释组件）、首页 + 文档壳 + 版本切换(v4/v3)
- 内容管线 v1：同步 + hash + stale + 术语表
- 交付页面：首页、docs 布局、贡献指南、翻译状态页（空转但真实）
- 验收：本地一条命令跑起前后端；一篇示例译文的完整生命周期走通（译→审→发→stale→更新）

**Phase 1 · 内容为王（4–6 周）**
- Onboarding 全量精译发布；Guides 按"被搜最多"排序逐目录推进（错误管理 → 并发 → Schema）
- 官方 Blog/Release 精选译站 + 周刊创刊
- 小抄/对照表 + Playground 跳转集成
- 度量：译文页数、覆盖率、自然搜索进入

**Phase 2 · 社区功能（4–6 周）**
- Identity（GitHub OAuth + 会话）、QnA MVP（提问/回答/采纳/投票/标签）
- 评论（挂在文章/译文/回答上）、收藏与合集
- Moderation 最小集（举报 → 隐藏），通知（站内）
- 度量：DAU、问题数/首次回答时长、贡献者数

**Phase 3 · 增长与 Dogfood 深化（持续）**
- Showcase 案例库、活动日历与中文 Office Hour
- 全文搜索升级、周刊订阅（邮件）
- 自托管 Playground（Monaco + 浏览器跑 Effect），让"代码可运行"闭环
- 把最具教学价值的后端模块（如 QnA + outbox + Schedule）单独写成"参考实现"专栏
- 度量：投稿量、翻译滞后中位数、NPS（问卷）

> 原则：**每个 Phase 结束都可独立上线、可回滚、不阻塞下一个**；Phase 2 的功能只在 Phase 1 内容立住之后做，避免"空社区"。

---

## 8. 风险与开放问题

- **翻译维护成本**是最大风险 → 用 hash 自动化 + 术语表 + 精译/机翻分层来控制，不接受"一次性翻完"的幻想。
- **审核人力**：社区早期由 2–3 名编辑 + 自动门禁兜底；规则透明写进贡献指南。
- **与官方/商标关系**：域名与命名避免与 Effectful Technologies 冲突；页面显著标注非官方、遵循 MIT 与品牌指引；积极寻求官方互链认可（社区 hub 上已被官方鼓励各地线下聚会的先例）。
- **v4 RC 的节奏**：主线锁定与官方一致的版本切换策略，避免翻译永远追不上"最新"。
- 名称候选（另议）：effect-ts.cn / effect-zh.dev / effectcn.org —— 需查域名与商标。

---

## 9. 下一步

1. 确认本规划中的三个关键选择：前台框架（Astro 推荐）、数据库（Postgres 推荐）、首期范围（Phase 0 先行推荐）。
2. 我据此在仓库落地：pnpm monorepo 脚手架 + Phase 0 的可运行骨架（Astro site 壳 + Effect api DDD 骨架 + contracts + 一条 CI）。
3. 建立术语表初稿与贡献指南，从第一篇译文（Getting Started）开始跑通管线。

---

## 10. AI-Native 延伸（详见 [docs/ai-native.md](./docs/ai-native.md)）

如果只做官方文档翻译，产品在 LLM 时代没有壁垒（翻译已被商品化）。我们真正的资产是
**可溯源、带版本、经社区审校的中文知识**。因此站点要从"人读的站点"演进为
"人和 Agent 都能质问的知识层"：

- **可溯源即可信**：AI 答案必须带 `页面@commit#锚点` 引用，检索不到证据就拒答；
- **Agent 优先**：同一语料同时以 HTML、`.md`/`llms-full.txt`、MCP 工具三种形态提供；
- **AI 起草 + 人审发布**：译文草稿、答案草稿、练习题、落后页更新由 Agent 起草，人审通过才发布；
- 第一刀：**Agent 可读语料（Slice 0）+ 问这一页（Slice 1）**，并配 CI 评测门禁；
  衡量指标是**可验证答率**，不是"回答了多少问题"。

---

## 11. 实现现状（与代码同步，滚动更新）

> 本节只记录**当前仓库里真实存在的东西**，用于消除"规划写得比代码走得远"的错觉。
> 能力维度的详细状态另见 [docs/ai-native.md](./docs/ai-native.md) §7.5。

### 11.1 仓库结构 vs §4 目标

| §4 目标 | 现状 | 说明 |
|---|---|---|
| `apps/site` | ✅ 已落地 | Astro 静态站（内容集合 / islands / SEO） |
| `apps/api` | ✅ 已落地 | Effect HTTP + DDD 骨架 |
| `packages/contracts` | ✅ 已落地 | Schema-first DTO + 错误码 |
| `packages/content` | ✅ 已落地 | 门禁 / 上游快照 / stale / 导航 / 语料 |
| `packages/ui` | ❌ 未建 | 组件暂放 `apps/site/src/components` |
| `apps/mcp` | ➕ 新增（§4 未列） | 中文知识层的 MCP Server（stdio，离线自包含） |
| `packages/knowledge` | ➕ 新增（§4 未列） | 检索与答案合成（BM25F-lite / 引用不变量 / 拒答） |

### 11.2 后端 DDD：上下文落地情况

| §5.1 计划的上下文 | 现状 |
|---|---|
| Identity | ❌ 未开始（Phase 2） |
| Publishing | ❌ 未开始（内容走 Git + MDX，暂不需要后端） |
| QnA | 🟡 部分：**四层齐全**（domain 聚合 / 用例 / InMemory + Postgres 仓储 / HTTP 路由），但站点尚无问答 UI |
| Curation · Notification | ❌ 未开始 |
| Knowledge · Assistant | ➕ 新增（§10 的 Slice 0–2 提前兑现） |

分层一致性：`interfaces/http` 目前是**顶层共享**，而非每上下文一份；
`knowledge` 缺 application 层、`assistant` 缺 domain 层；CONTRIBUTING 提到的 ESLint 边界规则仍未加入。

### 11.3 数据与部署

- 默认 **InMemory**（`DATABASE_URL` 为空时）；Postgres 仓储目前**只有 QnA 一处**；
  但已有**正式 SQL migration**：`apps/api/migrations/qna/0001_init.sql` + 自研执行器
  `apps/api/src/bootstrap/migrations.ts`（`_migrations` 表记账、按文件名编号升序、每个迁移单事务）。
- 前台按**静态托管**设计（没有后端时搜索与问答降级为浏览器内检索）；
  API 提供 Dockerfile 与本地 compose，见 [docs/deployment.md](./docs/deployment.md)。
- §3 表格中"数据库 PostgreSQL / 认证 GitHub OAuth"是**目标选型**：Postgres 部分接入，OAuth 未实现。

### 11.4 内容进度（本文的"内容为王"阶段）

- **v3 + v4 全量 234 篇**（v4 110 · v3 124），覆盖率 **100%**，全部 `status: published`，
  待译 0 页、stale 0 页；frontmatter 带译者 / 审校 / 上游基线 `@bf46254`
  （见 `packages/knowledge/data/corpus.json` 的 `stats`：`pages: 234` · `pendingPages: 0`）。
- **审校口径**：234 篇 `reviewers` 一律 `ecn-review`（机器可复核，**非人工精读**），尚无人类精读署名；
  展示口径见 `apps/site/src/data/provenance.ts`，`pnpm content:check --require-human-reviewer`
  可把「必须有人类审校者」变成硬门禁（默认关闭）。
- 因此 §7 的 **Phase 1 / 1.5 已完成**；Phase 2（社区功能）/ Phase 3 未开始。
