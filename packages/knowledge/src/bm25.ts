/**
 * 检索：BM25F-lite（字段加权）+ 标识符/短语加成。
 *
 * 为什么不是向量检索（至少现在）：
 * - 语料是**领域专有名词密集**的技术文档（Effect.gen / Layer / flatMap），
 *   词法检索在这种场景的精确率往往优于小语料上的向量检索；
 * - 完全确定性 → 可以在 CI 里做 recall 评测门禁（见 packages/knowledge/test）；
 * - 零外部依赖、零 API 成本、零冷启动延迟。
 * 向量检索作为后续 Layer 替换点保留（corpus 已带 heading 结构，切分逻辑可复用）。
 */
import { isContentToken, tokenize } from "./tokenize.js"
import type { CorpusChunk, CorpusPage } from "./types.js"

export interface SearchHit {
  readonly chunk: CorpusChunk
  readonly page: CorpusPage
  readonly score: number
}

interface DocEntry {
  readonly chunk: CorpusChunk
  readonly page: CorpusPage
  readonly tf: ReadonlyMap<string, number>
  readonly length: number
}

export interface SearchOptions {
  readonly limit?: number
  /** 限定到某一页（"问这一页"场景） */
  readonly scopeSlug?: string
  /** 限定版本（v3 / v4） */
  readonly version?: string
  /** 过滤掉低于该分数的命中（默认 0） */
  readonly minScore?: number
  /**
   * 话题归属优先页：这些页面的切片获得加成。
   * 依据是 topics.ts 的归属判定 —— "《安装》拥有'安装'这个话题"，
   * 因此问"怎么安装"时它应当排在只是顺带提到安装的页面之前。
   */
  readonly boostSlugs?: ReadonlyArray<string>
  /**
   * 同一页最多返回几个切片（默认 1）。
   * 全局提问时用户需要"不同页面的候选"，而"问这一页"需要同页多小节 —— 因此可配。
   */
  readonly maxPerPage?: number
}

export interface KnowledgeIndex {
  readonly size: number
  readonly chunkCount: number
  search(query: string, options?: SearchOptions): ReadonlyArray<SearchHit>
  lookup(chunkId: string): { readonly chunk: CorpusChunk; readonly page: CorpusPage } | undefined
}

const FIELD_WEIGHT_TITLE = 3
const FIELD_WEIGHT_SECTION = 3
const FIELD_WEIGHT_DESCRIPTION = 2
const FIELD_WEIGHT_HEADING = 4
const FIELD_WEIGHT_TEXT = 1

function addTokens(target: Map<string, number>, tokens: ReadonlyArray<string>, weight: number): void {
  for (const token of tokens) {
    target.set(token, (target.get(token) ?? 0) + weight)
  }
}

