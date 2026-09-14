/**
 * Assistant 上下文 · infrastructure：用量账本（进程内环形缓冲 + stdout JSONL）
 *
 * 为什么是"内存 + stdout"而不是直接上数据库：
 * - 生产 API 目前是**单实例、无必选数据库**（`DATABASE_URL` 缺省即 InMemory），
 *   为了度量而强制引入 Postgres 是本末倒置；
 * - 站点已有的运维模型是"**权威记录在宿主日志**"（Caddy）——
 *   这里把每条账目按行输出 JSONL 到 stdout，`docker logs ecn-api | grep ecn.usage`
 *   就能离线复算，重启容器也不影响已落日志；
 * - 进程内缓冲只服务 `/api/knowledge/stats` 的即时读数（今日 / 最近 7 天）。
 *
 * 什么时候该换掉它：多实例部署，或需要跨重启的精确历史。
 * 那时把本文件换成基于 Postgres 的实现即可 —— 端口（UsageLogService）不变。
 *
 * 隐私：账目里**没有**问题原文，只有归一化 hash 与长度（见 ports/usage-log.ts）。
 */
import { Clock, Effect, Layer, Ref } from "effect"
import {
  UsageLog,
  type AskUsageRecord,
  type UsageLogService,
  summarize
} from "../application/ports/usage-log"

/** 日志行前缀：让宿主上一条 grep 就能把账目与其它日志分开 */
export const USAGE_LINE_PREFIX = "ecn.usage"

/** 环形缓冲默认容量：按当前量级足够覆盖 7 天以上，内存占用可忽略（每条约 200 字节） */
export const DEFAULT_USAGE_CAPACITY = 20_000

/**
 * 账目 → 单行 JSON（**不含原文**）。
 *
 * 字段名刻意短：这是要长期落盘的日志流，体积就是成本；
 * 但每个短名的含义在本文件与 ports/usage-log.ts 里都有对应说明。
 */
export function toUsageLine(entry: AskUsageRecord, at: number): string {
  return `${USAGE_LINE_PREFIX} ${JSON.stringify({
    at: new Date(at).toISOString(),
    qHash: entry.questionHash,
    qLen: entry.questionLength,
    mode: entry.mode,
    refused: entry.refused,
    ...(entry.refusalReason !== undefined ? { reason: entry.refusalReason } : {}),
    cites: entry.citations,
    resolvable: entry.resolvableCitations,
    scoped: entry.scoped,
    rewritten: entry.rewritten,
    expanded: entry.expanded,
    reranked: entry.reranked,
    cacheHit: entry.cacheHit,
    ms: entry.durationMs
  })}`
}

export interface UsageLogOptions {
  /** 环形缓冲容量 */
  readonly capacity?: number
  /**
   * 账目行的出口。默认写 stdout（容器日志）；
   * 测试里注入一个数组收集器，就能断言"落账了"且"没有泄露原文"。
   */
  readonly emit?: (line: string) => void
}

export const makeUsageLogLive = (options: UsageLogOptions = {}): Layer.Layer<UsageLogService> => {
  const capacity = options.capacity ?? DEFAULT_USAGE_CAPACITY
  const emit = options.emit ?? ((line: string) => process.stdout.write(`${line}\n`))

  return Layer.effect(
    UsageLog,
    Effect.gen(function* () {
      const entries = yield* Ref.make<ReadonlyArray<AskUsageRecord>>([])

      return {
        record: (entry) =>
          Effect.gen(function* () {
            // 先落日志（durable），再进内存缓冲（即时读数）：两者失败互不牵连
            yield* Effect.sync(() => emit(toUsageLine(entry, entry.at)))
            yield* Ref.update(entries, (current) => {
              const next = [...current, entry]
              return next.length > capacity ? next.slice(next.length - capacity) : next
            })
          }),
        stats: Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const current = yield* Ref.get(entries)
          return summarize(current, now, capacity)
        })
      }
    })
  )
}
