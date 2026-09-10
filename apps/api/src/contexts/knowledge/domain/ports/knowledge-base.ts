/**
 * Knowledge 上下文 · 端口：知识库（检索 + 答案合成）
 *
 * 为什么要有这层端口：assistant 上下文不应关心检索是 BM25、向量还是混合。
 * 当前适配器是 `@ecn/knowledge` 的 BM25F-lite 实现；未来换向量检索时，
 * 只替换 infrastructure 的 Layer（这正是本仓库 DDD 的一贯做法）。
 */
import { Context, Effect, type Option } from "effect"
import type { AskResult, CorpusPage, CorpusPendingPage, SearchHit, CorpusStats } from "@ecn/knowledge"

export interface KnowledgeSearchOptions {
  readonly limit?: number
  readonly scopeSlug?: string
  readonly version?: string
  readonly maxPerPage?: number
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
  /** 组合检索 + 引用 + 拒答（不变量的唯一入口） */
  readonly ask: (
    question: string,
    options?: { readonly scope?: string; readonly version?: string; readonly maxCitations?: number }
  ) => Effect.Effect<AskResult>
}

export const KnowledgeBase =
  Context.GenericTag<KnowledgeBaseService>("knowledge/KnowledgeBase")
