/**
 * 「本站没有的链接 → 官方站点」的**唯一一份**改写规则。
 *
 * ── 为什么要有这个文件 ──────────────────────────────────────────────────
 * 译文里大量引用官方 API 参考（`/docs/v4/api/effect/HashSet`）与官方专属页面
 * （`/play` 等）。我们没有翻译 API 参考，所以这些路径在站内**必然 404**。
 * 渲染成 HTML 时装了一个 rehype 插件把它们改写到 effect.website，但
 * **Markdown 端点（`/llms-full.txt`、`/docs/<slug>.md`）是直接倾倒 `entry.body`
 * 原始 Markdown 的，没走那条管线** —— 于是这两个"给 Agent 用"的入口里
 * 全是站内死链。
 *
 * 这不是猜的：GPTBot 抓完 `/llms-full.txt` 之后照着里面的 `/docs/v3/api`、
 * `/docs/v4/api` 去请求，拿到 404（生产 Caddy 日志里可查，referer 就是 llms-full.txt）。
 *
 * 所以规则抽到这里，HTML 与 Markdown 两条路径共用，避免再次漂移。
 */

/** 官方专属、本站不提供的路径前缀 */
export const OFFICIAL_ONLY_PREFIXES = [
  "/play",
  "/podcast",
  "/community-hub",
  "/effect-days",
  "/effect-jobs",
  "/myths",
  "/merch",
  "/brand-assets",
  "/adoption-partners"
]

/**
 * 生成一个「站内链接 → 官方链接」的判定函数。
 * @param {Iterable<string>} knownSlugs 站内确实存在的文档 slug（不带 `/docs/` 前缀）
 * @returns {(href: unknown) => string | undefined} 需要改写时返回新 href，否则 undefined
 */
export function makeExternalHref(knownSlugs) {
  const known = knownSlugs instanceof Set ? knownSlugs : new Set(knownSlugs ?? [])

  return (href) => {
    if (typeof href !== "string" || !href.startsWith("/")) return undefined

    if (href.startsWith("/docs/")) {
      const hashIndex = href.indexOf("#")
      const hash = hashIndex >= 0 ? href.slice(hashIndex) : ""
      const pathname = hashIndex >= 0 ? href.slice(0, hashIndex) : href
      const slug = pathname.replace(/^\/docs\//, "").replace(/\/$/, "")
      if (known.has(slug)) return undefined
      return `https://effect.website${pathname}${hash}`
    }

    if (OFFICIAL_ONLY_PREFIXES.some((prefix) => href === prefix || href.startsWith(`${prefix}/`))) {
      return `https://effect.website${href}`
    }
    return undefined
  }
}

/** 代码围栏起始行（``` 或 ~~~，最多 3 个前导空格） */
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/

/** Markdown 链接 / 图片目标：](target) 或 ](target "title") */
const MD_TARGET_RE = /\]\(\s*(\S+?)(\s+"[^"]*")?\s*\)/g

/** 原文里的裸 HTML 链接 */
const HTML_HREF_RE = /(<a\b[^>]*?\bhref=")([^"]+)(")/gi

/**
 * 把 Markdown 里**代码之外**的片段交给 `fn` 处理，代码原样返回。
 *
 * 刻意跳过代码围栏与行内代码：译文里的代码块必须与上游逐字节一致
 * （仓库硬约束），而且代码块里出现的 `/docs/...` 是示例文本而不是链接 ——
 * 第一版直接对整篇做正则替换，把 `installation.mdx` 里 Vite 模板示例的
 * 代码块也改了，属于破坏内容。
 *
 * 改写与审计（scripts/check-links.mjs）共用这一个扫描器，避免两边对
 * "什么算链接"理解不一致。
 *
 * @param {string} markdown
 * @param {(chunk: string) => string} fn
 */
export function mapMarkdownOutsideCode(markdown, fn) {
  const out = []
  let fence = null
  for (const line of markdown.split("\n")) {
    const opened = FENCE_RE.exec(line)
    if (opened !== null) {
      const marker = opened[1][0]
      if (fence === null) fence = marker
      else if (fence === marker) fence = null
      out.push(line)
      continue
    }
    if (fence !== null) {
      out.push(line)
      continue
    }
    out.push(mapLineOutsideInlineCode(line, fn))
  }
  return out.join("\n")
}

/** 逐行交给 fn，但行内代码 `` `…` `` 原样保留 */
function mapLineOutsideInlineCode(line, fn) {
  let out = ""
  let index = 0
  while (index < line.length) {
    const tick = line.indexOf("`", index)
    if (tick === -1) return out + fn(line.slice(index))

    let runLength = 0
    while (line[tick + runLength] === "`") runLength += 1
    const close = line.indexOf("`".repeat(runLength), tick + runLength)
    if (close === -1) return out + fn(line.slice(index))

    out += fn(line.slice(index, tick))
    out += line.slice(tick, close + runLength)
    index = close + runLength
  }
  return out
}

/**
 * 改写一段 Markdown 里的站内链接目标（跳过代码）。
 * @param {string} markdown
 * @param {(href: unknown) => string | undefined} externalHref
 */
export function rewriteMarkdownLinks(markdown, externalHref) {
  return mapMarkdownOutsideCode(markdown, (chunk) => {
    /**
     * `title` 是 **第二个捕获组**，没有 title 时是 undefined。
     * 这里踩过一次：把该组改成非捕获 `(?:…)` 之后仍然取 `title`，
     * 拿到的是 replace 回调的 offset 数字 —— 改写结果变成
     * `…/HashSet#empty14`（末尾粘上偏移量）。链接审计抓不到，因为改完之后
     * 已经是**外链**、直接跳过了检查。所以这条路径有 apps/site/test 的断言兜着。
     */
    const withMarkdown = chunk.replace(MD_TARGET_RE, (whole, href, title) => {
      const next = externalHref(href)
      if (next === undefined) return whole
      return title === undefined ? `](${next})` : `](${next}${title})`
    })
    return withMarkdown.replace(HTML_HREF_RE, (whole, before, href, after) => {
      const next = externalHref(href)
      return next === undefined ? whole : `${before}${next}${after}`
    })
  })
}

/**
 * 列出一段 Markdown 里**代码之外**的全部链接目标。
 * 审计用：产物级门禁据此确认 Markdown 端点里没有站内死链。
 * @param {string} markdown
 * @returns {Array<string>}
 */
export function markdownLinkTargets(markdown) {
  const targets = []
  mapMarkdownOutsideCode(markdown, (chunk) => {
    for (const match of chunk.matchAll(MD_TARGET_RE)) targets.push(match[1])
    for (const match of chunk.matchAll(HTML_HREF_RE)) targets.push(match[2])
    return chunk
  })
  return targets
}
