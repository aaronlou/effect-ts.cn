/**
 * 提问意图识别（极小、确定性、可测试）。
 *
 * 目前只有一类：**定义型问题**（"Fiber 是什么？""怎么理解 Layer？"）。
 * 为什么需要它：中文社区里最常见的提问形态就是"X 是什么"，
 * 而 BM25 只看词频 —— `fibers` 页里《Join Fiber》这类小节标题同样含 "fiber"，
 * 于是"Fiber 是什么"会引用到"如何 join"的段落：**词面相关，答非所问**。
 * 识别出定义意图后，检索会优先"什么是/简介/概述"小节，答案侧再做一次稳定重排兜底。
 */
const DEFINITIONAL_QUESTION = /什么是|是什么|是什么东西|介绍一下|介绍下|简述|概述|简介|怎么理解|如何理解/
const DEFINITION_HEADING = /什么|简介|概述|介绍|概览|引言|概念|定位|intro|overview/i

/**
 * 问句识别：含疑问词或以问号结尾，就算"自然语言提问"。
 * 它决定是否启用「必须含标题级话题词或 API 名」的严格门禁（见 bm25.ts / client-search.ts）。
 */
const QUESTION_PATTERN = /怎么|怎样|如何|什么|为何|为什么|哪些|哪个|哪种|是否|多少|几类|几种|哪两|[?？]\s*$/

export function isQuestionLike(query: string): boolean {
  return QUESTION_PATTERN.test(query.trim())
}

export function isDefinitionalQuestion(question: string): boolean {
  return DEFINITIONAL_QUESTION.test(question)
}

/** 该小节名是否是"定义型小节"（"什么是 Fiber" / "Overview"） */
export function isDefinitionHeading(heading: string): boolean {
  return DEFINITION_HEADING.test(heading)
}

/**
 * 定义型提问里的"疑问外壳" —— 剥掉它们，剩下的才是**被问的那个概念**。
 *
 * 为什么需要：`effect` 是查询停用词（见 tokenize.ts 里那段解释：站点叫 effect-ts.cn，
 * 它几乎出现在每个页面，留着会让话题归属判错）。于是「Effect 是什么」在查询侧
 * 被剥得一个内容词都不剩 —— 检索返回 **0 命中**，而这是新读者最可能问的第一句话。
 *
 * 修法不是放宽打分（那会把无关问句也放进来），而是换一条判据：**按页面标题匹配**。
 * 要从查询里拿到"被问的概念"，就得把疑问外壳显式剥掉 —— 而不是依赖分词。
 */
