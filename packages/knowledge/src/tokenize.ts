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
  // 库名本身：出现在几乎所有标题/路径里（站点叫 effect-ts.cn），不指向任何具体话题。
  // 不排除的话，话题归属的宽松阈值会把「Effect.orDie 是做什么的？」这类提问
  // 误判成"这个 API 属于某个未翻译页面"，从而错误拒答（答案其实就在已译页面里）。
  "effect"
])
