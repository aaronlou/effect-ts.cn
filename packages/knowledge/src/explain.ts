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
import { withPathsStripped } from "./error-signature.js"
import { buildCitations, matchPendingPages } from "./answer.js"
import type { Citation, CorpusPendingPage, Refusal } from "./types.js"
import type { TopicRouter } from "./topics.js"

const DEFAULT_MIN_SCORE = 3
const MAX_IDENTIFIERS = 8

/**
 * 文件扩展名 —— 这类匹配**不是 API 名**。
 *
 * 实测事故：用户从终端复制的报错几乎都带堆栈，而堆栈里会有
 * `at /Users/x/node_modules/effect/src/Effect.ts:5:1` 这样的路径。
 * 上面的"模块限定 API"正则（`Effect\.[A-Za-z0-9_$.]+`）会把 `Effect.ts` 一并提取出来，
 * 于是检索查询里混进一个不存在的话题，话题路由器据此判成"这一页只有未翻译版本"，
 * 最终**对一个完全正常的报错拒答**：
 *
 *   裸消息                → 3 条引用 ✔
 *   加"文件:行:列"前缀      → 3 条引用 ✔
 *   加堆栈帧              → **拒答，0 引用** ✘
 *   前缀 + 堆栈（真实粘贴）  → **拒答，0 引用** ✘
 *
 * 也就是说：`/debug` 最主要的使用场景此前是坏的。文件名不可能是 API 名，
 * 所以这里直接按扩展名排除，作为与堆栈无关的兜底。
 */
/**
 * 只列**堆栈帧里会出现的代码文件**扩展名。
 *
 * 刻意**不含 `map`**：`.map` 是 source map 的扩展名，但 `Effect.map` / `Schema.map` 是极常用的
 * API —— 一起滤掉等于悄悄削弱诊断质量。这个错误是本文件的测试自己抓出来的：
 * 断言 `Effect.map` 必须被提取，结果得到了空数组。宁可漏掉一个罕见的 `.map` 文件，
 * 也不能误伤一个天天在用的 API。（`json` 可以留：没有常用 Effect API 以 `.json` 结尾。）
 */
const FILE_EXTENSION = /\.(?:d\.ts|tsx?|mts?|cts?|jsx?|mjs|cjs|json)$/i

/**
 * 从报错文本中提取"可检索的锚点"：
 * - `Effect.flatMap` / `Effect.Effect` 这类 API
 * - `@effect/schema` 这类包名
 * - TS2345 这类错误码
 * - `TypeError` / `ParseError` 这类类型名
 */
export function extractIdentifiers(rawErrorText: string): ReadonlyArray<string> {
  // 先抹掉路径与行列号再提取：绝对路径里的 `.../effect/src/Effect.ts` 会污染标识符，
  // 而它们是"同一报错在不同机器上必然不同"的部分。
  // 用**更轻**的那版归一化：`at Layer.succeed (...)` 里的函数名要留着 —— 它是有用的锚点。
  const errorText = withPathsStripped(rawErrorText)
  const patterns = [
    // 顺序即优先级：越靠前越精确，超过 MAX_IDENTIFIERS 时优先保留
    //
    // ① Effect 生态里常见的"模块限定 API"（Layer.succeed / Schema.Struct / Stream.map …）
    /\b(?:Effect|Layer|Schema|Stream|Sink|Fiber|Context|Ref|Queue|PubSub|Schedule|Duration|Option|Result|Cause|Exit|Scope|Config)\.[A-Za-z0-9_$.]+/g,
    /@effect\/[a-z0-9-]+/g,
    /\bTS\d{4,5}\b/g,
    /\b[A-Z][A-Za-z0-9]*(?:Error|Exception)\b/g,
    /**
     * ② **类型位置的裸名字**：`Effect<number, never, never>` / `Stream<...>` / `Layer<...>`。
     *
     * 为什么必须有这一条：Effect 最出名的就是**类型报错**，而这类报错的正文里
     * 常常**一个带点的 API 都没有** —— 只有类型名。此前它们只能提出错误码
     * （identifiers 恒等于 `["TS2365"]`），检索不到任何东西，于是**一整类报错全被拒答**。
     *
     * 实测（5 个真实 tsc 报错，全是 Effect 的典型错误）：
     *   TS2362 / TS2365 / TS2345 / TS2322 / TS2488 —— 修复前 5 条全部拒答。
     */
    /\b(?:Effect|Layer|Stream|Sink|Channel|Fiber|Scope|Cause|Exit|Option|Either|Chunk|Ref|Queue|PubSub|Deferred|Semaphore|Schedule|Duration|Config|Schema|Context|Runtime|Metric|Logger)\b/g
  ]
  const found = new Set<string>()
  for (const pattern of patterns) {
    for (const match of errorText.matchAll(pattern)) {
      if (FILE_EXTENSION.test(match[0])) continue
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
          "或直接用 ⌘I 向文档提问；也可以把报错发到社区（站内 /community 页的微信群，或 GitHub Issue），让社区帮忙看。"
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
              "没能在站内中文文档里定位到与这段报错相关的小节。建议：① 把报错和最小复现代码发到社区（站内 /community 页的微信群，或 GitHub Issue）；" +
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
    // 引用必须可引用、可核验：ID 供你写进结论，地址供你独立比对
    lines.push(
      `   引用 ID：${citation.citationId}${citation.citeUrl !== undefined ? ` · 核验地址：${citation.citeUrl}` : ""}`
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
