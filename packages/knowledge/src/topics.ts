/**
 * 话题归属（Topic Ownership）：判断一个问题"应该由哪一页回答"。
 *
 * 为什么需要它：纯检索排序解决不了这种情况 ——
 * 问「Layer 怎么做依赖注入？」时，`onboarding` 的正文确实顺带提到"依赖注入"，
 * BM25 会给它很高的分数，于是系统会"勉强作答"；但真正拥有这个话题的官方页面
 * 是 `requirements-management/layers`（中文尚未翻译）。
 * 此时正确答案是**诚实地说"中文还没这一页"并给出英文原文**，而不是拼凑答案。
 *
 * 判定方式：
 * 1. 取问题里"可判别"的词（在全部页面标题中不常见的词 → 具备话题指向性）；
 * 2. 看这些词是否出现在**已翻译页面**的标题/章节名里（= 中文已覆盖该话题）；
 * 3. 若无人覆盖、但有**未翻译页面**的标题命中，则路由到 "pending"（未翻译）。
 */
import { isContentToken, QUERY_STOPWORDS, tokenize } from "./tokenize.js"
import type { CorpusPage, CorpusPendingPage } from "./types.js"

export type TopicRoute =
  | { readonly kind: "translated"; readonly slugs: ReadonlyArray<string> }
  | { readonly kind: "pending"; readonly pages: ReadonlyArray<CorpusPendingPage> }
  | { readonly kind: "none" }

export interface TopicRouter {
  readonly route: (question: string) => TopicRoute
}

/**
 * 话题归属用的停用词：与检索侧（bm25.ts）共用同一份 QUERY_STOPWORDS。
 * 这些词在"标题"里频繁出现（"为什么选择 Effect？"），不构成话题指向。
 */
const TOPIC_STOPWORDS: ReadonlySet<string> = QUERY_STOPWORDS

const topicTokensOf = (text: string): ReadonlySet<string> =>
  new Set([...tokenize(text)].filter((token) => isContentToken(token) && !TOPIC_STOPWORDS.has(token)))

const tokensOf = (text: string): ReadonlySet<string> => topicTokensOf(text)

export function createTopicRouter(
  pages: ReadonlyArray<CorpusPage>,
  pending: ReadonlyArray<CorpusPendingPage>
): TopicRouter {
  const isCjk = (token: string): boolean => /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+$/.test(token)

  const split = (tokens: ReadonlySet<string>) => ({
    named: [...tokens].filter((token) => !isCjk(token)),
    cjk: [...tokens].filter(isCjk)
  })

  /**
   * 归属判定刻意区分两类词：
   * - **具名话题词**（Layer / Fiber / Schema / Effect.gen / promise…）：
   *   只要出现在页面的标题、章节名、路径或**小节标题**里，就算该页拥有这个话题；
   * - **中文属性词**（安装 / 依赖 / 运行…）：
   *   必须出现在页面的**标题**里才算拥有 —— 否则"处理循环依赖"这种小节标题
   *   会把"Layer 怎么做依赖注入"误判成已覆盖。
   */
  const translated = pages.map((page) => {
    const anywhere = tokensOf(
      [
        page.title,
        page.sectionLabel ?? "",
        page.slug.replace(/[/-]/g, " "),
        ...page.chunks.flatMap((chunk) => chunk.headingPath)
      ].join(" ")
    )
    const titleOnly = tokensOf([page.title, page.sectionLabel ?? ""].join(" "))
    return {
      slug: page.slug,
      named: split(anywhere).named,
      cjkInTitle: split(titleOnly).cjk
    }
  })

  const pendingEntries = pending.map((page) => {
    const tokens = tokensOf(`${page.title} ${page.slug.replace(/[/-]/g, " ")}`)
    return { page, named: split(tokens).named, all: [...tokens] }
  })

  // 标题级文档频率：用于判断一个词是否有话题指向性（"effect" 到处都是 → 不算指向）
  const df = new Map<string, number>()
  for (const entry of [...translated, ...pendingEntries.map((item) => ({ signature: item.all }))]) {
    const tokens = "named" in entry ? [...entry.named, ...entry.cjkInTitle] : entry.signature
    for (const token of tokens) df.set(token, (df.get(token) ?? 0) + 1)
  }
  const totalPages = translated.length + pendingEntries.length
  /**
   * "有话题指向性"的门槛：必须是**绝对罕见**的词。
   * 不能简单用比例（如 40%）：像 "effect" 出现在 19 个标题里，占 234 页的 8%，
   * 但它显然不指向任何具体话题。取 min(8, 5%) 既能抓住 Layer/Fiber/Schema 这类
   * 话题词，又不会把通用词当成归属依据。
   */
  const dfThreshold = Math.max(1, Math.min(8, Math.floor(totalPages * 0.05)))
  /**
   * pending 侧用**更宽**的阈值：像 "schema" 这样的**章节级话题**会在几十个页面 slug 里出现，
   * 按严阈值会被判"不罕见"从而漏掉（用户问 Schema 却得不到"中文还没翻译"的诚实回答）。
   * translated 侧保持严阈值：页面"拥有"一个话题必须有特异性。
   */
  const broadThreshold = Math.max(1, Math.floor(totalPages * 0.4))

  return {
    route: (question) => {
      const query = tokensOf(question)
      if (query.size === 0) return { kind: "none" }
      const discriminative = [...query].filter((token) => (df.get(token) ?? 0) <= dfThreshold)
      const named = discriminative.filter((token) => !isCjk(token))
      const cjk = discriminative.filter(isCjk)

      const translatedOwners = translated
        .filter(
          (entry) =>
            named.some((token) => entry.named.includes(token)) ||
            cjk.some((token) => entry.cjkInTitle.includes(token))
        )
        .map((entry) => entry.slug)

      if (translatedOwners.length > 0) {
        return { kind: "translated", slugs: translatedOwners }
      }

      const broadDiscriminative = [...query].filter(
        (token) => !TOPIC_STOPWORDS.has(token) && (df.get(token) ?? 0) <= broadThreshold
      )
      if (broadDiscriminative.length === 0) return { kind: "none" }

      const pendingOwners = pendingEntries
        .filter((entry) => broadDiscriminative.some((token) => entry.all.includes(token)))
        .map((entry) => entry.page)
        // 站内文档以 v4 为准：建议里优先给 v4 页面（同时候选再退到 v3）
        .sort((left, right) => (left.version === "v4" ? 0 : 1) - (right.version === "v4" ? 0 : 1))

      if (pendingOwners.length > 0) {
        return { kind: "pending", pages: pendingOwners.slice(0, 3) }
      }
      return { kind: "none" }
    }
  }
}

/** 便捷：只为测试/工具使用（生产由 KnowledgeBaseLive 构建一次） */
export function routeQuestion(
  question: string,
  pages: ReadonlyArray<CorpusPage>,
  pending: ReadonlyArray<CorpusPendingPage>
): TopicRoute {
  return createTopicRouter(pages, pending).route(question)
}
