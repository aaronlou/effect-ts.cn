/**
 * RSS 订阅：博客（原创 + 官方 Blog 译站）。
 * 手写 RSS 2.0，避免额外依赖；构建期为静态文件。
 */
import type { APIRoute } from "astro"
import { getCollection } from "astro:content"

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")

export const GET: APIRoute = async ({ site }) => {
  const posts = (await getCollection("blog"))
    .filter((post) => post.data.draft !== true)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())

  const base = site ?? new URL("https://effect-ts.cn/")
  const absolute = (path: string): string => new URL(path, base).href

  const items = posts
    .map((post) => {
      const url = absolute(`blog/${post.id}/`)
      return [
        "    <item>",
        `      <title>${escapeXml(post.data.title)}</title>`,
        `      <link>${url}</link>`,
        `      <guid isPermaLink="true">${url}</guid>`,
        `      <pubDate>${post.data.date.toUTCString()}</pubDate>`,
        post.data.description !== undefined
          ? `      <description>${escapeXml(post.data.description)}</description>`
          : "",
        "    </item>"
      ]
        .filter((line) => line !== "")
        .join("\n")
    })
    .join("\n")

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Effect 中文社区</title>
    <link>${absolute("/")}</link>
    <description>Effect 官方文档的中文译站与社区内容（非官方）</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${absolute("rss.xml")}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`

  return new Response(xml, {
    headers: { "content-type": "application/rss+xml; charset=utf-8" }
  })
}
