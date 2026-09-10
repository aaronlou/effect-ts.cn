/**
 * 报错解释（S2 v0）：把 TypeScript / Effect 的报错**定位到相关文档小节**。
 *
 * 设计取向（诚实优先）：
 * - 未配置模型时只做**定位**：提取报错里的 API/类型/错误码 → 检索 → 给出相关小节；
 *   不臆测原因（"只做定位，不做诊断"会写在答案里）；
 * - 配置模型后，同一份引用交给模型写一句诊断（prompt 不同、证据相同，引用仍由检索构造）；
 * - 找不到相关文档时拒答，并建议把报错贴到社区。
 */
import type { SearchHit } from "./bm25.js"
import { buildCitations, matchPendingPages } from "./answer.js"
import type { Citation, CorpusPendingPage, Refusal } from "./types.js"
import type { TopicRouter } from "./topics.js"

const DEFAULT_MIN_SCORE = 3
const MAX_IDENTIFIERS = 8

/**
 * 从报错文本中提取"可检索的锚点"：
 * - `Effect.flatMap` / `Effect.Effect` 这类 API
 * - `@effect/schema` 这类包名
 * - TS2345 这类错误码
 * - `TypeError` / `ParseError` 这类类型名
 */
export function extractIdentifiers(errorText: string): ReadonlyArray<string> {
  const patterns = [
    // Effect 生态里常见的"模块限定 API"（Layer.Layer / Schema.Struct / Stream.map …）
    /\b(?:Effect|Layer|Schema|Stream|Sink|Fiber|Context|Ref|Queue|PubSub|Schedule|Duration|Option|Result|Cause|Exit|Scope|Config)\.[A-Za-z0-9_$.]+/g,
    /@effect\/[a-z0-9-]+/g,
    /\bTS\d{4,5}\b/g,
    /\b[A-Z][A-Za-z0-9]*(?:Error|Exception)\b/g
  ]
  const found = new Set<string>()
  for (const pattern of patterns) {
    for (const match of errorText.matchAll(pattern)) {
      found.add(match[0])
      if (found.size >= MAX_IDENTIFIERS * 2) break
    }
  }
  return [...found].slice(0, MAX_IDENTIFIERS)
}

export interface ExplainInput {
  readonly errorText: string
  readonly okHits: ReadonlyArray<SearchHit>
  readonly pending: ReadonlyArray<CorpusPendingPage>
  /** 话题路由：识别"这个 API/话题只有未翻译页面拥有" */
  readonly router?: TopicRouter
  readonly options?: { readonly minScore?: number; readonly maxCitations?: number }
}

export interface ExplainResult {
  readonly identifiers: ReadonlyArray<string>
  readonly answer: string
  readonly citations: ReadonlyArray<Citation>
  readonly refused: boolean
  readonly refusal?: Refusal
  readonly disclaimer: string
}

export const EXPLAIN_DISCLAIMER =
  "本站当前为检索模式：下面给出的是与报错相关的文档小节，不是自动诊断结论 —— 请对照引用判断。"

export function composeExplanation(input: ExplainInput): ExplainResult {
  const minScore = input.options?.minScore ?? DEFAULT_MIN_SCORE
  const maxCitations = input.options?.maxCitations ?? 3
  const identifiers = extractIdentifiers(input.errorText)
  const query = identifiers.length > 0 ? identifiers.join(" ") : input.errorText.slice(0, 200)

  // 话题归属优先：报错点名的 API/话题若只有未翻译页面拥有，直接诚实拒答
  const routed = input.router?.route(query)
  if (routed !== undefined && routed.kind === "pending") {
    return {
      identifiers,
      answer: "",
      citations: [],
      refused: true,
      refusal: {
        reason: "untranslated",
        message: "报错涉及的 API 在官方文档里有对应页面，但中文尚未翻译 —— 建议直接读英文原文：",
        suggestions: [...routed.pages]
          .sort((a, b) =>
            a.version === b.version ? a.slug.localeCompare(b.slug) : a.version === "v4" ? -1 : 1
          )
          .map((page) => ({ slug: page.slug, title: page.title, officialUrl: page.officialUrl }))
      },
      disclaimer: EXPLAIN_DISCLAIMER
    }
  }

  // 没能提取出任何锚点、且文本也不是中文 → 不硬答（英文散文检索出来的东西不可信）
  if (identifiers.length === 0 && !/[\u4e00-\u9fff]/.test(input.errorText)) {
    return {
      identifiers,
      answer: "",
      citations: [],
      refused: true,
      refusal: {
        reason: "no-match",
        message:
          "没能从这段文本里识别出 Effect 相关的 API / 类型 / 错误码。请把**完整报错**（含类型名与 TS 错误码）贴进来，" +
          "或直接用 ⌘I 向文档提问；也可以把报错贴到 GitHub Issue / Discord，让社区帮忙看。"
      },
      disclaimer: EXPLAIN_DISCLAIMER
    }
  }

  const usable = input.okHits.filter((hit) => hit.score >= minScore)
  if (usable.length === 0) {
    const pendingMatches = matchPendingPages(query, input.pending)
    const refusal: Refusal =
      pendingMatches.length > 0
        ? {
            reason: "untranslated",
            message: "报错涉及的 API 在官方文档里有对应页面，但中文尚未翻译 —— 建议直接读英文原文：",
            suggestions: [...pendingMatches]
              .sort((a, b) =>
                a.version === b.version ? a.slug.localeCompare(b.slug) : a.version === "v4" ? -1 : 1
              )
              .map((page) => ({ slug: page.slug, title: page.title, officialUrl: page.officialUrl }))
          }
        : {
            reason: "no-match",
            message:
              "没能在站内中文文档里定位到与这段报错相关的小节。建议：① 把报错和最小复现代码贴到 GitHub Issue 或 Discord；" +
              "② 若报错里出现了具体 API，可试试用 ⌘I 直接向文档提问。"
          }
    return {
      identifiers,
      answer: "",
      citations: [],
      refused: true,
      refusal,
      disclaimer: EXPLAIN_DISCLAIMER
    }
  }

  const citations = buildCitations(usable, query, maxCitations)
  const lines: Array<string> = []
  lines.push(
    identifiers.length > 0
      ? `报错里出现的关键 API / 类型：${identifiers.map((id) => `\`${id}\``).join("、")}`
      : "未能从报错里提取出明确的 API 名，下面按整段文本检索。"
  )
  lines.push("与这段报错最相关的站内小节：")
  citations.forEach((citation, index) => {
    const hit = usable[index]
    const section = hit?.chunk.headingPath.filter((part) => part.length > 0).join(" › ")
    lines.push(
      `${index + 1}. 《${citation.title}》${section !== undefined && section !== "" ? ` › ${section}` : ""}：${citation.quote}`
    )
  })
  if (usable.some((hit) => hit.chunk.hasCode)) {
    lines.push("其中包含可运行的代码示例 —— 点引用可直达该小节对照修改。")
  }

  return {
    identifiers,
    answer: lines.join("\n"),
    citations,
    refused: false,
    disclaimer: EXPLAIN_DISCLAIMER
  }
}
