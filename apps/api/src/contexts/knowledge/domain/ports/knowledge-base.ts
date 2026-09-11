/**
 * Knowledge 上下文 · 端口：知识库（检索 + 答案合成）
 *
 * 为什么要有这层端口：assistant 上下文不应关心检索是 BM25、向量还是混合。
 * 当前适配器是 `@ecn/knowledge` 的 BM25F-lite 实现；未来换向量检索时，
 * 只替换 infrastructure 的 Layer（这正是本仓库 DDD 的一贯做法）。
 */
import { Context, Effect, type Option } from "effect"
import type {
  AskResult,
  CorpusPage,
  CorpusPendingPage,
  CorpusStats,
  ExplainResult,
  SearchHit
} from "@ecn/knowledge"

export interface KnowledgeSearchOptions {
  readonly limit?: number
  readonly scopeSlug?: string
  readonly version?: string
  readonly maxPerPage?: number
}

export interface KnowledgeAskOptions {
  readonly scope?: string
  readonly version?: string
  readonly maxCitations?: number
  /**
   * 备选查询（术语化改写）。与原查询一起做 RRF 融合，**只影响排序**，
   * 引用集合仍完全由检索决定 —— 见 packages/knowledge/src/fusion.ts。
   */
  readonly altQueries?: ReadonlyArray<string>
}

export interface KnowledgeBaseService {
  readonly stats: () => Effect.Effect<CorpusStats>
  readonly generatedAt: () => Effect.Effect<string>
  readonly search: (
    query: string,
    options?: KnowledgeSearchOptions
  ) => Effect.Effect<ReadonlyArray<SearchHit>>
  readonly pending: () => Effect.Effect<ReadonlyArray<CorpusPendingPage>>
  readonly page: (slug: string) => Effect.Effect<Option.Option<CorpusPage>>
  /** 报错解释：提取锚点 → 检索 → 引用/拒答（与 ask 共享引用不变量） */
  readonly explain: (
    errorText: string,
    options?: { readonly maxCitations?: number }
  ) => Effect.Effect<ExplainResult>
  /**
   * 只做"取候选"：检索（含备选查询的 RRF 融合）→ 排序好的命中，不做引用/拒答判定。
   *
   * 拆出来是为了让 assistant 层能在"检索"与"组装答案"之间插入模型重排；
   * 重排只允许换顺序，引用集合与拒答仍由 composeFrom（即 composeAnswer）说了算。
   */
  readonly candidates: (
    question: string,
    options?: KnowledgeAskOptions
  ) => Effect.Effect<ReadonlyArray<SearchHit>>
  /** 用"已经定序的候选"组装答案：引用构造、拒答判定、话题归属全在这里 */
  readonly composeFrom: (
    question: string,
    hits: ReadonlyArray<SearchHit>,
    options?: { readonly maxCitations?: number }
  ) => Effect.Effect<AskResult>
  /** 组合检索 + 引用 + 拒答（不变量的唯一入口） */
  readonly ask: (
    question: string,
    options?: KnowledgeAskOptions
  ) => Effect.Effect<AskResult>
}

export const KnowledgeBase =
  Context.GenericTag<KnowledgeBaseService>("knowledge/KnowledgeBase")
