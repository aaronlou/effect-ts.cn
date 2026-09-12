/**
 * bootstrap · 入口：组合 Layer → 启动 HttpServer
 *
 * 装配故事（DDD + Effect 的看点）：
 *   同一个 QuestionRepository 端口，按 DATABASE_URL 是否有效，
 *   在「InMemory 仓储」与「Postgres 仓储」之间用 Layer 一键切换 ——
 *   这就是依赖倒置 + DI 容器带来的可移植性。
 *
 * 启动顺序：**先应用迁移，再开始监听**（见 Program）——
 * 否则首批请求可能打到还没建表的库。
 */
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { describeLoadedEnv } from "./load-env"
import { FetchHttpClient, HttpApiBuilder, HttpMiddleware, HttpServer } from "@effect/platform"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer, Option, Redacted } from "effect"
import { PgClient } from "@effect/sql-pg"
import { SqlClient, SqlError } from "@effect/sql"

import { Api } from "../interfaces/http/api"
import { SystemGroupLive } from "../interfaces/http/health"
import { QuestionsGroupLive } from "../interfaces/http/qna"
import { KnowledgeGroupLive } from "../interfaces/http/knowledge"

import { KnowledgeBaseLive } from "../contexts/knowledge/infrastructure/knowledge-base-live"
import { makeAnswerCacheLive } from "../contexts/assistant/infrastructure/answer-cache-live"
import { makeTokenBudgetLive } from "../contexts/assistant/infrastructure/llm/token-budget"
import { GlossaryLive } from "../contexts/assistant/infrastructure/glossary-live"
import { LlmLive } from "../contexts/assistant/infrastructure/llm/openai-compatible-llm"
import { makeRateLimiterLive } from "../contexts/assistant/infrastructure/rate-limiter"
import { AppConfig, AppConfigLive } from "./config"
import { runMigrations } from "./migrations"

import { LoggingEventPublisher } from "../shared/events"
import { NodeCryptoIdGenerator } from "../shared/infrastructure/node-crypto-id-generator"
import { InMemoryQuestionRepositoryLive } from "../contexts/qna/infrastructure/persistence/in-memory-question-repository"
import { PostgresQuestionRepositoryLive } from "../contexts/qna/infrastructure/persistence/postgres-question-repository"
import type { QuestionRepository } from "../contexts/qna/domain/ports/question-repository"

/**
 * 迁移目录：**相对本文件**解析，不依赖 cwd。
 * `pnpm --filter @ecn/api start` 的 cwd 是 apps/api，容器里也是；
 * 但用 `node` 直接跑编译产物时 cwd 可能不同，相对 import.meta.url 才稳妥。
 */
const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url))

/**
 * PgClient：只有 DATABASE_URL 有效时才装配，否则是空层（走 InMemory）。
 *
 * 迁移与仓储**共用这一份** —— 整个 Program 只建立一个连接池。
 * 注意空层只在 DATABASE_URL 缺失时生效，而那时 QuestionRepositorySelected
 * 永远不会构造 Postgres 仓储，因此不会有"要 SqlClient 却拿不到"的情况。
 */
/**
 * 配置了 DATABASE_URL 才是真 PgClient，否则空层。
 *
 * 这里必须有一次 `as`：Effect 的 Layer 在输出类型上是不变的，
 * `Layer.empty`（Layer<never>）无法直接赋给 `Layer<SqlClient>`。
 * 空层只在 DATABASE_URL 缺失时生效，而那时没有任何代码会去取 SqlClient
 * （QuestionRepositorySelected 只会构造 InMemory 仓储），所以这里是安全的。
 */
const emptySqlClient = Layer.empty as Layer.Layer<SqlClient.SqlClient>

/** 配置了 DATABASE_URL 才是 PgClient，否则空层（走 InMemory） */
const pgClientFor = (
  config: AppConfig
): Layer.Layer<SqlClient.SqlClient, SqlError.SqlError> =>
  Option.isSome(config.databaseUrl)
    ? PgClient.layer({ url: Redacted.make(config.databaseUrl.value) })
    : emptySqlClient

const PgClientLive: Layer.Layer<SqlClient.SqlClient, SqlError.SqlError, AppConfig> =
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const config = yield* AppConfig
      return pgClientFor(config)
    })
  )

/**
 * 按配置选择仓储实现。
 * 两个分支都以 Layer<QuestionRepository> 呈现（多余的内部服务不进类型），
 * 端口与适配器之间的可替换性由此变得可见、可测。
 */
const QuestionRepositorySelected: Layer.Layer<
  QuestionRepository,
  SqlError.SqlError,
  AppConfig | SqlClient.SqlClient
