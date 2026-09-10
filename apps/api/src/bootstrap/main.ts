/**
 * bootstrap · 入口：组合 Layer → 启动 HttpServer
 *
 * 装配故事（DDD + Effect 的看点）：
 *   同一个 QuestionRepository 端口，按 DATABASE_URL 是否存在，
 *   在「InMemory 仓储」与「Postgres 仓储」之间用 Layer 一键切换 ——
 *   这就是依赖倒置 + DI 容器带来的可移植性。
 */
import "dotenv/config"
import { createServer } from "node:http"
import { HttpApiBuilder, HttpMiddleware, HttpServer } from "@effect/platform"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer, Option, Redacted } from "effect"
import { PgClient } from "@effect/sql-pg"
import { SqlError } from "@effect/sql"

import { Api } from "../interfaces/http/api"
import { SystemGroupLive } from "../interfaces/http/health"
import { QuestionsGroupLive } from "../interfaces/http/qna"
import { AppConfig, AppConfigLive } from "./config"

import { LoggingEventPublisher } from "../shared/events"
import { NodeCryptoIdGenerator } from "../shared/infrastructure/node-crypto-id-generator"
import { InMemoryQuestionRepositoryLive } from "../contexts/qna/infrastructure/persistence/in-memory-question-repository"
import { PostgresQuestionRepositoryLive } from "../contexts/qna/infrastructure/persistence/postgres-question-repository"
import type { QuestionRepository } from "../contexts/qna/domain/ports/question-repository"

/**
 * 按配置选择仓储实现。
 * 两个分支都以 Layer<QuestionRepository> 呈现（多余的内部服务不进类型），
 * 端口与适配器之间的可替换性由此变得可见、可测。
 */
const QuestionRepositorySelected: Layer.Layer<
  QuestionRepository,
  SqlError.SqlError,
  AppConfig
> = Layer.unwrapEffect(
    Effect.gen(function* () {
      const config = yield* AppConfig
      if (Option.isSome(config.databaseUrl)) {
        yield* Effect.log(
          "DATABASE_URL 已设置 → 使用 Postgres QuestionRepository"
        )
        // mergeAll 不会用兄弟层满足彼此依赖，这里用 provide 把 PgClient 提供的
        // SqlClient 供给 Postgres 仓储（正是“按需装配 Layer 依赖”的落点）。
        return Layer.provide(
          PostgresQuestionRepositoryLive,
          PgClient.layer({ url: Redacted.make(config.databaseUrl.value) })
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
  Layer.provide(QuestionsGroupLive)
)

/** 领域/基础设施服务 */
const DomainServicesLive = Layer.mergeAll(
  NodeCryptoIdGenerator,
  LoggingEventPublisher,
  QuestionRepositorySelected
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

const Program = HttpLive.pipe(
  Layer.provide(DomainServicesLive),
  Layer.provide(AppConfigLive)
)

NodeRuntime.runMain(Layer.launch(Program))
