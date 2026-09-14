/**
 * 用量账本的不变量（H1"先度量"的地基）。
 *
 * 这一层要钉死四件事：
 * 1. **不存原文**：落盘的账目行里绝不能出现用户问的那句话；
 * 2. **字段不许悄悄少**：账目键集合被冻结，加/删字段必须是一次有意识的改动
 *    （报表悄悄空掉一列，比报表报错更难发现）；
 * 3. **窗口与比率是纯函数**：跨 UTC 日、分母为零、均值，都能直接单测；
 * 4. **环形缓冲有界**：长期运行不会把内存吃光。
 */
import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import {
  ASK_USAGE_FIELDS,
  accumulate,
  averageDurationMs,
  cacheHitRate,
  citationResolvability,
  emptyWindow,
  rate,
  refusalRate,
  summarize,
  utcDayStart,
  verifiableRate,
  type AskUsageRecord
} from "../../src/contexts/assistant/application/ports/usage-log"
import {
  USAGE_LINE_PREFIX,
  makeUsageLogLive,
  toUsageLine
} from "../../src/contexts/assistant/infrastructure/usage-log-live"
import { UsageLog } from "../../src/contexts/assistant/application/ports/usage-log"

const record = (overrides: Partial<AskUsageRecord> = {}): AskUsageRecord => ({
  // 用真实时钟：窗口是相对"现在"切的（见 summarize 的 UTC 日边界）
  at: Date.now(),
  questionHash: "0123456789abcdef",
  questionLength: 12,
  mode: "llm",
  refused: false,
  citations: 3,
  resolvableCitations: 3,
  scoped: false,
  rewritten: false,
  expanded: false,
  reranked: false,
  cacheHit: false,
  durationMs: 1200,
  ...overrides
})

describe("账目字段清单（CI 门禁：埋点字段不许缺）", () => {
  it("清单是本文件冻结的那 14 项", () => {
    // 改这个数组 = 明确承认"埋点形状变了"（消费方与报表要跟着改）
    expect([...ASK_USAGE_FIELDS]).toEqual([
      "at",
      "questionHash",
      "questionLength",
      "mode",
      "refused",
      "refusalReason",
      "citations",
      "resolvableCitations",
      "scoped",
      "rewritten",
      "expanded",
      "reranked",
      "cacheHit",
      "durationMs"
    ])
  })

  it("一条完整账目的键集合与清单一致（不缺不多）", () => {
    const entry = record({ refusalReason: "no-match" })
    expect(Object.keys(entry).sort()).toEqual([...ASK_USAGE_FIELDS].sort())
  })

  it("落盘行覆盖了每一个字段（短名 → 长名一一对应）", () => {
    const line = toUsageLine(record({ refusalReason: "untranslated" }), record().at)
    const json = JSON.parse(line.slice(USAGE_LINE_PREFIX.length + 1)) as Record<string, unknown>
    // 与 ASK_USAGE_FIELDS 一一对应；少一个就说明"报表会悄悄空一列"
    expect(Object.keys(json).sort()).toEqual([
      "at",
      "cacheHit",
      "cites",
      "expanded",
      "mode",
      "ms",
      "qHash",
      "qLen",
      "reason",
      "refused",
      "reranked",
      "resolvable",
      "rewritten",
      "scoped"
    ])
  })

  it("落盘行里没有原文（只有 hash 与长度）", () => {
    const line = toUsageLine(record({ questionHash: "deadbeefdeadbeef" }), record().at)
    expect(line.startsWith(USAGE_LINE_PREFIX)).toBe(true)
    expect(line).toContain("deadbeefdeadbeef")
    expect(line).not.toContain("怎么")
  })
})

