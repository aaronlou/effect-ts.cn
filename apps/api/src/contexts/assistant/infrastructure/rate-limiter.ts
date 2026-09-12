/**
 * Assistant 上下文 · infrastructure：固定窗口限流（按调用方 key）。
 *
 * 目的：公开问答接口必须防滥用；但不做账号体系也能先上线（Phase 2 接入 Identity 后
 * 可改为按用户配额）。超限返回 429 + Retry-After，前端据此提示而不是静默失败。
 */
import { Clock, Context, Effect, Layer, Ref } from "effect"

export interface RateLimitDecision {
  readonly allowed: boolean
  readonly remaining: number
  readonly retryAfterSeconds: number
}

export interface RateLimiterService {
  /** 按分钟（固定窗口） */
  readonly check: (key: string) => Effect.Effect<RateLimitDecision>
  /**
   * 按 UTC 日（固定窗口）。
   *
   * 为什么光有"每分钟"不够：20 次/分 = 单来源每天最多 28,800 次，
   * 而那正是会把每日 token 预算一次性吃光的量级。分钟限流防的是"突发"，
   * 日限流防的是"细水长流地把预算耗干"——两者管的是不同的滥用形态。
   * `limit <= 0` 表示不限。
   */
  readonly checkDaily: (key: string, limit: number) => Effect.Effect<RateLimitDecision>
}

export const RateLimiter = Context.GenericTag<RateLimiterService>("assistant/RateLimiter")

interface Window {
  readonly count: number
  readonly resetAt: number
}

const DAY_MILLIS = 86_400_000
export const utcDayStart = (millis: number): number => Math.floor(millis / DAY_MILLIS) * DAY_MILLIS

export const makeRateLimiterLive = (options: {
  readonly limitPerMinute: number
}): Layer.Layer<RateLimiterService> =>
  Layer.effect(
    RateLimiter,
    Effect.gen(function* () {
      const windows = yield* Ref.make(new Map<string, Window>())

      /** 固定窗口计数的公共实现：分钟窗口用"距现在 60s"，日窗口用"UTC 日对齐" */
      const tick = (
        key: string,
        limit: number,
        windowEnd: (now: number) => number
      ): Effect.Effect<RateLimitDecision> =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const id = `${key}`
          return yield* Ref.modify(windows, (current) => {
            const existing = current.get(id)
            const active =
              existing !== undefined && existing.resetAt > now
                ? existing
                : { count: 0, resetAt: windowEnd(now) }
            const count = active.count + 1
            const next = new Map(current)
            // 顺手清理过期窗口，避免 Map 无限增长
            for (const [entryKey, window] of current) {
              if (window.resetAt <= now) next.delete(entryKey)
            }
            next.set(id, { count, resetAt: active.resetAt })
            return [
              {
                allowed: limit <= 0 ? true : count <= limit,
                remaining: limit <= 0 ? Number.POSITIVE_INFINITY : Math.max(0, limit - count),
                retryAfterSeconds: Math.max(1, Math.ceil((active.resetAt - now) / 1000))
              },
              next
            ] as const
          })
        })

      return {
        check: (key) => tick(key, options.limitPerMinute, (now) => now + 60_000),
        // 日窗口的 key 加前缀，避免与分钟窗口互相覆盖
        checkDaily: (key, limit) => tick(`daily:${key}`, limit, (now) => utcDayStart(now) + DAY_MILLIS)
      }
    })
  )
