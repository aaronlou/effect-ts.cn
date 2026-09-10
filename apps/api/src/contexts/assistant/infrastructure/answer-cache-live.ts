/**
 * Assistant 上下文 · infrastructure：内存答案缓存（TTL + 容量上限）。
 *
 * 为什么不用 L1/L2 或 Redis：Phase 1 的问答是**本地毫秒级**的确定性问题，
 * 单实例内存缓存即可把重复问题（Effect 报错与文档问题的重复率极高）变成零成本；
 * 需要多实例共享时，这里换成基于 Postgres/Redis 的实现即可（端口不变）。
 */
import { Clock, Effect, Layer, Ref } from "effect"
import { AnswerCache, type AnswerCacheService } from "../application/ports/answer-cache"

interface Entry {
  readonly value: unknown
  readonly expiresAt: number
}

export const makeAnswerCacheLive = (options: {
  readonly capacity: number
  readonly ttlMillis: number
}): Layer.Layer<AnswerCacheService> =>
  Layer.effect(
    AnswerCache,
    Effect.gen(function* () {
      const store = yield* Ref.make(new Map<string, Entry>())

      return {
        getOrCompute: <A, E, R>(key: string, compute: Effect.Effect<A, E, R>) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const cache = yield* Ref.get(store)
            const hit = cache.get(key)
            if (hit !== undefined && hit.expiresAt > now) {
              return hit.value as A
            }

            const value = yield* compute
            yield* Ref.update(store, (current) => {
              const next = new Map(current)
              next.delete(key)
              next.set(key, { value, expiresAt: now + options.ttlMillis })
              while (next.size > options.capacity) {
                const oldest = next.keys().next()
                if (oldest.done === true) break
                next.delete(oldest.value)
              }
              return next
            })
            return value
          })
      }
    })
  )
