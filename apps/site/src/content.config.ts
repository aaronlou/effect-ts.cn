import { defineCollection, z } from "astro:content"
import { glob } from "astro/loaders"

/**
 * 文档译站内容集合（镜像官方目录：v3/ 与 v4/ 由路径决定版本）。
 *
 * 与官方 frontmatter 对齐（title/description/sidebar/tableOfContents/draft），
 * 并增加译文同步元数据：status + upstreamPath + upstreamCommit + 译者。
 * 状态机见 PLAN.md §1.2：pending → translating → reviewing → published，(上游变动) → stale
 */
const docs = defineCollection({
  // 与官方一致：_ 前缀的文件/目录不参与内容集合（如 _README.md、_assets）
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    sidebar: z
      .object({
        label: z.string().optional(),
        order: z.number().optional(),
        hidden: z.boolean().optional()
      })
      .optional(),
    tableOfContents: z
      .union([
        z.boolean(),
        z.object({
          minHeadingLevel: z.number().optional(),
          maxHeadingLevel: z.number().optional()
        })
      ])
      .optional(),
    draft: z.boolean().optional(),
    // —— 以下为译文同步元数据（本站新增）——
    status: z
      .enum(["pending", "translating", "reviewing", "published", "stale"])
      .default("pending"),
    /** 上游文件路径，相对官方 content/docs（如 v4/getting-started/why-effect.mdx） */
    upstreamPath: z.string().optional(),
    /** 同步基线：翻译时对照的上游 commit */
    upstreamCommit: z.string().optional(),
    translators: z.array(z.string()).default([]),
    reviewers: z.array(z.string()).default([]),
    publishedAt: z.date().optional()
  })
})

/** 博客：官方 Blog 译站 + 社区原创（原创必填 original: true） */
const blog = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.date(),
    draft: z.boolean().default(false),
    original: z.boolean().default(true),
    authors: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    /** 译站文章：原文地址 */
    sourceUrl: z.string().url().optional(),
    /** 译站文章：对应的上游 commit */
    upstreamCommit: z.string().optional()
  })
})

export const collections = { docs, blog }
