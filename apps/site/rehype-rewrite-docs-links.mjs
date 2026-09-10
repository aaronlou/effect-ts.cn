/**
 * 构建期 rehype 处理（站内链接改写）：
 *
 * 把"本站没有的链接"指向官方站点，避免死链
 *   - 目标页在文档导航内（已翻译或占位页）→ 保持站内；
 *   - 其它 /docs/...（如官方 API 参考）→ 改写为 effect.website 同路径；
 *   - 官方专属非文档路径（/play、/podcast 等）→ 同样指向 effect.website。
 *
 * 注：译文里的页内锚点用 MDX 合法的显式锚点固定，例如在标题前一行写
 * `<span id="why-not-throw-errors" />`（`{#id}` 语法在 MDX 中会引发解析错误）。
 *
 * 手写 HAST 遍历，避免额外依赖。
 */

/** 官方专属、本站不提供的路径前缀 */
const OFFICIAL_ONLY_PREFIXES = [
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

function visit(node, fn) {
  fn(node)
  const children = node.children
  if (Array.isArray(children)) {
    for (const child of children) visit(child, fn)
  }
}

/** MDX 里的裸 HTML/JSX 元素（如多行 <a href=...>）在 HAST 中是 mdxJsx* 节点 */
const JSX_NODE_TYPES = new Set(["mdxJsxFlowElement", "mdxJsxTextElement"])

export function rehypeRewriteDocsLinks(options) {
  const knownSlugs = options?.knownSlugs ?? new Set()

  /** 判断是否需要改写；返回新的 href（不需要则返回 undefined） */
  const externalHref = (href) => {
    if (typeof href !== "string" || !href.startsWith("/")) return undefined

    if (href.startsWith("/docs/")) {
      const hashIndex = href.indexOf("#")
      const hash = hashIndex >= 0 ? href.slice(hashIndex) : ""
      const pathname = hashIndex >= 0 ? href.slice(0, hashIndex) : href
      const slug = pathname.replace(/^\/docs\//, "").replace(/\/$/, "")
      if (knownSlugs.has(slug)) return undefined
      return `https://effect.website${pathname}${hash}`
    }

    if (OFFICIAL_ONLY_PREFIXES.some((prefix) => href === prefix || href.startsWith(`${prefix}/`))) {
      return `https://effect.website${href}`
    }
    return undefined
  }

  return (tree) => {
    visit(tree, (node) => {
      // 1) 普通元素（Markdown 链接）

      if (node.type === "element" && node.tagName === "a") {
        const properties = node.properties
        if (properties === undefined) return
        const next = externalHref(properties.href)
        if (next === undefined) return
        properties.href = next
        properties.target = "_blank"
        properties.rel = "external"
        return
      }

      // 2) MDX JSX 元素（原文里的裸 HTML 链接）
      if (JSX_NODE_TYPES.has(node.type) && node.name === "a") {
        const attributes = Array.isArray(node.attributes) ? node.attributes : []
        const hrefAttr = attributes.find((attribute) => attribute.name === "href")
        if (hrefAttr === undefined) return
        const next = externalHref(hrefAttr.value)
        if (next === undefined) return
        hrefAttr.value = next
        const setAttr = (name, value) => {
          const existing = attributes.find((attribute) => attribute.name === name)
          if (existing !== undefined) existing.value = value
          else attributes.push({ type: "mdxJsxAttribute", name, value })
        }
        setAttr("target", "_blank")
        setAttr("rel", "external")
      }
    })
  }
}
