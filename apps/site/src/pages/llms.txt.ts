/**
 * llms.txt：给 LLM / AI 工具准备的站点导览（官方 LLMS.md 同思路）。
 * 结构：站点简介 + 已翻译文档（含上游基线）+ 官方原文入口 + 参与方式。
 */
import type { APIRoute } from "astro"
import { getCollection } from "astro:content"
import { docsNav, officialUrl } from "../lib/docs"

export const GET: APIRoute = async ({ site }) => {
  const base = (site ?? new URL("https://effect-ts.cn/")).href.replace(/\/$/, "")
  const docs = await getCollection("docs")
  const posts = (await getCollection("blog")).filter((post) => post.data.draft !== true)

  const translated = docs
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((doc) =>
      [
        `- [${doc.data.title}](${base}/docs/${doc.id}/)`,
        `  - 上游：${doc.data.upstreamPath ?? "未标注"} @${(doc.data.upstreamCommit ?? "").slice(0, 7)}`,
        `  - 官方原文：${officialUrl(doc.id)}`
      ].join("\n")
    )
    .join("\n")

  const sections = Object.entries(docsNav.versions)
    .map(([version, list]) => {
      const lines = list
        .map((section) => {
          const items = section.items.map((item) => `    - ${item.label}: ${base}/docs/${item.slug}/`)
          return [`  - ${section.label}`, ...items].join("\n")
        })
        .join("\n")
      return `- ${version}\n${lines}`
    })
    .join("\n")

  const blog = posts
    .map((post) => `- [${post.data.title}](${base}/blog/${post.id}/)`)
    .join("\n")

  const body = `# Effect 中文社区（effect-ts.cn）

> 非官方社区站。Effect 官方文档（Effect-TS/website）的中文译站 + 社区内容。
> 每篇译文都标注所对照的上游 commit，上游更新后会被标记为 stale，可审计。
> 官方站点：https://effect.website/ ；官方文档源仓库：https://github.com/Effect-TS/website

## 已翻译文档（中文，推荐优先阅读）

${translated || "（暂无）"}

## 全站文档导航（镜像官方结构；未翻译页提供英文原文入口）

${sections}

## 博客

${blog || "（暂无）"}

## AI / Agent 入口（答案带引用；citations 为空即拒答）

- 站内问答（人）：${base}/ask/ · 文档页内 ⌘I
- 报错诊断（人）：${base}/debug/
- HTTP 问答：POST ${base}/api/knowledge/ask（或 GET ?q=...）· 统计：GET ${base}/api/knowledge/stats
- 报错定位：POST ${base}/api/knowledge/explain
- MCP Server：仓库内 \`pnpm mcp\`（工具：search_docs / get_page / ask / glossary / translation_status）
- 接入指南：${base}/docs/agent-integration.md

## 其他入口

- 翻译进度：${base}/docs/translation-status/
- 术语表：${base}/glossary/
- 内容许可：本站译文遵循上游 MIT 许可，页面内标注原文地址与基线 commit
- 参与翻译：见 ${base}/docs/ 与仓库 docs/translation-guide.md
`

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" }
  })
}
