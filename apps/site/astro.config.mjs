import { readFileSync } from "node:fs"
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

// 站点元信息在 src/layouts/Base.astro 中维护；此处为 Astro 构建配置。
export default defineConfig({
  site: "https://effect-ts.cn",
  output: "static",
  integrations: [
    react(),
    // MDX 需要单独传 rehype 插件（markdown 配置不作用于 .mdx）
    mdx({ rehypePlugins: [[rehypeRewriteDocsLinks, { knownSlugs: knownDocSlugs }]] }),
    sitemap()
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