> = Layer.unwrapEffect(
    Effect.gen(function* () {
      const config = yield* AppConfig
      if (Option.isSome(config.databaseUrl)) {
        yield* Effect.log(
          "DATABASE_URL 已设置 → 使用 Postgres QuestionRepository"
        )
        // SqlClient 由 PgClientLive 在同一作用域内提供（见 Program）
        return PostgresQuestionRepositoryLive
      }
      if (process.env["NODE_ENV"] === "production") {
        // 静默降级最危险：容器里变量没注入（拼错/secret 缺失）时，服务照常回 ok，
        // 但每条提问重启即丢。这里必须吵一声。
        yield* Effect.logWarning(
          "DATABASE_URL 未设置，但 NODE_ENV=production → 正在使用 InMemory 仓储：重启即丢数据！"
        )
      }
      yield* Effect.log(
        "DATABASE_URL 未设置 → 使用 InMemory QuestionRepository（开发模式，重启即清空）"
      )
      return InMemoryQuestionRepositoryLive
    })
  )


/** 各 HTTP 组的实现 → 汇总为 HttpApi.Api 的完整实现 */
const ApiImplementationLive = HttpApiBuilder.api(Api).pipe(
  Layer.provide(SystemGroupLive),
  Layer.provide(QuestionsGroupLive),
  Layer.provide(KnowledgeGroupLive)
)

/** 问答限流（配额来自配置） */
const RateLimiterLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* AppConfig
    return makeRateLimiterLive({ limitPerMinute: config.askRateLimitPerMinute })
  })
)

/**
 * 领域/基础设施服务。
 * 注意 LlmLive 会自选实现：配置了 LLM_BASE_URL/LLM_API_KEY 就用模型润色，
 * 否则用 extractive（无模型、零成本、完全可溯源）——因此本地/CI 无需任何 Key。
 */
/**
 * 每日 token 预算（硬止损）。
 *
 * 放在**我们自己的调用路径**上而不是依赖模型平台的额度告警：站点无人看管时被打量，
 * 损失是实时的，闸门必须在超预算那一刻就合上。用尽后问答自动降级为检索合成 ——
 * 站点照常可用，只是不再有模型润色。
 */
const TokenBudgetLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* AppConfig
    return makeTokenBudgetLive({ dailyLimit: config.llmDailyTokenBudget })
  })
)

const DomainServicesLive = Layer.mergeAll(
  NodeCryptoIdGenerator,
  LoggingEventPublisher,
  QuestionRepositorySelected,
  KnowledgeBaseLive,
  // 答案缓存 TTL 从 30 分钟提到 24 小时：文档问答的重复率极高，
  // 缓存命中是**零 token** 的，这是最省的一刀（opencode 那类站点亦然）。
  makeAnswerCacheLive({ capacity: 2000, ttlMillis: 24 * 60 * 60 * 1000 }),
  GlossaryLive,
  RateLimiterLive,
  TokenBudgetLive,
  // mergeAll 不会用兄弟层满足依赖：显式把 HttpClient 与 TokenBudget 提供给 LLM 层
  Layer.provide(LlmLive, Layer.mergeAll(FetchHttpClient.layer, TokenBudgetLive))
)

/** Node HTTP 服务器（端口来自配置） */
const NodeServerLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* AppConfig
    return NodeHttpServer.layer(createServer, {
      host: "0.0.0.0",
      port: config.port
    })
  })
)

const HttpLive = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  Layer.provide(HttpApiBuilder.middlewareCors()),
  Layer.provide(HttpApiBuilder.middlewareOpenApi({ path: "/openapi.json" })),
  Layer.provide(ApiImplementationLive),
  HttpServer.withLogAddress,
  Layer.provide(NodeServerLive)
)

/**
 * 应用层（不含配置与数据库）：SqlClient 由 Program 的作用域提供，
 * 这样迁移与仓储共用同一个连接池。
 */
const AppLive = HttpLive.pipe(Layer.provide(DomainServicesLive))

/**
 * 启动流程：①（已配置数据库时）应用迁移 → ② 启动 HTTP 服务。
 * 迁移失败会让整个进程启动失败（fail fast），而不是带着半套表结构对外服务。
 */
const Program = Effect.gen(function* () {
  const config = yield* AppConfig
  if (Option.isSome(config.databaseUrl)) {
    const applied = yield* runMigrations(MIGRATIONS_DIR)
    yield* Effect.log(
      applied.length > 0
        ? `已应用 ${applied.length} 个迁移：${applied.join(", ")}`
        : "数据库结构已是最新（无待应用迁移）"
    )
  }
  return yield* Layer.launch(AppLive)
}).pipe(Effect.provide(PgClientLive), Effect.provide(AppConfigLive))

console.log(`[env] 已加载配置：${describeLoadedEnv()}`)

NodeRuntime.runMain(Program)
