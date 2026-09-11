/**
 * 中文感知分词：把查询/正文切成检索 token。
 *
 * 为什么不用第三方分词器：
 * - 我们的语料量级（几十页）用 **CJK 单字 + 双字 bigram** 已经能获得很好的召回，
 *   且完全确定性、零依赖、可在 CI 里稳定评测（见 docs/ai-native.md 的评测门禁）；
 * - 代码标识符（Effect.gen、flatMap、Layer）是 Effect 场景的高价值检索信号，
 *   需要原样保留并额外切分 camelCase / 点号。
 */

/** CJK 统一表意文字（含扩展 A 与兼容区） */
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g
/** 拉丁/数字标识符：允许 . _ - 作为内部连接（Effect.gen、@effect/schema、v4） */
const LATIN_RUN = /[a-z0-9][a-z0-9._@/-]*/g

/** 轻量英文词干：只处理最常见的复数，避免 "Fiber" 查不到 "Fibers" 这类问题 */
function stem(token: string): string {
  if (token.length >= 4 && /^[a-z]+s$/.test(token) && !token.endsWith("ss")) {
    return token.slice(0, -1)
  }
  return token
}

function splitIdentifier(token: string): ReadonlyArray<string> {
  const parts = token.split(/[._@/-]+/).filter((part) => part.length > 0)
  const camel = parts.flatMap((part) =>
    part
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(" ")
      .filter((piece) => piece.length > 0)
  )
  return [...new Set([...parts, ...camel])]
}

export function tokenize(input: string): ReadonlyArray<string> {
  const lower = input.toLowerCase()
  const tokens: Array<string> = []

  for (const match of lower.matchAll(LATIN_RUN)) {
    const token = match[0]
    if (token.length === 0) continue
    tokens.push(stem(token))
    // 含连接符/大写边界的标识符额外切分，提升 "flatMap" / "Effect.gen" 这类查询的召回
    if (/[._@/-]/.test(token) || /[a-z][A-Z]/.test(match[0])) {
      tokens.push(...splitIdentifier(token).map(stem))
    }
  }

  for (const match of lower.matchAll(CJK_RUN)) {
    const run = match[0]
    // 单字保证召回，双字 bigram 提供区分度
    for (let i = 0; i < run.length; i += 1) tokens.push(run[i] as string)
    for (let i = 0; i + 1 < run.length; i += 1) tokens.push(run.slice(i, i + 2))
  }

  return tokens
}

/** 查询里"有信息量"的 token：CJK bigram 或长度 ≥2 的标识符（用于判定是否命中） */
export function isContentToken(token: string): boolean {
  if (/^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{2}$/.test(token)) return true
  return /[a-z0-9]/i.test(token) && token.length >= 2
}

/**
 * 查询侧停用词：中文疑问词/功能词 + 常见英文虚词。
 *
 * 它们出现在几乎每篇中文文档的**标题/小节名**里（"为什么选择 Effect？"），
 * 若参与检索与归属判定，会把"今天天气怎么样"这类无关问题也匹配上。
 * 注意：只过滤**查询侧**；文档侧保留（靠 idf 自然降权）。
 */
