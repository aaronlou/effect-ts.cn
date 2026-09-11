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
