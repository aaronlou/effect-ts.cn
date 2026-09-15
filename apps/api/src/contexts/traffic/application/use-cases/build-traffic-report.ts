/**
 * Traffic 上下文 · 应用用例：生成访问报表。
 *
 * 为什么带缓存：日志最多会有 6 个文件 × 10 MiB（当前 + 5 个轮转备份）≈ 60 MB。
 * 每次打开后台都全量解析一遍，既慢又没必要 —— 访问数据的变化尺度是分钟级，
 * 给它 60 秒的缓存完全够用，代价是"刚发生的访问可能还看不到"（报表上会标出生成时刻）。
 *
 * 缓存按 (rangeHours, TTL) 判定：切换时间窗会立刻重算，不会被上一次的结果糊弄。
 */
import { Clock, Context, Effect, Layer, Ref } from "effect"
import { buildReport, type TrafficReport } from "../../domain/report.js"
import { TrafficLog, type TrafficLogUnavailable } from "../ports/traffic-log.js"

const HOUR_MS = 60 * 60 * 1000

export interface TrafficReporterService {
  /** 取最近 `rangeHours` 小时的报表 */
  readonly get: (rangeHours: number) => Effect.Effect<TrafficReport, TrafficLogUnavailable>
}

export const TrafficReporter = Context.GenericTag<TrafficReporterService>("traffic/TrafficReporter")

export interface TrafficReporterOptions {
  readonly ttlMs: number
}

export const makeTrafficReporter = (options: TrafficReporterOptions) =>
  Layer.effect(
    TrafficReporter,
    Effect.gen(function* () {
      const log = yield* TrafficLog
      const cache = yield* Ref.make<
        { readonly at: number; readonly rangeHours: number; readonly report: TrafficReport } | undefined
      >(undefined)

      const get = (rangeHours: number) =>
        Effect.gen(function* () {
          const nowMs = yield* Clock.currentTimeMillis
          const cached = yield* Ref.get(cache)
          if (
            cached !== undefined &&
            cached.rangeHours === rangeHours &&
            nowMs - cached.at < options.ttlMs
          ) {
            return cached.report
          }

          const now = new Date(nowMs)
          const { events, logFiles } = yield* log.readSince(new Date(nowMs - rangeHours * HOUR_MS))
          const report = buildReport(events, { rangeHours, now, logFiles })
          yield* Ref.set(cache, { at: nowMs, rangeHours, report })
          return report
        })

      return { get }
    })
  )
