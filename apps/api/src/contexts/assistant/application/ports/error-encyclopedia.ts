/**
 * Assistant 上下文 · 端口：报错百科。
 *
 * 定位：把 `/debug` 的一次性诊断**沉淀**成可检索、可链接、可累积的公开条目。
 * 这是整个站上唯一一个"用户增长 = 资产增长"的功能 —— 每多一个人来问，
 * 这份库就厚一点，而命中同签名的提问是零 token 的。
 *
 * 两条治理纪律（写进类型与适配器，不靠自觉）：
 *   1. **只收有特征的报错**：没有错误码、也提不出类型名的输入不落库
 *      （判断在 packages/knowledge 的 `errorSignature().confident`）；
 *   2. **一律标记为机器生成、未经人审**：`reviewed` 默认 false，展示层必须如实标注。
 *      把 AI 的诊断包装成"社区已验证的答案"是这个功能最容易犯、也最致命的错。
 */
import { Context, type Effect } from "effect"
import type { Citation } from "@ecn/knowledge"

export interface ErrorEncyclopediaEntry {
  readonly signature: string
  readonly codes: readonly string[]
  readonly symbols: readonly string[]
  /** 代表性报错样本（截断） */
  readonly errorText: string
  readonly code?: string
  readonly answer: string
  readonly citations: readonly Citation[]
  readonly mode: "extractive" | "llm"
  /** 被问到的次数 */
  readonly hits: number
  readonly firstSeen: string
  readonly lastSeen: string
  /** 是否经人确认（当前全部为 false —— 展示层不得省略这个事实） */
  readonly reviewed: boolean
}

export interface RecordErrorInput {
  readonly signature: string
  readonly codes: readonly string[]
  readonly symbols: readonly string[]
  readonly errorText: string
  readonly code?: string
  readonly answer: string
  readonly citations: readonly Citation[]
  readonly mode: "extractive" | "llm"
}

export interface ErrorEncyclopediaService {
  /** 记一条（存在则 `hits + 1` 并刷新 answer/citations/last_seen）。**不抛错**：记录失败不该影响诊断本身。 */
  readonly record: (input: RecordErrorInput) => Effect.Effect<void>
  /** 列表：按被问次数与最近时间排序 */
  readonly list: (options?: { readonly limit?: number }) => Effect.Effect<readonly ErrorEncyclopediaEntry[]>
  readonly get: (signature: string) => Effect.Effect<ErrorEncyclopediaEntry | undefined>
  /** 条目总数（用于统计与"这份库有多厚"） */
  readonly size: Effect.Effect<number>
}

export const ErrorEncyclopedia =
  Context.GenericTag<ErrorEncyclopediaService>("assistant/ErrorEncyclopedia")
