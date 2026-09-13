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
import {
  definitionalSubject,
  titleContainsToken,
  isDefinitionalQuestion,
  isDefinitionHeading,
  isQuestionLike,
  rankDefinitionalTitles
} from "./intent.js"
import {
  INTERROGATIVE_CHARS,
  isContentToken,
  isQueryNoise,
  identifierTokens,
  QUERY_STOPWORDS,
  tokenize
} from "./tokenize.js"
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
   * 是否按"自然语言提问"严格判定（默认自动：问句或 ≥4 个内容词）。
   * - **回答路径**（`ask`）用默认严格：问句必须含标题级话题词或 API 名，否则宁可说"没有依据"；
   * - **关键词检索**（MCP 的 search_docs、⌘K）显式传 `false`：找页面不必这么严。
   */
  readonly strict?: boolean
  /**
   * 查询词覆盖率下限（默认 0.25，按 idf 加权）。
   * 作用：挡住"靠常见字凑分"的伪命中 —— 例如「今天北京的天气怎么样？」只蹭到"么样"一个字，
   * 覆盖率远低于阈值，就不会被当成可回答的问题。
   */
  readonly minCoverage?: number
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

/**
 * 「标题精确命中概念」的分数。
 *
 * 不是 BM25 分，不参与词频比较 —— 它是另一条判据（按标题匹配）的标记分，
 * 只要求高过 `composeAnswer` 的 minScore（默认 3），并提醒读者这条命中的来源。
 */
