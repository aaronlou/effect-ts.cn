/**
 * Knowledge 上下文 · infrastructure：把 @ecn/knowledge 的纯函数检索装配成服务。
 *
 * 语料是构建期产物（packages/knowledge/data/corpus.json），随仓库提交：
 * 因此这里零 IO、零冷启动、零外部依赖 —— 问答在本地毫秒级完成。
 */
import { Effect, Layer, Option } from "effect"
import {
  composeAnswer,
  composeExplanation,
  corpus,
  PATTERN_MATCH_SCORE,
  chunksForPattern,
  createCorpusIndex,
  matchErrorPattern,
  createTopicRouter,
  extractIdentifiers,
  fuseHits,
  type CorpusPage,
  type CorpusPendingPage,
  type SearchHit
} from "@ecn/knowledge"
import {
  KnowledgeBase,
  type KnowledgeAskOptions,
  type KnowledgeBaseService
} from "../domain/ports/knowledge-base"

const index = createCorpusIndex(corpus)
const router = createTopicRouter(corpus.pages, corpus.pending)
const pagesBySlug = new Map(corpus.pages.map((page) => [page.slug, page]))

/** 候选条数：比最终引用数（默认 3）多留一些，供模型重排时"把第 4 名提上来" */
const CANDIDATE_LIMIT = 8

/** 单次检索：话题归属给的页面加权 + 页面/版本限定，与旧版 ask 完全一致 */
function searchOnce(question: string, options?: KnowledgeAskOptions): ReadonlyArray<SearchHit> {
  const routed = router.route(question)
  const boostSlugs = routed.kind === "translated" ? routed.slugs : []
  return index.search(question, {
    ...(options?.scope !== undefined ? { scopeSlug: options.scope } : {}),
    ...(options?.version !== undefined ? { version: options.version } : {}),
    // 限定了页面时，同一页的多个小节都值得引用
    maxPerPage: options?.scope !== undefined ? 3 : 1,
    limit: CANDIDATE_LIMIT,
    ...(boostSlugs.length > 0 ? { boostSlugs } : {})
  })
}

/** 候选 = 原查询 ∪ 各条术语化改写，RRF 融合后统一排序（只有一路时不融合，保留原次序） */
function collectCandidates(question: string, options?: KnowledgeAskOptions): ReadonlyArray<SearchHit> {
  const primary = searchOnce(question, options)
  const alternatives = (options?.altQueries ?? [])
    .map((query) => query.trim())
    .filter((query) => query !== "" && query !== question)
    .map((query) => searchOnce(query, options))
  return alternatives.length === 0 ? primary : fuseHits([primary, ...alternatives])
}

/** 组装答案：引用构造、拒答判定、话题归属的唯一入口 */
function assemble(
  question: string,
  hits: ReadonlyArray<SearchHit>,
  options?: { readonly maxCitations?: number }
) {
  return composeAnswer({
    question,
    hits,
    pending: corpus.pending,
    options: {
      router,
      ...(options?.maxCitations !== undefined ? { maxCitations: options.maxCitations } : {})
    }
  })
}

export const KnowledgeBaseLive = Layer.succeed(KnowledgeBase, {
  stats: () => Effect.succeed(corpus.stats),
  generatedAt: () => Effect.succeed(corpus.generatedAt),
  search: (query, options): Effect.Effect<ReadonlyArray<SearchHit>> =>
    Effect.succeed(
      index.search(query, {
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        ...(options?.scopeSlug !== undefined ? { scopeSlug: options.scopeSlug } : {}),
        ...(options?.version !== undefined ? { version: options.version } : {}),
        ...(options?.maxPerPage !== undefined ? { maxPerPage: options.maxPerPage } : {})
      })
    ),
  pending: (): Effect.Effect<ReadonlyArray<CorpusPendingPage>> => Effect.succeed(corpus.pending),
  page: (slug: string): Effect.Effect<Option.Option<CorpusPage>> => {
    const page = pagesBySlug.get(slug)
    return Effect.succeed(page === undefined ? Option.none() : Option.some(page))
  },
  explain: (errorText, options) =>
    Effect.sync(() => {
      /**
       * 先看**报错模式表**：运行期报错的信号在语义里（`Service not found`），
       * 不在 API 名上 —— 这类报错提不出任何标识符，走检索只会得到空结果并被拒答。
       *
       * 模式命中时把它的目标页放在**最前面**，但**不丢弃原有检索结果**：
       * 有些报错既有特征串、又提到了具体 API，两边都可能有价值
       * （模式命中分 20，高于检索通常的 3–15，所以顺序有保证）。
       */
      const pattern = matchErrorPattern(errorText)
      const patternHits =
        pattern === undefined
          ? []
          : chunksForPattern(corpus.pages, pattern).map(({ page, chunk }) => ({
              chunk,
              page,
              score: PATTERN_MATCH_SCORE
            }))

      const identifiers = extractIdentifiers(errorText)
      const query = identifiers.length > 0 ? identifiers.join(" ") : errorText.slice(0, 200)
      const retrieved = index.search(query, { limit: 5, maxPerPage: 1 })
      const hits = [...patternHits, ...retrieved]
      return composeExplanation({
        errorText,
        okHits: hits,
        ...(pattern !== undefined ? { patternMatch: { id: pattern.id, label: pattern.label } } : {}),
        pending: corpus.pending,
        router,
        ...(options?.maxCitations !== undefined ? { options: { maxCitations: options.maxCitations } } : {})
      })
    }),
  candidates: (question, options) => Effect.sync(() => collectCandidates(question, options)),
  composeFrom: (question, hits, options) => Effect.sync(() => assemble(question, hits, options)),
  ask: (question, options) =>
    Effect.sync(() => assemble(question, collectCandidates(question, options), options))
}) satisfies Layer.Layer<KnowledgeBaseService, never, never>
