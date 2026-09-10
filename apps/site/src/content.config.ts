import { defineCollection, z } from "astro:content"
import { glob } from "astro/loaders"

/**
 * 文档译站内容集合。
 *
 * 译文（.mdx）与官方保持“可追溯同步”：frontmatter 中 upstreamCommit 记录
 * 所对应的上游 commit，CI（packages/content）发现落后会自动标 stale。
 * 状态机见 PLAN.md §1.2：pending → translating → reviewing → published，(upstream 变动) → stale
 */
const docs = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    /** 译文面向的官方版本主线 */
    version: z.enum(["v3", "v4"]).default("v4"),
    status: z
      .enum(["pending", "translating", "reviewing", "published", "stale"])
      .default("pending"),
    /** 上游文件路径（如 getting-started/introduction.mdx） */
    upstreamPath: z.string().optional(),
    /** 上游 commit hash（同步基线） */
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