export const DEFINITIONAL_TITLE_SCORE = 12

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
  /** 标题词表：所有页面标题里出现过的内容词（严格问句门禁用它判断"问题有没有话题指向"） */
  const titleVocabulary = new Set<string>()
  for (const page of pages) {
    for (const token of tokenize(page.title)) {
      if (isContentToken(token)) titleVocabulary.add(token)
    }
  }
  /**
   * 小节名词表：所有切片 heading 里出现过的、**非查询停用词**的内容词。
   *
   * 与 titleVocabulary 一起构成严格问句门禁的"话题指向"判据 —— 判据必须来自**本站语料**，
   * 而不是"长得像英文"：早期实现把任何 ≥3 字符的英文词都当成 API 名，导致
   * 「who is the president of the united states」「how to cook pasta」这类无关问句
   * 也能拿到带引用的答案。停用词剔除后，heading 里的 is/of/in 不再构成话题信号。
   */
  const headingVocabulary = new Set<string>()
  for (const page of pages) {
    for (const chunk of page.chunks) {
      for (const part of chunk.headingPath) {
        for (const token of tokenize(part)) {
          if (isContentToken(token) && !QUERY_STOPWORDS.has(token)) headingVocabulary.add(token)
        }
      }
    }
  }

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
      const rawQueryTokens = [...new Set(tokenize(query))]
      // 查询侧去掉疑问词/功能词；中文单字不作为打分依据（只作为极短查询的兜底），
      // 否则"天/的/气"这类常见字会把无关问题也顶到阈值之上。
        /**
         * 噪声过滤的**最终裁定权交给语料**。
         *
         * `isQueryNoise` 是按**字**判定的（2 字词含虚字即判为噪声），本意是滤掉分词垃圾
         * （「有哪些方法」切出的 有哪 / 些方）。但它是按字判的，于是把一批**正经技术词**也误杀了：
         * 实测 `并发`（含「并」）、`超时`（含「时」）都被判成噪声 —— 而这两个恰恰是文档标题
         * 《基础并发》《超时》，也是用户最会搜的词。
         *
         * 判据修正：**它出现在某个标题或小节名里，就算真词**。
         * 仍然会被滤掉；而真实词汇由语料本身背书，不再靠一张手写的字表。
         *
         * 症状有多严重：查询「并发」此前返回**空结果**，「怎么并发跑多个 Effect？」漂到
         * 《为什么选择 Effect？》—— 而《基础并发》就在索引里。
         */
        // 真词：出现在标题/小节名里，且不含疑问字。
        // 顺序很关键：先问 isQueryNoise（它才是中文虚词的过滤器），再开这个口子。
        const isRealTerm = (token: string): boolean =>
          (titleVocabulary.has(token) || headingVocabulary.has(token)) && ![...token].some((ch) => INTERROGATIVE_CHARS.includes(ch))
        const noisy = (token: string): boolean => isQueryNoise(token) && !isRealTerm(token)
      const meaningful = rawQueryTokens.filter(
        (token) => !QUERY_STOPWORDS.has(token) && !noisy(token)
      )
      const primary = meaningful.filter(isContentToken)
      const secondary = meaningful.filter((token) => !isContentToken(token))
      /**
       * 定义型提问的**标题兜底通道**。
       *
       * 触发条件刻意收得很紧：查询侧一个内容词都没有（`primary` 为空）**且**能剥出被问的概念。
       * 典型且必须救回的一例是「Effect 是什么」—— 它是新读者最可能问的第一句话，
       * 却因为 `effect` 是查询停用词（理由见 tokenize.ts）而返回 0 命中。
       *
       * 这里给的分是**标题精确匹配**的分，不是 BM25 分：它比词频命中强得多，
       * 所以取 12（与既有的"整标题是查询子串"奖励同级），远高于 minScore=3。
       */
      if (primary.length === 0) {
        const subject = definitionalSubject(query)
        if (subject === undefined) return []
        const ranked = rankDefinitionalTitles(pages, subject).slice(0, searchOptions?.limit ?? 5)
        return ranked.flatMap((page) => {
          const first = page.chunks[0]
          return first === undefined ? [] : [{ chunk: first, page, score: DEFINITIONAL_TITLE_SCORE }]
        })
      }
      const queryTokens = primary.length > 0 ? primary : secondary.length > 0 ? secondary : rawQueryTokens
      if (queryTokens.length === 0) return []
      const total = docs.length
      const minCoverage = searchOptions?.minCoverage ?? 0.25
      // 覆盖率只在**语料里真实出现过的**查询词上计算：
      // 中文分词会产生大量跨词双字（"么安"/"而不"），它们 df=0 却拿到最高 idf，
      // 若计入分母会让所有查询的覆盖率都塌到阈值以下（曾导致"怎么安装 Effect"被拒答）。
      const inVocab = queryTokens.filter((token) => (df.get(token) ?? 0) > 0)
      const queryIdf = inVocab.reduce((sum, token) => sum + idf(token, total), 0)

      /**
       * 查询词在语料里**一个都不存在** ⇒ 打分无从谈起，退到**标题匹配**。
       *
       * 典型场景正是报错诊断：`extractIdentifiers` 给的是「错误码 + 类型名」，
       * 而错误码（TS2365）在文档里必然不存在、`effect` 又是查询停用词 ——
       * 于是整串查询零词汇命中，白跑一遍再拒答。
       *
       * 实测证据：5 个**真实** tsc 报错（Effect 的典型错误）里有 4 个栽在这条路径上，
       * 只有提到 `Stream` 的那个能答 —— 因为 `stream` 恰好不是停用词。
       * 而 Effect 最出名的就是类型报错，等于这一整类问题此前都答不了。
       *
       * 退到标题匹配的依据：标识符是**高精度**信号（是由报错文本挑出来的类型名/API 名），
       * 标题里有它就说明这一页讲的是这件事 —— 这比用错误码硬凑靠谱得多。
       */
      if (inVocab.length === 0) {
        /**
         * 注意这里必须看**过滤前**的 token。
         *
         * `queryTokens` 已经剔除了查询停用词，而 `effect` 正是停用词 ——
         * 于是「TS2345 Effect」这串查询里唯一有用的那个词在兜底眼里根本不存在，
         * 兜底等于没写（这是第一版的错误：改完之后 4 个真实报错仍然全部拒答）。
         *
         * 但也不能用全部原始 token：中文单字（的/是）会命中大量标题。
         * 取「内容词，或长度 ≥ 3」的要求即可 —— 它放过 effect 这种英文实词，
         * 挡住中文虚字。
         */
        const candidates = rawQueryTokens.filter(
          (token) => (isContentToken(token) || token.length >= 3) && !isQueryNoise(token)
        )
        // 用词边界判定（见 titleContainsToken）：`to` 不该因为 "generator" 里含 "to" 而入选
        const subject = candidates.find((token) =>
          pages.some((page) => titleContainsToken(page.title, token))
        )
        if (subject === undefined) return []
        /**
         * 刻意多给几篇候选（8 篇而不是 limit 篇）。
         *
         * 为什么：标题里含类型名的页面很多，而**真正解释这个类型的那一篇**未必排在最前 ——
         * 实测「Effect<number, never, never> 与 number 不能相加」这条报错，标题里含 Effect 的页面
         * 里《Effect 类型》才是答案，但它排在《为什么选择 Effect？》和几个"简介"页之后，
         * 只给 3 篇候选时它根本进不了模型视野，答案于是变成"提供的三段证据仅为各章节引言"。
         * 多给几篇，**重排模型才有机会把对的那篇挑出来**（它就是在干这件事的）。
         */
        return rankDefinitionalTitles(pages, subject)
          .slice(0, 8)
          .flatMap((page) => {
            const first = page.chunks[0]
            return first === undefined ? [] : [{ chunk: first, page, score: DEFINITIONAL_TITLE_SCORE }]
          })
      }

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

      /**
       * 严格问句门禁：**自然语言问句**必须含"标题级话题词"或 API 名，否则不给结果。
       *
       * 为什么：234 页规模下，无关问句（「今天北京的天气怎么样？」「推荐一部科幻电影」）
       * 会靠两个通用双字词（天气/的天、推荐/一部）同时出现在某页正文里而命中 ——
       * 一个承诺"没有依据就说不知道"的知识层不该这样回答。
       * 标题里出现过的词（安装 / 运行 / Layer…）或 API 名（runSync / Schema）才算话题指向；
       * 关键词检索（非问句）不受此限，避免影响搜索框的召回。
       */
      const naturalLanguage =
        searchOptions?.strict ??
        (isQuestionLike(query) || rawQueryTokens.filter(isContentToken).length >= 4)
      if (naturalLanguage) {
        // 注意用**过滤前**的 token：effect 这类词被列进了查询停用词（打分时不计），
        // 但它仍然是 API 名，应当算"话题指向"。
        //
        // 判据必须来自语料本身（标题词 / 小节词）或"限定标识符"（Effect.gen、runSync、
        // @effect/schema 这类名字），**不能**是"含英文"：否则任何英文句子都能通过。
        const identifiers0 = identifierTokens(query)
        const hasTopic =
          rawQueryTokens.some(
            (token) => titleVocabulary.has(token) || headingVocabulary.has(token)
          ) || identifiers0.length > 0
        if (!hasTopic) return []
        // 语料覆盖率：查询的内容词有多少**在本站语料里真实存在**。
        // 为什么需要它：英文长句可能恰好蹭到某一个真实存在的小节词
        // （「the quick brown fox … lazy dog」命中 "Lazy Evaluation of Defaults" 的 lazy），
        // 从而通过 hasTopic 并靠 heading 加成拿到答案。这类句子的特征不是"命中了一个词"，
        // 而是**绝大部分词在本语料里根本不存在**（实测该句 6 个内容词只有 1 个存在）。
        // 0.4 的取值来自实测分布：13 条金标问句最低 0.50，无关问句最高 0.33。
        // 限定标识符不计入分母：它们指向具体 API，不该被"覆盖率"否决。
        const identifierSet = new Set(identifiers0)
        const contentQueryTokens = queryTokens.filter(
          (token) => isContentToken(token) && !identifierSet.has(token)
        )
        if (contentQueryTokens.length > 0) {
          const known = contentQueryTokens.filter((token) => (df.get(token) ?? 0) > 0).length
          if (known / contentQueryTokens.length < 0.4) return []
        }
      }
      const identifiers = queryTokens.filter((token) => /[a-z]/.test(token) && !token.includes(" "))
      // "可判别"标识符：不是到处都有的通用词（例如 effect 出现在每一页，不能当意图信号）
      const discriminative = identifiers.filter(
        (token) => token.length >= 3 && (df.get(token) ?? 0) <= Math.max(1, Math.floor(total * 0.4))
      )

      // 查询词命中"页面标题 / 小节名"⇒ 强话题信号（中文同样适用，不只是 API 名）。
      // 没有这一条时，「为什么选择 Effect 而不是直接用 Promise？」会被正文里
      // "直接/而不"这类常见搭配的页面压过，而真正拥有该话题的《为什么选择 Effect》反而掉出前三。
      const titleBoostable = queryTokens.filter(
        (token) => token.length >= 2 && (df.get(token) ?? 0) <= Math.max(2, Math.floor(total * 0.4))
      )

      // 定义型问题（"Fiber 是什么？"）优先定义小节，见 intent.ts
      const definitional = isDefinitionalQuestion(query)

      const scored: Array<SearchHit> = []
      for (const doc of candidates) {
        let score = 0
        let matchedContent = 0
        let matchedInHeading = 0
        const headingText = `${doc.page.title}\n${doc.chunk.headingPath.join(" ")}\n${
          doc.page.sectionLabel ?? ""
        }`.toLowerCase()
        for (const token of queryTokens) {
          const frequency = doc.tf.get(token)
          if (frequency === undefined) continue
          if (isContentToken(token)) matchedContent += 1
          if (headingText.includes(token)) matchedInHeading += 1
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
        // 定义型问题：优先"什么是 / 简介 / 概述"这类小节（只对已有词面命中的切片生效）
        if (definitional && doc.chunk.headingPath.some((part) => isDefinitionHeading(part))) score += 6
        // 话题归属页优先（由 topics.ts 判定，避免"顺带提及"压过"话题拥有者"）
        if (searchOptions?.boostSlugs?.includes(doc.page.slug) === true) score += 8
        // 查询词出现在页面标题 / 小节名里
        for (const token of titleBoostable) {
          if (doc.page.title.toLowerCase().includes(token)) score += 3
          else if (headingHaystack.includes(token)) score += 2
        }
        // 整标题是查询的子串（"怎么运行一个 Effect？" 含 "运行 Effect"）⇒ 强话题信号。
        // 234 页规模下，这条比零散词频更能区分"这一页就是答案"与"这一页顺带提到"。
        const titleNoSpace = doc.page.title.toLowerCase().replace(/\s+/g, "")
        if (titleNoSpace.length >= 4 && normalizedQuery.includes(titleNoSpace)) score += 12
        // 标题词覆盖：查询覆盖了该页标题里的几个内容词（"运行 Effect" 2/2，"Runtime" 0/1）。
        // 自然语言提问下这是"这一页就是答案"的最强信号，比零散正文词频可靠得多。
        const titleTokens = [...new Set(tokenize(doc.page.title))].filter(isContentToken)
        if (titleTokens.length > 0) {
          const covered = titleTokens.filter((token) => rawQueryTokens.includes(token)).length
          if (covered > 0) score += Math.min(covered * 4, 12)
        }
        // 短查询命中标题（"安装"）
        if (normalizedQuery.length > 0 && normalizedQuery.length <= 12) {
          const title = doc.page.title.toLowerCase().replace(/\s+/g, "")
          if (title.includes(normalizedQuery)) score += 4
        }
        // 至少要命中一个有信息量的 token，避免单字噪声
        if (matchedContent === 0) continue
        // 只蹭到**一个**词、而且它只出现在正文里 ⇒ 拒绝。
        // 例：「推荐一部科幻电影」只匹配到正文里的"推荐使用 TypeScript"，
        // 这种"顺带提及"不该被当成可回答的依据（宁可说不知道）。
        if (matchedContent < 2 && matchedInHeading === 0) continue

        // idf 加权覆盖率门禁：挡住"蹭到一两个通用词"的伪命中
        if (inVocab.length > 0 && queryIdf > 0) {
          const matchedIdf = inVocab.reduce(
            (sum, token) => (doc.tf.has(token) ? sum + idf(token, total) : sum),
            0
          )
          if (matchedIdf / queryIdf < minCoverage) continue
        }

        // v4 优先：v3/v4 内容高度重合，站点以 v4 为当前版本（同分时也不该让 v3 靠索引顺序胜出）
        const versionBoost = doc.page.version === "v4" ? 1.15 : 1
        scored.push({ chunk: doc.chunk, page: doc.page, score: score * versionBoost })
      }

      scored.sort((a, b2) => {
        if (b2.score !== a.score) return b2.score - a.score
        const rank = (version: string) => (version === "v4" ? 0 : 1)
        const byVersion = rank(a.page.version) - rank(b2.page.version)
        return byVersion !== 0 ? byVersion : a.chunk.id.localeCompare(b2.chunk.id)
      })
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
