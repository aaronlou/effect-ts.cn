/**
 * 查询集（**口径的一部分**，因此写在代码里、进快照、可复现）。
 *
 * 三条原则：
 * 1. **方向词覆盖多种说法** —— 生态榜采集器的实测教训：单通道会漏项目
 *    （`harness` / `runtime` / `copilot` 这类说法各自能捞到不同的仓库）。
 * 2. **跨语言同构** —— 同一组关键词跑遍所有语言，语言分布才可比。
 * 3. **查询本身要留痕** —— 每条候选都记 `via`，报告里的数字能一路回溯到具体 query。
 */

/**
 * Agent 方向词。
 *
 * 前六个来自计划 §12.1（原文的 agent 查询），后面是生态榜采集器验证过的补充通道。
 * `mcp` 单列是因为实测它命中最多（TS 491 / Python 488），是这一代 Agent 项目的强信号。
 */
export const AGENT_KEYWORDS = [
  "agent",
  "llm",
  "mcp",
  "rag",
  "copilot",
  "chatbot",
  "harness",
  "workflow",
  "tool calling",
  "function calling",
  "multi-agent",
  "coding assistant"
] as const

/**
 * 计划 §12.1 的短语查询（带引号 ⇒ 精确短语）。
 *
 * 与上面的单词查询**不是二选一**：短语查得准但召回窄，单词查得宽但噪声多，
 * 两条通道并起来再做分类，比只跑一条更接近"完整"。
 */
export const PHRASE_QUERIES = ['"AI agent"', '"agent framework"', '"agent runtime"', '"LLM agent"'] as const

/** 第一版覆盖的语言（与计划 §12.1 一致） */
export const LANGUAGES = ["TypeScript", "Python", "Rust", "Go", "Java"] as const
export type Language = (typeof LANGUAGES)[number]

export interface QuerySpec {
  readonly language: Language
  readonly keyword: string
  /** 精确短语查询要加引号；单词查询不加 */
  readonly phrase: boolean
}

/** 全部查询：语言 × (方向词 ∪ 短语) */
export function buildQueries(
  languages: ReadonlyArray<Language> = LANGUAGES,
  keywords: ReadonlyArray<string> = AGENT_KEYWORDS,
  phrases: ReadonlyArray<string> = PHRASE_QUERIES
): ReadonlyArray<QuerySpec> {
  const specs: Array<QuerySpec> = []
  for (const language of languages) {
    for (const keyword of keywords) specs.push({ language, keyword, phrase: false })
    for (const phrase of phrases) specs.push({ language, keyword: phrase, phrase: true })
  }
  return specs
}

export interface QueryOptions {
  readonly minStars: number
  /** ISO 日期（含）：只要这段时间内有 push 的仓库 */
  readonly pushedSince: string
}

/**
 * 组装搜索表达式。
 *
 * `in:name,description,topics` 是刻意的：不搜 README ——
 * README 里的关键词会大量误召（"我们用过 LangChain"也能命中），
 * 而 name/description/topics 是维护者主动声明的定位，噪声低得多。
 */
export function buildSearchQuery(spec: QuerySpec, options: QueryOptions, starBand?: string): string {
  const parts = [
    spec.keyword,
    `language:${spec.language.toLowerCase()}`,
    `stars:>=${options.minStars}`,
    `pushed:>=${options.pushedSince}`,
    "in:name,description,topics"
  ]
  if (starBand !== undefined) parts.push(starBand)
  return parts.join(" ")
}