export const QUERY_STOPWORDS: ReadonlySet<string> = new Set([
  "什么", "是什", "怎么", "么做", "怎样", "么样", "怎么样", "如何", "为何", "为什", "为什么",
  "哪些", "哪个", "哪种", "哪里", "应该", "是否", "可以", "需要", "一个", "这个", "那个",
  "时候", "以及", "还是", "或者", "我们", "他们", "它们", "自己", "使用", "用于", "因为",
  "所以", "但是", "如果", "就是", "不能", "不会", "没有", "不同", "区别", "介绍", "什么区别",
  "而不", "不是", "直接", "同时", "例如", "比如", "以及",
  "the", "and", "for", "with", "from", "what", "how", "does", "you", "your", "are",
  // 英文虚词/功能词：中文有虚字过滤，英文同样需要。
  // 为什么必须补：严格问句门禁曾把"任何 ≥3 字符英文词"当成 API 名，于是英文无关问句
  // （「who is the president of the united states」）能靠 heading 里的 "is"/"of" 这种功能词
  // 通过话题判定，拿到带引用的答案 —— 违背"没有依据就说不知道"。
  // 这些词只从**查询侧**剔除；文档侧保留，靠 idf 自然降权。
  "a", "an", "is", "was", "were", "be", "been", "being", "do", "did", "of", "to", "in",
  "on", "at", "by", "as", "or", "but", "if", "then", "than", "that", "this", "these",
  "those", "it", "its", "we", "they", "he", "she", "his", "her", "them", "their", "our",
  "my", "who", "whom", "whose", "which", "when", "where", "why", "will", "would", "can",
  "could", "should", "shall", "may", "might", "must", "not", "no", "yes", "there", "here",
  "over", "under", "about", "into", "up", "down", "out", "off", "all", "any", "some",
  "more", "most", "such", "only", "also", "just", "very",
  // 库名本身：出现在几乎所有标题/路径里（站点叫 effect-ts.cn），不指向任何具体话题。
  // 不排除的话，话题归属的宽松阈值会把「Effect.orDie 是做什么的？」这类提问
  // 误判成"这个 API 属于某个未翻译页面"，从而错误拒答（答案其实就在已译页面里）。
  "effect"
])

/**
 * 中文虚字：出现在分词"跨词双字"里、本身不承载话题信息的字。
 * 例：「有哪些方法」会被切成 有哪/些方/方法，「的区别」切成 的区/区别 ——
 * 有哪、些方、的区 都是**分词垃圾**，却又因为罕见而 idf 很高，
 * 会把覆盖率门禁的分母抬高、把本该命中的页面误杀（实测：创建 Effect 那页覆盖率被压到 0.12）。
 */
const FUNCTION_CHARS = "的了是在有和与或而就都也还要会能可把被让给对从到用以及并但因为所以如果那么这那哪个什么怎样如何多少几时候你我他它们之其此该等上下前后里外中"

/** 查询侧噪声：2 字中文词且含虚字（保留原 token 用于文档侧的 idf，不动索引） */
export function isQueryNoise(token: string): boolean {
  if (!/^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{2}$/.test(token)) return false
  return [...token].some((char) => FUNCTION_CHARS.includes(char))
}

/**
 * 从**保留大小写**的原始查询里挑出"限定标识符"：camelCase（runSync / flatMap）
 * 或带点号/@ 的名字（Effect.gen / @effect/schema）。
 *
 * 为什么需要单独一个函数：`tokenize` 会先把输入转小写，camelCase 边界在那之后就没了
 * （`splitIdentifier` 里那条 /[a-z][A-Z]/ 分支因此永远不成立）。
 * 用途有两个：
 *   1. 严格问句门禁把"限定标识符"当作话题指向（`runSync 和 runPromise 有什么区别？`
 *      没写 `Effect.` 前缀，但它显然指向具体 API）；
 *   2. 语料覆盖率判定时把这些名字排除出分母 —— 有些索引（静态索引）在构建期删掉了代码块，
 *      API 名在里面天然 df=0，用覆盖率去卡它们会误杀合法提问。
 */
export function identifierTokens(input: string): ReadonlyArray<string> {
  const found = new Set<string>()
  for (const match of input.matchAll(/[A-Za-z0-9][A-Za-z0-9._@/-]*/g)) {
    const raw = match[0]
    // 只认 camelCase 与带点号/@ 的名字；连字符单词（state-of-the-art）不当作标识符
    if (!/[a-z][A-Z]/.test(raw) && !/[.@]/.test(raw)) continue
    for (const part of raw.split(/[._@/-]+/)) {
      if (part.length >= 2) found.add(part.toLowerCase())
    }
  }
  return [...found]
}