describe("窗口聚合（纯函数）", () => {
  it("逐条累加：拒答原因、可验证、模型/缓存、引用数都对得上", () => {
    const window = [
      record({ mode: "extractive", refused: true, refusalReason: "no-match", citations: 0, resolvableCitations: 0 }),
      record({ refused: true, refusalReason: "untranslated", citations: 0, resolvableCitations: 0 }),
      record({ cacheHit: true, expanded: true }),
      record({ resolvableCitations: 1, rewritten: true, reranked: true, durationMs: 800 })
    ].reduce(accumulate, emptyWindow())

    expect(window.asks).toBe(4)
    expect(window.refused).toBe(2)
    expect(window.noMatch).toBe(1)
    expect(window.untranslated).toBe(1)
    // 后两条有可解引用引用 ⇒ 可验证
    expect(window.verifiable).toBe(2)
    expect(window.llm).toBe(3)
    expect(window.extractive).toBe(1)
    expect(window.cacheHits).toBe(1)
    expect(window.expanded).toBe(1)
    expect(window.rewritten).toBe(1)
    expect(window.reranked).toBe(1)
    // 前两条是拒答（0 引用），后两条各 3 条引用
    expect(window.citations).toBe(6)
    expect(window.resolvableCitations).toBe(3 + 1)
  })

  it("比率：分母为零时给 0，而不是 NaN（报表里出现 NaN 会让人怀疑整份数据）", () => {
    const empty = emptyWindow()
    expect(rate(0, 0)).toBe(0)
    expect(refusalRate(empty)).toBe(0)
    expect(verifiableRate(empty)).toBe(0)
    expect(citationResolvability(empty)).toBe(0)
    expect(cacheHitRate(empty)).toBe(0)
    expect(averageDurationMs(empty)).toBe(0)
  })

  it("北极星：可验证答率 = 至少有一条可解引用引用的回答占比", () => {
    const window = [
      record(), // 可验证
      record({ resolvableCitations: 0 }), // 有引用但都不可解引用 ⇒ 不算
      record({ refused: true, refusalReason: "no-match", citations: 0, resolvableCitations: 0 })
    ].reduce(accumulate, emptyWindow())
    expect(verifiableRate(window)).toBeCloseTo(1 / 3, 5)
    expect(refusalRate(window)).toBeCloseTo(1 / 3, 5)
    expect(citationResolvability(window)).toBeCloseTo(3 / 6, 5)
    expect(averageDurationMs(window)).toBe(1200)
  })

  it("窗口切分：today 与 last7Days 用 UTC 日边界，与 token 预算同一把尺子", () => {
    const now = Date.UTC(2026, 8, 13, 10, 0, 0)
    const entries = [
      record({ at: utcDayStart(now) - 8 * 86_400_000 }), // 太久远：两个窗口都不算
      record({ at: utcDayStart(now) - 3 * 86_400_000 }), // 7 天内
      record({ at: utcDayStart(now) + 60_000 }) // 今天
    ]
    const stats = summarize(entries, now, 20_000)
    expect(stats.last7Days.asks).toBe(2)
    expect(stats.today.asks).toBe(1)
    expect(stats.recorded).toBe(3)
    expect(stats.since).toBe(entries[0]?.at)
  })
})

describe("Layer：落账 + 即时读数", () => {
  it("record 之后 stats 立刻能看到，且日志行被写出去", async () => {
    const lines: Array<string> = []
    const layer = makeUsageLogLive({ emit: (line) => lines.push(line) })

    const stats = await Effect.runPromise(
      Effect.gen(function* () {
        const log = yield* UsageLog
        yield* log.record(record())
        yield* log.record(record({ refused: true, refusalReason: "no-match", citations: 0, resolvableCitations: 0 }))
        return yield* log.stats
      }).pipe(Effect.provide(layer))
    )

    expect(stats.today.asks).toBe(2)
    expect(stats.today.refused).toBe(1)
    expect(stats.recorded).toBe(2)
    expect(lines.length).toBe(2)
    expect(lines[0]?.startsWith(USAGE_LINE_PREFIX)).toBe(true)
  })

  it("环形缓冲有界：超出容量只保留最近 N 条", async () => {
    const layer = makeUsageLogLive({ capacity: 3, emit: () => {} })
    const stats = await Effect.runPromise(
      Effect.gen(function* () {
        const log = yield* UsageLog
        for (let index = 0; index < 10; index += 1) {
          yield* log.record(record({ at: record().at + index, durationMs: index }))
        }
        return yield* log.stats
      }).pipe(Effect.provide(layer))
    )
    expect(stats.recorded).toBe(3)
    expect(stats.capacity).toBe(3)
    // 留下的应当是最后三条（at 递增）
    expect(stats.today.asks).toBe(3)
  })

  it("空账本也能安全读数（站点刚上线时 /stats 不能报错）", async () => {
    const layer = makeUsageLogLive({ emit: () => {} })
    const stats = await Effect.runPromise(
      Effect.gen(function* () {
        const log = yield* UsageLog
        return yield* log.stats
      }).pipe(Effect.provide(layer))
    )
    expect(stats.today.asks).toBe(0)
    expect(stats.last7Days.asks).toBe(0)
    expect(stats.since).toBe(0)
  })
})