export function createIndex(
  pages: ReadonlyArray<CorpusPage>,
  options?: { readonly k1?: number; readonly b?: number }
): KnowledgeIndex {
  const k1 = options?.k1 ?? 1.2
  const b = options?.b ?? 0.75

  const docs: Array<DocEntry> = []
  const df = new Map<string, number>()
  let totalLength = 0

  for (const page of pages) {
    for (const chunk of page.chunks) {
      const tf = new Map<string, number>()
      addTokens(tf, tokenize(page.title), FIELD_WEIGHT_TITLE)
      if (page.sectionLabel !== undefined) addTokens(tf, tokenize(page.sectionLabel), FIELD_WEIGHT_SECTION)
      if (page.description !== undefined) addTokens(tf, tokenize(page.description), FIELD_WEIGHT_DESCRIPTION)
      addTokens(tf, tokenize(chunk.headingPath.join(" ")), FIELD_WEIGHT_HEADING)
      addTokens(tf, tokenize(chunk.text), FIELD_WEIGHT_TEXT)

      let length = 0
      for (const value of tf.values()) length += value
      totalLength += length

      for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1)
      docs.push({ chunk, page, tf, length })
    }
  }

  const avgdl = docs.length > 0 ? totalLength / docs.length : 1
  const byId = new Map(docs.map((doc) => [doc.chunk.id, doc]))

  const idf = (token: string, total: number): number => {
    const docFreq = df.get(token) ?? 0
    return Math.log(1 + (total - docFreq + 0.5) / (docFreq + 0.5))
  }

  return {
    size: pages.length,
    chunkCount: docs.length,
    lookup: (chunkId) => {
      const found = byId.get(chunkId)
      return found === undefined ? undefined : { chunk: found.chunk, page: found.page }
    },
    search: (query, searchOptions) => {
      const queryTokens = [...new Set(tokenize(query))]
      if (queryTokens.length === 0) return []
      const total = docs.length

      const candidates = docs.filter((doc) => {
        if (searchOptions?.scopeSlug !== undefined && doc.page.slug !== searchOptions.scopeSlug) {
          return false
        }
        if (searchOptions?.version !== undefined && doc.page.version !== searchOptions.version) {
          return false
        }
        return true
      })

      const normalizedQuery = query.toLowerCase().replace(/\s+/g, "")
      const identifiers = queryTokens.filter((token) => /[a-z]/.test(token) && !token.includes(" "))
      // "可判别"标识符：不是到处都有的通用词（例如 effect 出现在每一页，不能当意图信号）
      const discriminative = identifiers.filter(
        (token) => token.length >= 3 && (df.get(token) ?? 0) <= Math.max(1, Math.floor(total * 0.4))
      )

      const scored: Array<SearchHit> = []
      for (const doc of candidates) {
        let score = 0
        let matchedContent = 0
        for (const token of queryTokens) {
          const frequency = doc.tf.get(token)
          if (frequency === undefined) continue
          if (isContentToken(token)) matchedContent += 1
          const denominator = frequency + k1 * (1 - b + (b * doc.length) / avgdl)
          score += idf(token, total) * ((frequency * (k1 + 1)) / denominator)
        }
        if (score === 0) continue

        // 标识符精确出现（Effect.gen / flatMap）——Effect 场景下这是很强的信号
        const headingHaystack = `${doc.page.title}\n${doc.chunk.headingPath.join(" ")}`.toLowerCase()
        const haystack = `${headingHaystack}\n${doc.chunk.text}`.toLowerCase()
        for (const identifier of identifiers) {
          if (identifier.length >= 3 && haystack.includes(identifier)) score += 1.5
        }
        // 罕见 API 名出现在标题/小节名里 ⇒ 这是精确意图（"runSync 和 runPromise 的区别"）
        for (const identifier of discriminative) {
          if (headingHaystack.includes(identifier)) score += 6
        }
        // 话题归属页优先（由 topics.ts 判定，避免"顺带提及"压过"话题拥有者"）
        if (searchOptions?.boostSlugs?.includes(doc.page.slug) === true) score += 8
        // 短查询命中标题（"安装"）
        if (normalizedQuery.length > 0 && normalizedQuery.length <= 12) {
          const title = doc.page.title.toLowerCase().replace(/\s+/g, "")
          if (title.includes(normalizedQuery)) score += 4
        }
        // 至少要命中一个有信息量的 token，避免单字噪声
        if (matchedContent === 0) continue

        scored.push({ chunk: doc.chunk, page: doc.page, score })
      }

      scored.sort((a, b2) =>
        b2.score === a.score ? a.chunk.id.localeCompare(b2.chunk.id) : b2.score - a.score
      )
      const min = searchOptions?.minScore ?? 0
      const filtered = scored.filter((hit) => hit.score >= min)

      const maxPerPage = searchOptions?.maxPerPage ?? 1
      const perPage = new Map<string, number>()
      const diversified: Array<SearchHit> = []
      for (const hit of filtered) {
        const used = perPage.get(hit.page.slug) ?? 0
        if (used >= maxPerPage) continue
        perPage.set(hit.page.slug, used + 1)
        diversified.push(hit)
      }
      return diversified.slice(0, searchOptions?.limit ?? 8)
    }
  }
}
