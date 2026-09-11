/**
 * 答案组装：把检索结果变成**可溯源**的回答。
 *
 * 不变量（贯穿 UI / HTTP / MCP）：
 * 1. 引用只能来自检索结果，模型不能自造 URL —— 因此引用由本模块构造，而非由模型输出；
 * 2. `citations` 为空 ⇒ 一律视为拒答（宁可说不知道，也不编）；
 * 3. 拒答要**有用**：区分"文档里没有"与"中文还没翻译"，后者直接给出英文原文入口。
 *
 * 当前实现是 extractive（无 LLM、零成本、可离线、可在 CI 评测）。
 * 配置了模型后，同一份 citations 会交给模型做行文润色（Layer 替换，见 apps/api）。
 */
import type { SearchHit } from "./bm25.js"
import { citationIdOf, citeUrlOf } from "./citation.js"
import { isDefinitionalQuestion, isDefinitionHeading } from "./intent.js"
import { splitSentences } from "./markdown.js"
import { isContentToken, tokenize } from "./tokenize.js"
import type { AskResult, Citation, CorpusPendingPage, Refusal } from "./types.js"
import type { TopicRouter } from "./topics.js"

const DEFAULT_MIN_SCORE = 3
const DEFAULT_MAX_CITATIONS = 3

export const ANSWER_DISCLAIMER =
  "以上内容由站内中文译文检索合成，可能不完整或有误 —— 请以引用页面（及上游原文）为准。"

function contentTokens(text: string): ReadonlySet<string> {
  return new Set(tokenize(text).filter(isContentToken))
}

function overlap(sentenceTokens: ReadonlySet<string>, queryTokens: ReadonlySet<string>): number {
  let hits = 0
  for (const token of sentenceTokens) {
    if (queryTokens.has(token)) hits += 1
  }
  return hits
}

/**
 * 挑出与该问题最相关的一句作为引用原文（找不到就退回片段开头）。
 *
 * 刻意**不加省略号**：引用必须是原文的**逐字子串**，否则消费方就无法用
 * `record.chunkText.includes(quote)` 独立核验 —— 可核验性优先于排版。
 * 超长时截断成前缀，仍然逐字可查。
 */
function bestQuote(text: string, queryTokens: ReadonlySet<string>): string {
  const sentences = splitSentences(text)
  let best = ""
  let bestScore = 0
  for (const sentence of sentences) {
    const score = overlap(contentTokens(sentence), queryTokens)
    if (score > bestScore) {
      bestScore = score
      best = sentence
    }
  }
  if (best === "") best = sentences[0] ?? text
  return best.length > 300 ? best.slice(0, 300) : best
}

function toCitation(hit: SearchHit, queryTokens: ReadonlySet<string>): Citation {
  return {
    citationId: citationIdOf(hit.page, hit.chunk),
    ...(hit.chunk.citeDigest !== undefined ? { citeUrl: citeUrlOf(hit.chunk.citeDigest) } : {}),
    slug: hit.page.slug,
    version: hit.page.version,
    title: hit.page.title,
    url: hit.page.url,
    officialUrl: hit.page.officialUrl,
    ...(hit.page.upstreamCommit !== undefined ? { commit: hit.page.upstreamCommit } : {}),
    status: hit.page.status,
    ...(hit.chunk.anchor !== undefined ? { anchor: hit.chunk.anchor } : {}),
    quote: bestQuote(hit.chunk.text, queryTokens)
  }
}

/**
 * 去重：同一**逻辑小节**只保留排名最高的命中。
 *
 * 关键在"逻辑"：slug 带 `v3/`|`v4/` 前缀，而 v3 与 v4 的文档高度重合，
 * 按带前缀的 slug 去重时两个版本会各占一个引用位 —— 实测 13 条金标问句里 12 条
 * 因此把 3 个引用位浪费成"同一节的两个版本"（「怎么安装 Effect？」甚至给出
 * v4 与 v3 两条内容相同的引用）。所以按**去掉版本前缀**的 slug + 锚点归并，
 * 保留排序最靠前的那个（v4 在打分与排序里都有优先）。
 */
