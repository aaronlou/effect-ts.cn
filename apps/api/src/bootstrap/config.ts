/**
 * bootstrap · 应用配置（Effect Config 读取环境变量）
 */
import { Config, Context, Effect, Layer, Option } from "effect"

export interface AppConfig {
  readonly port: number
  /** Some(url) => 使用 Postgres；None => 使用 InMemory 仓储（开发模式） */
  readonly databaseUrl: Option.Option<string>
  readonly version: string
  /** 问答接口每分钟配额（防滥用；Phase 2 接入登录后可按用户提升） */
  readonly askRateLimitPerMinute: number
}

export const AppConfig = Context.GenericTag<AppConfig>("bootstrap/AppConfig")

export const AppConfigLive = Layer.effect(
  AppConfig,
  Effect.gen(function* () {
    const port = yield* Config.number("API_PORT").pipe(Config.withDefault(8787))
    const databaseUrl = yield* Config.option(Config.string("DATABASE_URL"))
    const askRateLimitPerMinute = yield* Config.number("ASK_RATE_LIMIT_PER_MINUTE").pipe(
      Config.withDefault(20)
    )
    return {
      port,
      databaseUrl,
      version: "0.1.0",
      askRateLimitPerMinute
    }
  })
)
