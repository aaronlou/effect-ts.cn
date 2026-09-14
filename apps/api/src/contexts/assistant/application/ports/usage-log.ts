/**
 * Assistant 上下文 · 端口：用量账本（AI 问答的**可度量**）
 *
 * 为什么必须有：在它之前，`POST /api/knowledge/ask` **不留任何痕迹** ——
 * 问题不落库、调用不打点，于是"问了多少、拒答多少、拒答里多少是'没这一页'、
 * 引用真的能解引用吗"全都没有数据。没有这些数字，任何产品决策都是猜。
 *
 * 三条设计约束（都是刻意的）：
 * 1. **不存原文**：只存问题归一化后的 hash 与前缀长度。站点的隐私口径是
 *    "默认不持久化用户粘贴的东西"，度量不能成为例外；
 * 2. **不引入新的存储依赖**：进程内环形缓冲供 `/api/knowledge/stats` 直接读，
 *    同时按行输出 JSONL 到 stdout（容器日志）作为**可离线分析**的durable 通道 ——
 *    与本站"访问记录的权威来源是宿主日志"同一套运维模型；
 * 3. **聚合是纯函数**：跨日窗口、比率、均值都能直接单测，不依赖时钟与 IO。
 */
import { Context, Effect } from "effect"

/** 单次问答的账目（一问一条；不存问题原文） */
export interface AskUsageRecord {
  /** 记账时刻（epoch 毫秒） */
  readonly at: number
  /** 归一化问题的 sha256 前 16 位十六进制：用于"重复率"分析，无法反推原文 */
  readonly questionHash: string
  /** 归一化问题长度（字符）—— 只能看出"问得长不长"，看不出问了什么 */
  readonly questionLength: number
  readonly mode: "extractive" | "llm"
  readonly refused: boolean
  readonly refusalReason?: "no-match" | "untranslated"
  /** 本次返回的引用条数 */
  readonly citations: number
  /** 其中**带 `/cite/<digest>.json`**（即可被独立解引用核验）的条数 */
  readonly resolvableCitations: number
  /** 是否限定在某一页（"问这一页"） */
  readonly scoped: boolean
  /** 是否做了指代消解（追问改写） */
  readonly rewritten: boolean
  /** 是否做过术语化扩展 */
  readonly expanded: boolean
  /** 是否做过候选重排 */
  readonly reranked: boolean
  /** 是否命中答案缓存（命中 = 零 token） */
  readonly cacheHit: boolean
  /** 端到端耗时（毫秒） */
  readonly durationMs: number
}

/**
 * 账目字段清单（冻结）。
 *
 * CI 有断言：`AskUsageRecord` 的实际键必须与这份清单**完全一致**。
 * 目的是让"少埋一个字段"变成一次有意识的改动 —— 报表悄悄空掉一列，
 * 比报表报错更难发现。
 */
export const ASK_USAGE_FIELDS = [
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
] as const

/** 窗口聚合（某一时间段的汇总；全是计数与累计，便于纯函数演进） */
export interface UsageWindow {
  readonly asks: number
  readonly refused: number
  readonly noMatch: number
  readonly untranslated: number
  /** 至少有一条**可解引用**引用的回答数（"可验证答率"的分子） */
  readonly verifiable: number
  readonly llm: number
  readonly extractive: number
  readonly cacheHits: number
  readonly rewritten: number
  readonly expanded: number
  readonly reranked: number
  readonly citations: number
  readonly resolvableCitations: number
  readonly durationMsTotal: number
}

export interface UsageStats {
  /** 今日（UTC 日，与 token 预算同一把尺子） */
  readonly today: UsageWindow
  /** 最近 7 天（含今日） */
  readonly last7Days: UsageWindow
  /** 进程内保留的账目条数（重启即清零：它防的是"看不见"，不是"精算"） */
  readonly recorded: number
  /** 环形缓冲容量 */
  readonly capacity: number
  /** 最早一条账目的时刻（epoch 毫秒；没有账目时为 0） */
  readonly since: number
}

export interface UsageLogService {
  readonly record: (entry: AskUsageRecord) => Effect.Effect<void>
  readonly stats: Effect.Effect<UsageStats>
}

export const UsageLog = Context.GenericTag<UsageLogService>("assistant/UsageLog")

export const DAY_MILLIS = 86_400_000

/** 与 token 预算一致：按 UTC 日切分，重置点可预期 */
export const utcDayStart = (millis: number): number => Math.floor(millis / DAY_MILLIS) * DAY_MILLIS

export const emptyWindow = (): UsageWindow => ({
  asks: 0,
  refused: 0,
  noMatch: 0,
  untranslated: 0,
  verifiable: 0,
  llm: 0,
  extractive: 0,
  cacheHits: 0,
  rewritten: 0,
  expanded: 0,
  reranked: 0,
  citations: 0,
  resolvableCitations: 0,
  durationMsTotal: 0
})

export const accumulate = (window: UsageWindow, entry: AskUsageRecord): UsageWindow => ({
  asks: window.asks + 1,
  refused: window.refused + (entry.refused ? 1 : 0),
  noMatch: window.noMatch + (entry.refusalReason === "no-match" ? 1 : 0),
  untranslated: window.untranslated + (entry.refusalReason === "untranslated" ? 1 : 0),
  verifiable: window.verifiable + (!entry.refused && entry.resolvableCitations > 0 ? 1 : 0),
  llm: window.llm + (entry.mode === "llm" ? 1 : 0),
  extractive: window.extractive + (entry.mode === "extractive" ? 1 : 0),
  cacheHits: window.cacheHits + (entry.cacheHit ? 1 : 0),
  rewritten: window.rewritten + (entry.rewritten ? 1 : 0),
  expanded: window.expanded + (entry.expanded ? 1 : 0),
  reranked: window.reranked + (entry.reranked ? 1 : 0),
  citations: window.citations + entry.citations,
  resolvableCitations: window.resolvableCitations + entry.resolvableCitations,
  durationMsTotal: window.durationMsTotal + entry.durationMs
})

export const windowSince = (entries: ReadonlyArray<AskUsageRecord>, from: number): UsageWindow =>
  entries.filter((entry) => entry.at >= from).reduce(accumulate, emptyWindow())

/** 比率：分母为 0 时返回 0（而不是 NaN —— 报表里出现 NaN 会让人怀疑整份数据） */
export const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator

/** 拒答率：越高说明"检索够不着"，是内容与检索的体检指标 */
export const refusalRate = (window: UsageWindow): number => rate(window.refused, window.asks)

/** 可验证答率（北极星）：回答里**至少有一条可解引用引用**的比例 */
export const verifiableRate = (window: UsageWindow): number => rate(window.verifiable, window.asks)

/** 引用可解引用率：引用条数层面的可核验性 */
export const citationResolvability = (window: UsageWindow): number =>
  rate(window.resolvableCitations, window.citations)

export const averageDurationMs = (window: UsageWindow): number =>
  window.asks === 0 ? 0 : Math.round(window.durationMsTotal / window.asks)

/** 缓存命中率 —— 直接对应省下来的 token */
export const cacheHitRate = (window: UsageWindow): number => rate(window.cacheHits, window.asks)

export const summarize = (entries: ReadonlyArray<AskUsageRecord>, now: number, capacity: number): UsageStats => ({
  today: windowSince(entries, utcDayStart(now)),
  last7Days: windowSince(entries, utcDayStart(now) - 6 * DAY_MILLIS),
  recorded: entries.length,
  capacity,
  since: entries.length === 0 ? 0 : (entries[0]?.at ?? 0)
})
