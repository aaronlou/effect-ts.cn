/**
 * 浏览器内检索（无后端、无模型、无网络请求）。
 *
 * 为什么需要它 —— 站点的默认部署形态是**静态托管**，API 是可选的：
 * 1. 静态托管时 ⌘K 搜索此前是"整串子串匹配"，中文自然问句（"怎么安装 Effect"）
 *    一条都搜不到，用户会以为站内没有这些内容；
 * 2. AI 问答/报错定位面板在 API 未部署时只会说"服务不可用" —— AI 能力**消失**，
 *    而不是**降级**。
 *
 * 这里把知识层的关键设计（中文双字词、idf 覆盖率门禁、主/次 token）搬进浏览器，
 * 只是数据源换成构建期生成的 `/search-index.json`（页面级，无锚点、无模型）。
 * 服务端（`bm25.ts`）仍然是权威实现：有锚点、有话题归属、有引用不变量。
 */
import { isQuestionLike } from "./intent.js"
import { isContentToken, isQueryNoise, QUERY_STOPWORDS, tokenize } from "./tokenize.js"

export interface ClientSearchEntry {
  readonly type: string
  readonly title: string
  readonly url: string
  readonly section: string
  readonly translated: boolean
  readonly text: string
}

export interface ClientSearchHit {
  readonly entry: ClientSearchEntry
  readonly score: number
}

export { isQuestionLike }

export interface ClientSearchOptions {
  /**
   * 严格模式（默认按提问自动判定）：**自然语言问句**必须含"标题级话题词"或 API 名才给结果。
   *
   * 为什么：234 页规模下，无关问句（「今天北京的天气怎么样？」「推荐一部科幻电影」）
   * 会靠两个通用双字词（天气/的天、推荐/一部）同时出现在某页正文里而"蹭"进前三 ——
   * 一个承诺"没有依据就说不知道"的知识层不该这样。标题里出现过的词（安装 / Layer / 错误…）
   * 或 API 名（runSync / Schema）才算有话题指向；关键词检索（非问句）不受此限。
   */
  readonly strict?: boolean
}

export interface ClientSearchIndex {
  readonly size: number
  readonly search: (
    query: string,
    limit?: number,
    options?: ClientSearchOptions
  ) => ReadonlyArray<ClientSearchHit>
}



const FIELD_TITLE = 4
const FIELD_SECTION = 2
const FIELD_TEXT = 1
const K1 = 1.2
const B = 0.75
const MIN_COVERAGE = 0.25
/**
 * 未翻译页面在静态索引里只有英文标题（正文为空）。若不降权，
 * 「Layer 怎么做依赖注入？」会被 "Managing Layers" / "Layer Memoization" 这些英文页挤满，
 * 反而把**已经翻译好**的《管理 Layer》挤出候选 —— 降级路径最不该犯的错。
 */
const UNTRANSLATED_PENALTY = 0.6

interface ClientDoc {
  readonly entry: ClientSearchEntry
  readonly tf: ReadonlyMap<string, number>
  readonly length: number
  readonly titleLower: string
}

function addTokens(target: Map<string, number>, tokens: ReadonlyArray<string>, weight: number): void {
  for (const token of tokens) target.set(token, (target.get(token) ?? 0) + weight)
}