const DEFINITIONAL_SHELL = [
  /是什么意思/g, /是做什么的/g, /是做什么/g, /是干嘛的/g, /是干什么的/g, /是啥意思/g,
  /有什么作用/g, /有什么用/g, /有啥用/g, /是啥/g, /什么是/g, /是什么/g,
  /介绍一下/g, /介绍下/g, /解释一下/g, /怎么理解/g, /如何理解/g, /简述/g,
  /^(what\s+is|what's|whats|who\s+is)\s+/i, /\s+(is|are)\s+what$/i,
  /[?？!！。，,、：:\s]+/g
]

import { isContentToken, QUERY_STOPWORDS, tokenize } from "./tokenize.js"

/** 标题里带这些字样 ⇒ 这一页就是"介绍某概念"的那一页。 */
const DEFINITIONAL_TITLE = /什么是|简介|入门|概述|概览|介绍|引子|引言|为什么选择|why|intro|overview|getting\s*started/i

export function isDefinitionalTitle(title: string): boolean {
  return DEFINITIONAL_TITLE.test(title)
}

/** 标题里还要剥掉的东西：标点与空白 */
const TITLE_NOISE = /[?？!！。，,、：:;；"'“”‘’()（）\[\]【】\s]+/g

/**
 * 标题的"中心词"是不是正好就是被问的概念。
 *
 * 这是把《为什么选择 Effect？》和《Effect Schema 简介》区分开的关键 —— 两者标题都含 "effect"，
 * 但对「Effect 是什么」只有前者是在讲 Effect 本身：中文标题的中心词在**末尾**，
 * 剥掉定义性字样（简介/入门/为什么选择…）后，《Effect Schema 简介》剩下的是 schema，
 * 说明这一页讲的是 "Effect Schema" 而不是 "Effect"。
 */
function definitionalHeadMatches(title: string, subject: string): boolean {
  const stripped = title.toLowerCase().replace(new RegExp(DEFINITIONAL_TITLE.source, "gi"), " ").replace(TITLE_NOISE, " ")
  // 注意**不能**再按 QUERY_STOPWORDS 过滤：这条通道的前提就是"被问的概念本身是查询停用词"
  // （effect 就是），滤掉的话 tokens 会变空、函数恒返回 false —— 这正是它第一版失效的原因。
  // 功能词已由上面的"剥定义性字样 + 标点"处理掉了。
  const tokens = tokenize(stripped).filter(isContentToken)
  if (tokens.length === 0) return false
  const subjectTokens = tokenize(subject).filter(isContentToken)
  const subjectHead = subjectTokens.at(-1) ?? subject
  return tokens.at(-1) === subjectHead
}

/**
 * 从定义型提问里取出"被问的概念"。取不到（或太短/太长）返回 undefined。
 *
 * 「Effect 是什么」→ `effect`；「什么是 Fiber」→ `fiber`；
 * 「今天北京的天气怎么样」→ undefined（没有疑问外壳，也不会去匹配标题）。
 */
export function definitionalSubject(query: string): string | undefined {
  if (!isDefinitionalQuestion(query)) return undefined
  let subject = query
  for (const pattern of DEFINITIONAL_SHELL) subject = subject.replace(pattern, " ")
  subject = subject.trim().toLowerCase()
  // 太短无从匹配；太长说明这不是"X 是什么"而是别的问句，别硬套
  if (subject.length < 2 || subject.length > 40) return undefined
  return subject
}

export interface TitleMatchable {
  readonly title: string
  /** 服务端语料有；静态索引没有，缺省时从 slug/url 推 */
  readonly version?: string
  readonly slug?: string
  /** 静态索引条目用 url 而不是 slug */
  readonly url?: string
}

/**
 * 判定一条记录属于哪个版本。
 *
 * 必须能从 slug 或 url 推出来：静态索引条目**没有 version 字段**，
 * 而 v3/v4 的同一页标题完全一样（两页都叫《为什么选择 Effect？》）。
 * 推不出来的话两者得分相等，排序就退化成"保持输入顺序"——
 * 而索引顺序在 macOS 与 Linux 上并不一致，CI 上于是红、本地却是绿的。
 */
function versionOf(page: TitleMatchable): string | undefined {
  if (page.version !== undefined) return page.version
  const haystack = `${page.slug ?? ""} ${page.url ?? ""}`
  if (/\bv4\b|\/v4\//.test(haystack)) return "v4"
  if (/\bv3\b|\/v3\//.test(haystack)) return "v3"
  return undefined
}

/**
 * 按标题给候选页面排序（定义型提问的兜底通道用）。
 *
 * 排序依据，从强到弱：
 *   1. **标题恰好等于概念**（《Fiber》之于"fiber"）—— 没有比这更精确的意图匹配；
 *   2. 标题含定义性字样（《Stream 简介》《Schema 入门》《为什么选择 Effect？》）；
 *   3. 标题更短（更泛化，越可能是总览页而非某个侧面）；
 *   4. v4 优先（站点以 v4 为主线，与检索里的 v4 偏好一致）。
 */
export function rankDefinitionalTitles<T extends TitleMatchable>(pages: readonly T[], subject: string): T[] {
  const normalizedSubject = subject.replace(/\s+/g, "")
  /**
   * 排序权重的量级是刻意的：**先看判据的类型，再看版本**。
   * 早期版本把"版本优先"和"标题更短"放在同一量级，结果《Effect Schema 简介》(更短)
   * 压过了《为什么选择 Effect？》—— 而后者才是"Effect 是什么"的答案。
   */
  const score = (page: T): number => {
    const title = page.title.toLowerCase()
    const normalizedTitle = title.replace(/\s+/g, "")
    let value = 0
    if (normalizedTitle === normalizedSubject) value += 1000 // 标题就是概念本身（《Fiber》）
    else if (definitionalHeadMatches(page.title, subject)) value += 500 // 概念是标题的中心词
    if (isDefinitionalTitle(page.title)) value += 100 // 标题含"简介/入门/为什么选择"
    if (versionOf(page) === "v4") value += 20 // 站点以 v4 为主线
    value -= title.length * 0.1 // 同档内更短更泛化
    return value
  }
  return pages
    .filter((page) => page.title.toLowerCase().replace(/\s+/g, "").includes(normalizedSubject))
    .sort(
      (a, b) =>
        score(b) - score(a) ||
        // 同分时 v4 优先，再按 slug/url 排序 —— 必须给出**全序**，
        // 否则结果会随输入顺序变化（见 versionOf 的注释）
        Number(versionOf(b) === "v4") - Number(versionOf(a) === "v4") ||
        (a.slug ?? a.url ?? a.title).localeCompare(b.slug ?? b.url ?? b.title)
    )
}
