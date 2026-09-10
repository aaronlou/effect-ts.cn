/**
 * 站内搜索索引（构建期静态 JSON）：
 * - 已翻译文档：标题 + 章节 + 正文纯文本（去掉 Markdown 标记）
 * - 未翻译文档：标题 + 章节（标注 translated=false，前端会给"英文原文"提示）
 * - 博客：标题 + 正文纯文本
 */
import type { APIRoute } from "astro"
import { getCollection } from "astro:content"
import { docsNav } from "../lib/docs"

interface SearchEntry {
  readonly type: "doc" | "blog"
  readonly title: string
  readonly url: string
  readonly section: string
  readonly translated: boolean
  readonly text: string
}

/** 粗略去 Markdown，保留可搜索文本 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/^---[\s\S]*?---/, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[>\-*+]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    // 上限 12000 字：⌘K 与"无后端时的浏览器内检索"共用这份索引。
    // 早先的 4000 字会让《Layer 与依赖注入》这类长文的后半部分完全搜不到 ——
    // 索引是懒加载的，体积代价远小于"搜不到"的代价。
    .slice(0, 12000)
}

export const GET: APIRoute = async () => {
  const docs = await getCollection("docs")
  const posts = await getCollection("blog")
  const translatedIds = new Set(docs.map((doc) => doc.id))

  const entries: Array<SearchEntry> = []

  for (const doc of docs) {
    entries.push({
      type: "doc",
      title: doc.data.title,
      url: `/docs/${doc.id}/`,
      section: doc.data.description ?? "",
      translated: true,
      text: plainText(doc.body ?? "")
    })
  }

  for (const [version, sections] of Object.entries(docsNav.versions)) {
    for (const section of sections) {
      for (const item of section.items) {
        if (translatedIds.has(item.slug)) continue
        entries.push({
          type: "doc",
          title: item.label,
          url: `/docs/${item.slug}/`,
          section: `${version} · ${section.label}`,
          translated: false,
          text: ""
        })
      }
    }
  }

  for (const post of posts) {
    if (post.data.draft === true) continue
    entries.push({
      type: "blog",
      title: post.data.title,
      url: `/blog/${post.id}/`,
      section: post.data.description ?? "",
      translated: true,
      text: plainText(post.body ?? "")
    })
  }

  return new Response(JSON.stringify(entries), {
    headers: { "content-type": "application/json; charset=utf-8" }
  })
}
