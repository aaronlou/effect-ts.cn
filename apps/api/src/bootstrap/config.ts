/**
 * bootstrap · 应用配置（Effect Config 读取环境变量）
 */
import { Config, Context, Effect, Layer, Option } from "effect"

export interface AppConfig {
  readonly port: number
  /** Some(url) => 使用 Postgres；None => 使用 InMemory 仓储（开发模式） */
  readonly databaseUrl: Option.Option<string>
  readonly version: string
}

export const AppConfig = Context.GenericTag<AppConfig>("bootstrap/AppConfig")

export const AppConfigLive = Layer.effect(
  AppConfig,
  Effect.gen(function* () {
    const port = yield* Config.number("API_PORT").pipe(Config.withDefault(8787))
    const databaseUrl = yield* Config.option(Config.string("DATABASE_URL"))
    return {
      port,
      databaseUrl,
      version: "0.1.0"
    }
  })
)
