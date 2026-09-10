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
  readonly check: (key: string) => Effect.Effect<RateLimitDecision>
}

export const RateLimiter = Context.GenericTag<RateLimiterService>("assistant/RateLimiter")

interface Window {
  readonly count: number
  readonly resetAt: number
}

export const makeRateLimiterLive = (options: {
  readonly limitPerMinute: number
}): Layer.Layer<RateLimiterService> =>
  Layer.effect(
    RateLimiter,
    Effect.gen(function* () {
      const windows = yield* Ref.make(new Map<string, Window>())
      const windowMillis = 60_000

      return {
        check: (key: string): Effect.Effect<RateLimitDecision> =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const decision = yield* Ref.modify(windows, (current) => {
              const existing = current.get(key)
              const active =
                existing !== undefined && existing.resetAt > now
                  ? existing
                  : { count: 0, resetAt: now + windowMillis }
              const count = active.count + 1
              const next = new Map(current)
              // 顺手清理过期窗口，避免 Map 无限增长
              for (const [entryKey, window] of current) {
                if (window.resetAt <= now) next.delete(entryKey)
              }
              next.set(key, { count, resetAt: active.resetAt })
              return [
                {
                  allowed: count <= options.limitPerMinute,
                  remaining: Math.max(0, options.limitPerMinute - count),
                  retryAfterSeconds: Math.max(1, Math.ceil((active.resetAt - now) / 1000))
                },
                next
              ] as const
            })
            return decision
          })
      }
    })
  )
