import { existsSync, readFileSync, readdirSync } from "node:fs"
import { defineConfig } from "astro/config"
import react from "@astrojs/react"
import mdx from "@astrojs/mdx"
import sitemap from "@astrojs/sitemap"
import { rehypeRewriteDocsLinks } from "./rehype-rewrite-docs-links.mjs"

// 文档导航由内容管线生成（ecn-content nav），这里用它判断站内 /docs 链接是否可达
const nav = JSON.parse(readFileSync(new URL("./src/data/docs-nav.json", import.meta.url), "utf8"))
const knownDocSlugs = new Set(
  Object.values(nav.versions).flatMap((sections) =>
    sections.flatMap((section) => section.items.map((item) => item.slug))
  )
)

/**
 * sitemap 的 lastmod 数据源（见下方 serialize 的说明）。
 * 直接读文件而不是走内容集合：astro.config 在内容集合可用之前就被求值。
 */
const blogDates = (() => {
  const out = new Map()
  const dir = new URL("./src/content/blog/", import.meta.url)
  if (!existsSync(dir)) return out
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".mdx")) continue
    const raw = readFileSync(new URL(file, dir), "utf8")
    const match = /^date:\s*(\d{4}-\d{2}-\d{2})/m.exec(raw)
    if (match !== null) out.set(file.replace(/\.mdx$/, ""), new Date(match[1]).toISOString())
  }
  return out
})()

const errorSeen = (() => {
  const out = new Map()
  try {
    const snapshot = JSON.parse(readFileSync(new URL("./src/data/errors.json", import.meta.url), "utf8"))
    for (const entry of snapshot.entries ?? []) out.set(entry.signature, entry.lastSeen)
  } catch {
    // 快照可能还没生成（首次构建）：没有就不标 lastmod，不影响构建
  }
  return out
})()

// 站点元信息在 src/layouts/Base.astro 中维护；此处为 Astro 构建配置。
export default defineConfig({
  site: "https://effect-ts.cn",
  output: "static",
  integrations: [
    react(),
    // MDX 需要单独传 rehype 插件（markdown 配置不作用于 .mdx）
    mdx({ rehypePlugins: [[rehypeRewriteDocsLinks, { knownSlugs: knownDocSlugs }]] }),
    /**
     * sitemap：`lastmod` **只在真正知道内容何时变过的地方标**。
     *
     * 全站盖同一个构建时间戳是最常见的做法，也是没用的做法 —— 每个 URL 的 lastmod
     * 都等于昨天，搜索引擎会直接忽略这个字段（甚至降低对它的信任）。
     * 这里只标两处确切的：
     *   · 博客文章 → frontmatter 里的 date
     *   · 报错百科条目 → 该报错最近被问到的时刻（lastSeen）
     * 其余（译文页等）不标 —— 我们并没有一个可靠的"这页何时变过"的日期，
     * 宁可不写，也不编一个。
     */
    sitemap({
      serialize(item) {
        const path = new URL(item.url).pathname
        let lastmod
        if (path.startsWith("/blog/")) {
          const slug = path.replace(/^\/blog\//, "").replace(/\/$/, "")
          const post = blogDates.get(slug)
          if (post !== undefined) lastmod = post
        } else if (path.startsWith("/errors/")) {
          const signature = path.replace(/^\/errors\//, "").replace(/\/$/, "")
          const entry = errorSeen.get(signature)
          if (entry !== undefined) lastmod = entry
        }
        return lastmod === undefined ? item : { ...item, lastmod }
      }
    })
  ],
  markdown: {
    // .md 文件同样改写（译文与博客目前都是 .mdx，这里作为兜底）
    rehypePlugins: [[rehypeRewriteDocsLinks, { knownSlugs: knownDocSlugs }]]
  },
  vite: {
    server: {
      // 本地开发：把 /api/* 代理到 Effect 后端（pnpm dev 时 api 运行在 8787）
      proxy: {
        "/api": "http://localhost:8787"
      }
    }
  }
})
