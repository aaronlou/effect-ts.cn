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
  /** 每日 LLM token 预算；<=0 表示不限 */
  readonly llmDailyTokenBudget: number
  /** 单个来源每日提问次数上限（0 = 不限） */
  readonly askDailyLimitPerIp: number
  /**
   * 是否信任反向代理写入的客户端地址头（X-Real-IP / X-Forwarded-For）。
   * 默认 true：生产编排里 api 不发布宿主端口，只经由自建 nginx 反代访问。
   * 若把 API 直接暴露到公网，应设为 false（否则限流 key 可被伪造）。
   */
  readonly trustProxyHeaders: boolean
}

export const AppConfig = Context.GenericTag<AppConfig>("bootstrap/AppConfig")

export const AppConfigLive = Layer.effect(
  AppConfig,
  Effect.gen(function* () {
    const port = yield* Config.number("API_PORT").pipe(Config.withDefault(8787))
    // 空白（未设置 / 空串 / 只有空格）一律视为「未配置」。
    // 为什么必须显式过滤：`Config.option` 只判断变量**存在**，而 `.env.example` 里
    // `DATABASE_URL=` 这种写法会让 Option 变成 Some("")，于是启动时走 Postgres 分支、
    // 连库失败直接崩 —— 与示例文件里"留空 => InMemory"的说明正好相反。
    const rawDatabaseUrl = yield* Config.option(Config.string("DATABASE_URL"))
    const databaseUrl = Option.filter(rawDatabaseUrl, (url) => url.trim() !== "")
    // 默认 200 万 token/日：按实测（润色 ~493 + 重排 ~324 ≈ 800~1300/次）
    // 约合每天 1500~2500 次带模型的问答；超出后自动降级为检索合成，站点不会挂
    const llmDailyTokenBudget = yield* Config.number("LLM_DAILY_TOKEN_BUDGET").pipe(
      Config.withDefault(2_000_000)
    )
    // 默认 80 次/日/来源：防止单个来源把全局预算吃光
    const askDailyLimitPerIp = yield* Config.number("ASK_DAILY_LIMIT_PER_IP").pipe(
      Config.withDefault(80)
    )
    const askRateLimitPerMinute = yield* Config.number("ASK_RATE_LIMIT_PER_MINUTE").pipe(
      Config.withDefault(20)
    )
    const trustProxyHeaders = yield* Config.boolean("TRUST_PROXY_HEADERS").pipe(
      Config.withDefault(true)
    )
    return {
      port,
      databaseUrl,
      version: "0.1.0",
      askRateLimitPerMinute,
      llmDailyTokenBudget,
      askDailyLimitPerIp,
      trustProxyHeaders
    }
  })
)