export function buildClientSearchIndex(entries: ReadonlyArray<ClientSearchEntry>): ClientSearchIndex {
  const docs: Array<ClientDoc> = []
  const df = new Map<string, number>()
  let totalLength = 0

  for (const entry of entries) {
    const tf = new Map<string, number>()
    addTokens(tf, tokenize(entry.title), FIELD_TITLE)
    addTokens(tf, tokenize(entry.section), FIELD_SECTION)
    addTokens(tf, tokenize(entry.text), FIELD_TEXT)
    let length = 0
    for (const value of tf.values()) length += value
    totalLength += length
    for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1)
    docs.push({ entry, tf, length, titleLower: entry.title.toLowerCase() })
  }

  const total = docs.length
  const avgdl = total > 0 ? totalLength / total : 1
  /**
   * 标题词表：所有页面标题里出现过的内容词（中文双字词 / 拉丁标识符）。
   * 严格模式用它判断"问题里有没有话题指向"——标题级词汇 + API 名才算话题。
   */
  const titleVocabulary = new Set<string>()
  for (const doc of docs) {
    for (const token of tokenize(doc.entry.title)) {
      if (isContentToken(token)) titleVocabulary.add(token)
    }
  }
  const idf = (token: string): number => {
    const docFreq = df.get(token) ?? 0
    return Math.log(1 + (total - docFreq + 0.5) / (docFreq + 0.5))
  }

  return {
    size: total,
    search: (query, limit = 8, options) => {
      const raw = [...new Set(tokenize(query))]
      const meaningful = raw.filter(
        (token) => !QUERY_STOPWORDS.has(token) && !isQueryNoise(token)
      )
      const primary = meaningful.filter(isContentToken)
      const secondary = meaningful.filter((token) => !isContentToken(token))
      const tokens = primary.length > 0 ? primary : secondary.length > 0 ? secondary : raw
      if (tokens.length === 0) return []

      // 严格模式（默认对问句开启）：问句里必须有标题级话题词或 API 名，否则直接判定"没有依据"
      const strict =
        options?.strict ?? (isQuestionLike(query) || raw.filter(isContentToken).length >= 4)
      if (strict) {
        // 用过滤前的 token：effect 这类词在打分时被当停用词，但它仍是 API 名（话题指向）
        const hasTopic =
          raw.some((token) => titleVocabulary.has(token)) ||
          raw.some((token) => /[a-z]/.test(token) && token.length >= 3)
        if (!hasTopic) return []
      }

      const inVocab = tokens.filter((token) => (df.get(token) ?? 0) > 0)
      const queryIdf = inVocab.reduce((sum, token) => sum + idf(token), 0)
      const boostable = tokens.filter(
        (token) => token.length >= 2 && (df.get(token) ?? 0) <= Math.max(2, Math.floor(total * 0.4))
      )
      const normalized = query.toLowerCase().replace(/\s+/g, "")

      const scored: Array<ClientSearchHit> = []
      for (const doc of docs) {
        let score = 0
        let matchedPrimary = 0
        let matchedInTitle = 0
        const inTitle = (token: string): boolean => doc.titleLower.includes(token)
        for (const token of tokens) {
          const frequency = doc.tf.get(token)
          if (frequency === undefined) continue
          if (isContentToken(token)) matchedPrimary += 1
          if (inTitle(token)) matchedInTitle += 1
          const denominator = frequency + K1 * (1 - B + (B * doc.length) / avgdl)
          score += idf(token) * ((frequency * (K1 + 1)) / denominator)
        }
        if (score === 0 || matchedPrimary === 0) continue
        // 与服务端同一条规则：只蹭到一个正文里的词 ⇒ 不当作依据
        if (matchedPrimary < 2 && matchedInTitle === 0) continue

        // 整标题是查询的子串 ⇒ 强话题信号（"怎么运行一个 Effect？" 含 "运行 Effect"）
        const titleNoSpace = doc.entry.title.toLowerCase().replace(/\s+/g, "")
        const queryNoSpace = query.toLowerCase().replace(/\s+/g, "")
        if (titleNoSpace.length >= 4 && queryNoSpace.includes(titleNoSpace)) score += 12
        // 标题词覆盖（与 bm25 同一口径）：查询覆盖标题里的内容词越多，越可能是"这一页"
        const titleTokens = [...new Set(tokenize(doc.entry.title))].filter(isContentToken)
        if (titleTokens.length > 0) {
          const covered = titleTokens.filter((token) => raw.includes(token)).length
          if (covered > 0) score += Math.min(covered * 4, 12)
        }
        // 查询词命中标题 / 整串命中标题 ⇒ 页面级强信号（静态索引没有小节结构，只能到页面粒度）。
        // 权重刻意比服务端高：静态索引没有小节名可依据，"标题里有这个词"几乎是唯一的话题信号
        // —— 否则「怎么安装 Effect？」会把《导入 Effect》排在《安装》前面。
        for (const token of boostable) {
          // 标题**就是**这个词（《安装》《Fiber》）比"标题里含这个词"强得多 ——
          // 这正是"这一页拥有这个话题"的朴素版本。
          if (doc.titleLower.trim() === token) score += 10
          else if (doc.titleLower.includes(token)) score += 5
        }
        if (normalized.length >= 2 && normalized.length <= 16 && doc.titleLower.replace(/\s+/g, "").includes(normalized)) {
          score += 8
        }

        if (inVocab.length > 0 && queryIdf > 0) {
          const matchedIdf = inVocab.reduce(
            (sum, token) => (doc.tf.has(token) ? sum + idf(token) : sum),
            0
          )
          if (matchedIdf / queryIdf < MIN_COVERAGE) continue
        }

        // v4 优先：v3/v4 内容高度重合，站点文档以 v4 为当前版本；
        // 不加这一条时，同一句话会命中 v3 页（分数几乎相同，只靠索引顺序决定胜负）。
        const versionBoost = doc.entry.url.startsWith("/docs/v4/") ? 1.15 : 1
        const adjusted = score * versionBoost
        scored.push({ entry: doc.entry, score: doc.entry.translated ? adjusted : adjusted * UNTRANSLATED_PENALTY })
      }

      scored.sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        // 同分：v4 在前（并列时不靠索引顺序碰运气）
        const v4 = (url: string) => (url.startsWith("/docs/v4/") ? 0 : 1)
        return v4(left.entry.url) - v4(right.entry.url)
      })
      return scored.slice(0, limit)
    }
  }
}

/** 摘录：以第一个命中的查询词为中心截一段，给人类看"为什么它相关" */
export function excerptAround(text: string, query: string, maxLength = 160): string {
  const haystack = text.toLowerCase()
  const tokens = [...new Set(tokenize(query))]
    .filter(isContentToken)
    .sort((left, right) => right.length - left.length)
  let index = -1
  for (const token of tokens) {
    const found = haystack.indexOf(token)
    if (found >= 0 && (index < 0 || found < index)) index = found
  }
  if (index < 0) return text.slice(0, maxLength).trim()
  // 命中词放在窗口前 1/3 处：留一点前文做语境，又保证命中词一定在窗口内
  const start = Math.max(0, index - Math.floor(maxLength / 3))
  const slice = text.slice(start, start + maxLength).trim()
  return `${start > 0 ? "…" : ""}${slice}${start + maxLength < text.length ? "…" : ""}`
}

/**
 * 从报错文本里提取检索用词（浏览器内版本）。
 * 与 `explain.ts` 的 extractIdentifiers 保持同样的目标：优先 API 名/包名/错误码，
 * 退化成原文前 160 字。刻意不引 `explain.ts`：客户端只要这几个正则。
 */
export function extractErrorQuery(errorText: string): string {
  const tokens = new Set<string>()
  for (const match of errorText.matchAll(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g)) tokens.add(match[0])
  for (const match of errorText.matchAll(/\b[A-Z]{2,}\d{3,}\b/g)) tokens.add(match[0])
  for (const match of errorText.matchAll(/\b[A-Z][A-Za-z]{3,}(?:Error|Exception)\b/g)) tokens.add(match[0])
  if (tokens.size === 0) return errorText.slice(0, 160)
  return [...tokens].join(" ")
}