function dedupe(hits: ReadonlyArray<SearchHit>): ReadonlyArray<SearchHit> {
  const seen = new Set<string>()
  const result: Array<SearchHit> = []
  for (const hit of hits) {
    const logicalSlug = hit.chunk.slug.replace(/^v[0-9]+\//, "")
    const section = hit.chunk.anchor ?? hit.chunk.headingPath.join(">")
    const key = `${logicalSlug}::${section}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(hit)
  }
  return result
}

/**
 * 由检索结果构造引用（**唯一的引用来源**）。
 * 导出给 explain.ts 复用：报错解释与问答共享同一套"引用不变量"。
 */
export function buildCitations(
  hits: ReadonlyArray<SearchHit>,
  question: string,
  maxCitations = DEFAULT_MAX_CITATIONS
): ReadonlyArray<Citation> {
  const queryTokens = contentTokens(question)
  return dedupe(hits)
    .slice(0, maxCitations)
    .map((hit) => toCitation(hit, queryTokens))
}

/** 问题是否指向"尚未翻译"的官方页面（中文没有 ≠ 文档没有，这两件事必须分开说） */
export function matchPendingPages(
  question: string,
  pending: ReadonlyArray<CorpusPendingPage>,
  limit = 3
): ReadonlyArray<CorpusPendingPage> {
  const queryTokens = contentTokens(question)
  if (queryTokens.size === 0) return []
  const scored: Array<{ page: CorpusPendingPage; score: number }> = []
  for (const page of pending) {
    const titleTokens = contentTokens(page.title)
    let score = 0
    for (const token of titleTokens) {
      if (queryTokens.has(token)) score += 1
    }
    // 也允许用上游路径（如 v4/error-management/retrying）命中
    const pathTokens = contentTokens(page.slug.replace(/\//g, " "))
    for (const token of pathTokens) {
      if (queryTokens.has(token)) score += 0.5
    }
    if (score > 0) scored.push({ page, score })
  }
  return scored
    .sort((a, b) => (b.score === a.score ? a.page.slug.localeCompare(b.page.slug) : b.score - a.score))
    .slice(0, limit)
    .map((item) => item.page)
}

/** 弱相关页面（拒答时的"下一步"）：去重、取前 3 —— 必须与 citations 明确区分 */
function relatedFrom(hits: ReadonlyArray<SearchHit>): Refusal["relatedPages"] {
  const seen = new Set<string>()
  const related: Array<{ slug: string; title: string; url: string; translated: boolean }> = []
  for (const hit of hits) {
    if (seen.has(hit.page.slug)) continue
    seen.add(hit.page.slug)
    related.push({
      slug: hit.page.slug,
      title: hit.page.title,
      url: `/docs/${hit.page.slug}/`,
      translated: true
    })
    if (related.length >= 3) break
  }
  return related.length > 0 ? related : undefined
}

function refusalFor(
  question: string,
  pendingMatches: ReadonlyArray<CorpusPendingPage>,
  hits: ReadonlyArray<SearchHit> = []
): Refusal {
  const relatedPages = relatedFrom(hits)
  if (pendingMatches.length > 0) {
    return {
      reason: "untranslated",
      message: `站内中文文档里还没有与「${question}」直接对应的译文，但官方有相关页面 —— 可以先读英文原文，或认领翻译：`,
      ...(relatedPages !== undefined ? { relatedPages } : {}),
      suggestions: [...pendingMatches]
        .sort((a, b) =>
          a.version === b.version ? a.slug.localeCompare(b.slug) : a.version === "v4" ? -1 : 1
        )
        .map((page) => ({
        slug: page.slug,
        title: page.title,
        officialUrl: page.officialUrl
      }))
    }
  }
  return {
    reason: "no-match",
    message:
      "站内中文文档里没有找到能支撑这个问题的内容。可以换一种说法（例如直接用 API 名「Effect.gen」提问），" +
      "或用 ⌘K 搜一下；也可以到社区提问：站内 /community 页有微信群入口，或开 GitHub Issue。",
    ...(relatedPages !== undefined ? { relatedPages } : {})
  }
}

export interface ComposeInput {
  readonly question: string
  readonly hits: ReadonlyArray<SearchHit>
  readonly pending: ReadonlyArray<CorpusPendingPage>
  readonly options?: {
    readonly minScore?: number
    readonly maxCitations?: number
    /** 话题路由器：用于识别"这个话题只有未翻译页面拥有" */
    readonly router?: TopicRouter
  }
}

/**
 * 定义型问题（"Fiber 是什么？"）优先定义小节。
 *
 * 为什么需要：BM25 只看词频，`fibers` 页里《Join Fiber》这类小节标题同样含 "fiber"，
 * 于是"Fiber 是什么"会引用到"如何 join"的段落 —— 词面相关但答非所问。
 * 这里做一个**稳定重排**（不改变分数，只调顺序），把"什么是/简介/概述"小节提到前面。
 */
function preferDefinition(question: string, hits: ReadonlyArray<SearchHit>): ReadonlyArray<SearchHit> {
  if (!isDefinitionalQuestion(question)) return hits
  const isDefinition = (hit: SearchHit): boolean =>
    hit.chunk.headingPath.some((part) => isDefinitionHeading(part))
  return [...hits].sort((left, right) => Number(isDefinition(right)) - Number(isDefinition(left)))
}

export function composeAnswer(input: ComposeInput): AskResult {
  const { question, hits, pending } = input
  const minScore = input.options?.minScore ?? DEFAULT_MIN_SCORE
  const maxCitations = input.options?.maxCitations ?? DEFAULT_MAX_CITATIONS
  const queryTokens = contentTokens(question)

  // 话题归属优先：若问题点名的 topic 只有未翻译页面拥有，则诚实地说"中文还没这一页"
  const routed = input.options?.router?.route(question)
  if (routed !== undefined && routed.kind === "pending") {
    return {
      question,
      mode: "extractive",
      answer: "",
      citations: [],
      refused: true,
      refusal: refusalFor(question, routed.pages, hits),
      stalePages: [],
      disclaimer: ANSWER_DISCLAIMER
    }
  }

  const usable = preferDefinition(question, dedupe(hits)).slice(0, maxCitations)
  const top = usable[0]
  const strong = top !== undefined && top.score >= minScore

  if (!strong) {
    const pendingMatches = matchPendingPages(question, pending)
    return {
      question,
      mode: "extractive",
      answer: "",
      citations: [],
      refused: true,
      refusal: refusalFor(question, pendingMatches, hits),
      stalePages: [],
      disclaimer: ANSWER_DISCLAIMER
    }
  }

  const citations = buildCitations(usable, question, maxCitations)
  const lines: Array<string> = []
  lines.push("站内中文译文里，与这个问题最相关的是：")
  citations.forEach((citation, index) => {
    const hit = usable[index]
    const section = hit?.chunk.headingPath.filter((part) => part.length > 0).join(" › ")
    const where = section !== undefined && section !== "" ? `《${citation.title}》› ${section}` : `《${citation.title}》`
    // 刻意不在答案里重复引用原文：quote 只在 citations 里出现一次，
    // 人类看列表、Agent 读 citations —— 避免同一段文字占两份 token。
    const codeHint = hit?.chunk.hasCode === true ? "（含代码示例）" : ""
    lines.push(`${index + 1}. ${where}${codeHint}`)
  })

  const stalePages = [...new Set(usable.map((hit) => hit.page))]
    .filter((page) => page.status === "stale")
    .map((page) => ({ slug: page.slug, status: page.status }))
  if (stalePages.length > 0) {
    lines.push(
      `注意：${stalePages.map((page) => `《${page.slug}》`).join("、")} 的译文落后于上游，结论可能已经过时。`
    )
  }

  return {
    question,
    mode: "extractive",
    answer: lines.join("\n"),
    citations,
    refused: false,
    stalePages,
    disclaimer: ANSWER_DISCLAIMER
  }
}
