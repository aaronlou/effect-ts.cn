/**
 * Knowledge 上下文 · infrastructure：把 @ecn/knowledge 的纯函数检索装配成服务。
 *
 * 语料是构建期产物（packages/knowledge/data/corpus.json），随仓库提交：
 * 因此这里零 IO、零冷启动、零外部依赖 —— 问答在本地毫秒级完成。
 */
import { Effect, Layer, Option } from "effect"
import {
  composeAnswer,
  corpus,
  createCorpusIndex,
  createTopicRouter,
  type CorpusPage,
  type CorpusPendingPage,
  type SearchHit
} from "@ecn/knowledge"
import { KnowledgeBase, type KnowledgeBaseService } from "../domain/ports/knowledge-base"

const index = createCorpusIndex(corpus)
const router = createTopicRouter(corpus.pages, corpus.pending)
const pagesBySlug = new Map(corpus.pages.map((page) => [page.slug, page]))

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
  ask: (question, options) =>
    Effect.suspend(() => {
      const routed = router.route(question)
      const boostSlugs = routed.kind === "translated" ? routed.slugs : []
      const hits = index.search(question, {
        ...(options?.scope !== undefined ? { scopeSlug: options.scope } : {}),
        ...(options?.version !== undefined ? { version: options.version } : {}),
        // 限定了页面时，同一页的多个小节都值得引用
        maxPerPage: options?.scope !== undefined ? 3 : 1,
        limit: 5,
        ...(boostSlugs.length > 0 ? { boostSlugs } : {})
      })
      return Effect.succeed(
        composeAnswer({
          question,
          hits,
          pending: corpus.pending,
          options: {
            router,
            ...(options?.maxCitations !== undefined ? { maxCitations: options.maxCitations } : {})
          }
        })
      )
    })
}) satisfies Layer.Layer<KnowledgeBaseService, never, never>
