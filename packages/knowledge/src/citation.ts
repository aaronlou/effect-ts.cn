/**
 * 引用协议 · 运行时部分（纯函数，零依赖）。
 *
 * 一条引用必须能被**独立核验**，否则它不是证据，只是一种修辞。本模块把语料里的
 * "带锚点的切片"变成 `CitationRecord`：同时给出**可解引用的地址**与**可核对的内容**。
 *
 * 消费方（Agent / 人）应能只凭记录本身完成三件事：
 * 1. `record.chunkText.includes(引用里的 quote)` —— 引用确实是原文的子串；
 * 2. `record.upstreamCommit` 与引用时的基线比对 —— 判断**漂移**；
 * 3. 用 `record.upstreamRawUrl` 取回官方原文，逐字核对译文。
 *
 * ⚠️ 第 1 条的"原文"指 `chunkText`（切片正文），**不是**仓库里发布的 `.mdx` 逐字节原文：
 * 入库前会做归一化（去掉行内代码的反引号、代码块截断处补 `" …"`），
 * 因此拿 `.mdx` 直接 `includes(quote)` 会有约一半对不上 —— 这是**预期**的，
 * 核验请以记录里的 `chunkText`（或 `upstreamRawUrl` 的官方原文）为准。
 */
import type { Corpus, CorpusChunk, CorpusPage } from "./types.js"

/** 与 packages/content 的 CITE_SCHEMA_VERSION 保持一致 */
export const CITE_SCHEMA_VERSION = 1

/** 规范化引用 ID：`ecn:<slug>@<commit7|unpinned>#<anchor>` */
export function citationIdOf(
  page: Pick<CorpusPage, "slug" | "upstreamCommit">,
  chunk: Pick<CorpusChunk, "anchor">
): string {
  const commit = page.upstreamCommit !== undefined ? page.upstreamCommit.slice(0, 7) : "unpinned"
  const anchor = chunk.anchor !== undefined ? `#${chunk.anchor}` : ""
  return `ecn:${page.slug}@${commit}${anchor}`
}

/** 引用记录的静态地址（由 corpus 里的 citeDigest 决定） */
export function citeUrlOf(digest: string): string {
  return `/cite/${digest}.json`
}

export interface CitationRecord {
  readonly schemaVersion: number
  /** 规范化引用 ID，适合写在答案/文章里 */
  readonly citationId: string
  /** 可解引用的静态地址：/cite/<digest>.json */
  readonly citeUrl: string
  readonly digest: string
  readonly slug: string
  readonly version: string
  readonly title: string
  readonly anchor: string
  readonly headingPath: ReadonlyArray<string>
  /** 站内页面地址 */
  readonly pageUrl: string
  /** 站内深链（含锚点） */
  readonly deepLink: string
  readonly officialUrl: string
  readonly upstreamPath?: string
  /** 该页译文当前的上游基线；与引用时的基线不同 ⇒ 已漂移 */
  readonly upstreamCommit?: string
  /** 该基线对应的官方原文（可直接取证） */
  readonly upstreamRawUrl?: string
  readonly status: string
  /** 译文落后上游 ⇒ 引用可能已过时（诚实的退化提示） */
  readonly stale: boolean
  /** 当前切片正文的指纹（sha256 前 16 位） */
  readonly contentHash?: string
  /** 当前切片正文：消费方用它核验"引用是否为原文子串" */
  readonly chunkText: string
  readonly generatedAt: string
}

/** 官方原文地址（raw），便于消费方逐字核对译文 */
export function upstreamRawUrlOf(page: CorpusPage): string | undefined {
  if (page.upstreamPath === undefined || page.upstreamCommit === undefined) return undefined
  return `https://raw.githubusercontent.com/Effect-TS/website/${page.upstreamCommit}/apps/web/src/content/docs/${page.upstreamPath}`
}

/**
 * 从语料生成全部引用记录：**一个锚点 = 一条记录**。
 *
 * 注意：检索切片（chunk）与小节（anchor）不是一对一 —— 一个长小节会被切成多个
 * 检索切片以便排序。引用必须指向**整个小节**，否则会"只引用半段话"。
 * 因此这里按锚点归并，`chunkText` 是小节内全部切片的拼接。
 *
 * 没有锚点的切片不生成记录 —— 页级引用无法定位到小节，不配作为"证据"。
 */
export function buildCitationRecords(source: Corpus): ReadonlyArray<CitationRecord> {
  const records: Array<CitationRecord> = []

  for (const page of source.pages) {
    const sections = new Map<string, Array<CorpusChunk>>()
    for (const chunk of page.chunks) {
      if (chunk.anchor === undefined || chunk.citeDigest === undefined) continue
      const list = sections.get(chunk.anchor)
      if (list === undefined) sections.set(chunk.anchor, [chunk])
      else list.push(chunk)
    }

    for (const [anchor, chunks] of sections) {
      const first = chunks[0]
      if (first === undefined || first.citeDigest === undefined) continue
      const rawUrl = upstreamRawUrlOf(page)
      records.push({
        schemaVersion: CITE_SCHEMA_VERSION,
        citationId: citationIdOf(page, first),
        citeUrl: citeUrlOf(first.citeDigest),
        digest: first.citeDigest,
        slug: page.slug,
        version: page.version,
        title: page.title,
        anchor,
        headingPath: first.headingPath,
        pageUrl: page.url,
        deepLink: `${page.url}#${anchor}`,
        officialUrl: page.officialUrl,
        ...(page.upstreamPath !== undefined ? { upstreamPath: page.upstreamPath } : {}),
        ...(page.upstreamCommit !== undefined ? { upstreamCommit: page.upstreamCommit } : {}),
        ...(rawUrl !== undefined ? { upstreamRawUrl: rawUrl } : {}),
        status: page.status,
        stale: page.status === "stale",
        ...(first.contentHash !== undefined ? { contentHash: first.contentHash } : {}),
        // 小节全文（可能由多个检索切片拼成）
        chunkText: chunks.map((chunk) => chunk.text).join("\n\n"),
        generatedAt: source.generatedAt
      })
    }
  }

  return records.sort((left, right) => left.citeUrl.localeCompare(right.citeUrl))
}

/**
 * 按 key 查引用记录。key 可以是：
 * - digest（`/cite/<digest>.json` 去掉前后缀）
 * - `slug#anchor`
 * - citationId（`ecn:slug@commit#anchor`，commit 部分忽略）
 */
export function findCitationRecord(
  records: ReadonlyArray<CitationRecord>,
  key: string
): CitationRecord | undefined {
  const trimmed = key.trim().replace(/^\/cite\//, "").replace(/\.json$/, "")
  const direct = records.find((record) => record.digest === trimmed)
  if (direct !== undefined) return direct

  const normalized = trimmed.replace(/^ecn:/, "")
  const hashIndex = normalized.indexOf("#")
  const path = hashIndex >= 0 ? normalized.slice(0, hashIndex) : normalized
  const anchor = hashIndex >= 0 ? normalized.slice(hashIndex + 1) : undefined
  // 去掉 `@commit` 部分（引用 ID 里带基线，但地址只由 slug+anchor 决定）
  const atIndex = path.lastIndexOf("@")
  const slug = atIndex > path.lastIndexOf("/") ? path.slice(0, atIndex) : path

  return records.find(
    (record) => record.slug === slug && (anchor === undefined || record.anchor === anchor)
  )
}
