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

/** 挑出与该问题最相关的一句作为引用原文（找不到就退回片段开头） */
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
  if (best === "") {
    const fallback = sentences[0] ?? text
    best = fallback.length > 200 ? `${fallback.slice(0, 200)}…` : fallback
  }
  return best.length > 300 ? `${best.slice(0, 300)}…` : best
}

function toCitation(hit: SearchHit, queryTokens: ReadonlySet<string>): Citation {
  return {
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

/** 去重：同一页同一小节只保留最高分的命中 */
function dedupe(hits: ReadonlyArray<SearchHit>): ReadonlyArray<SearchHit> {
  const seen = new Set<string>()
  const result: Array<SearchHit> = []
  for (const hit of hits) {
    const key = `${hit.chunk.slug}::${hit.chunk.headingPath.join(">")}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(hit)
  }
  return result
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

function refusalFor(question: string, pendingMatches: ReadonlyArray<CorpusPendingPage>): Refusal {
  if (pendingMatches.length > 0) {
    return {
      reason: "untranslated",
      message: `站内中文文档里还没有与「${question}」直接对应的译文，但官方有相关页面 —— 可以先读英文原文，或认领翻译：`,
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
      "或用 ⌘K 搜一下；也可以到社区的 GitHub Issue / Discord 提问。"
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
      refusal: refusalFor(question, routed.pages),
      stalePages: [],
      disclaimer: ANSWER_DISCLAIMER
    }
  }

  const usable = dedupe(hits).slice(0, maxCitations)
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
      refusal: refusalFor(question, pendingMatches),
      stalePages: [],
      disclaimer: ANSWER_DISCLAIMER
    }
  }

  const citations = usable.map((hit) => toCitation(hit, queryTokens))
  const lines: Array<string> = []
  lines.push(`站内中文译文里，与这个问题最相关的是：`)
  citations.forEach((citation, index) => {
    const section = usable[index]?.chunk.headingPath.filter((part) => part.length > 0).join(" › ")
    const where = section !== undefined && section !== "" ? `《${citation.title}》› ${section}` : `《${citation.title}》`
    lines.push(`${index + 1}. ${where}：${citation.quote}`)
  })
  if (usable.some((hit) => hit.chunk.hasCode)) {
    lines.push("其中至少一个小节带有可运行的代码示例 —— 点引用可直达该小节。")
  }

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
