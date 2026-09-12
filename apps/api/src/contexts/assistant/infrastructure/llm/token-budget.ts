/**
 * Assistant 上下文 · infrastructure：**每日 token 预算**（硬止损）。
 *
 * 为什么必须在**我们这一侧**做，而不是依赖模型平台：
 * 我们握着唯一通向 API Key 的出口。平台侧的额度/告警只能"事后告诉你花了多少"，
 * 而站点在无人看管时被打量，损失是实时的。把闸门放在自己的调用路径上，
 * 才能在超预算的**那一刻**停止花钱 —— 而不是等账单。
 *
 * 设计取舍：
 * - **按 UTC 日重置**：不用"滚动 24 小时"，因为重置点必须是可预期的
 *   （运维要知道"明天几点恢复"）；UTC 日也避免了时区/DST 的歧义。
 * - **只在内存里记账**：单实例部署足够；进程重启会清零（这是刻意的：
 *   它防的是"当天被打爆"，不是"精确计费"）。
 * - **超预算不是让站点挂掉，而是让它降级**：LLM 调用返回 undefined，
 *   问答自动退回 extractive —— 引用、拒答、搜索全都照常，只是不再有模型润色。
 *   宁可朴素，不可下线。
 * - `dailyLimit <= 0` 表示**不限**（本地开发与 CI 用得上）。
 */
import { Clock, Context, Effect, Layer, Ref } from "effect"

const DAY_MILLIS = 86_400_000

export interface TokenBudgetStatus {
  /** 今日已用 token（提示 + 生成） */
  readonly used: number
  /** 每日上限；`0` 表示不限 */
  readonly limit: number
  readonly remaining: number
  /** 是否已用尽（此时所有模型调用会被短路） */
  readonly exhausted: boolean
  /** 下一次重置的时刻（epoch 毫秒） */
  readonly resetAt: number
}

export interface TokenBudgetService {
  /** 记一次调用消耗；应在每次成功的模型调用后调用 */
  readonly spend: (tokens: number) => Effect.Effect<void>
  /** 现在还能不能再调模型 */
  readonly canSpend: Effect.Effect<boolean>
  readonly status: Effect.Effect<TokenBudgetStatus>
}

export const TokenBudget = Context.GenericTag<TokenBudgetService>("assistant/TokenBudget")

export interface BudgetState {
  readonly used: number
  readonly dayStart: number
}

/** 取某个时刻所属 UTC 日的起点 */
export const utcDayStart = (millis: number): number => Math.floor(millis / DAY_MILLIS) * DAY_MILLIS

export const isExhausted = (used: number, limit: number): boolean => limit > 0 && used >= limit

/**
 * 账本推进（纯函数）。
 *
 * 抽出来是为了能**直接单测跨日清零** —— 用 Effect 的测试时钟去拨时间要绕好几层接线，
 * 而"过了 UTC 零点用量归零"这种逻辑一旦坏了很难发现。纯函数版本一眼可验。
 */
export const advanceBudget = (state: BudgetState, now: number, tokens: number): BudgetState => {
  const dayStart = utcDayStart(now)
  const base = state.dayStart === dayStart ? state.used : 0
  const delta = Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0
  return { used: base + delta, dayStart }
}

/** 读取时的对齐（跨日后读到的应是 0） */
export const alignBudget = (state: BudgetState, now: number): BudgetState => {
  const dayStart = utcDayStart(now)
  return state.dayStart === dayStart ? state : { used: 0, dayStart }
}

export const makeTokenBudgetLive = (options: { readonly dailyLimit: number }): Layer.Layer<TokenBudgetService> =>
  Layer.effect(
    TokenBudget,
    Effect.gen(function* () {
      const state = yield* Ref.make<BudgetState>({ used: 0, dayStart: 0 })

      const toStatus = (current: BudgetState): TokenBudgetStatus => ({
        used: current.used,
        limit: options.dailyLimit,
        remaining: options.dailyLimit > 0 ? Math.max(0, options.dailyLimit - current.used) : Number.POSITIVE_INFINITY,
        exhausted: isExhausted(current.used, options.dailyLimit),
        resetAt: current.dayStart + DAY_MILLIS
      })

      const read = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const aligned = yield* Ref.updateAndGet(state, (current) => alignBudget(current, now))
        return toStatus(aligned)
      })

      return {
        status: read,
        canSpend: read.pipe(Effect.map((s) => !s.exhausted)),
        spend: (tokens: number) =>
          Effect.gen(function* () {
            if (!Number.isFinite(tokens) || tokens <= 0) return
            const now = yield* Clock.currentTimeMillis
            yield* Ref.update(state, (current) => advanceBudget(current, now, tokens))
          })
      }
    })
  )
