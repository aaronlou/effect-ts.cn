/**
 * 译文状态模型 + 目录扫描
 */
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { asArray, asString, parseFrontmatter } from "./frontmatter.js"

export type TranslationStatus =
  | "pending"
  | "translating"
  | "reviewing"
  | "published"
  | "stale"

export interface DocEntry {
  readonly file: string
  readonly title: string
  readonly version: string
  readonly status: TranslationStatus
  readonly upstreamPath: string | undefined
  readonly upstreamCommit: string | undefined
  readonly translators: ReadonlyArray<string>
  /** 缺上游基线 = “孤儿译文”，无法判断是否过时 */
  readonly orphaned: boolean
}

const STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "translating",
  "reviewing",
  "published",
  "stale"
])

async function listMdxFiles(dir: string): Promise<ReadonlyArray<string>> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: Array<string> = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listMdxFiles(full)))
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      files.push(full)
    }
  }
  return files
}

export async function scanDocsDir(dir: string): Promise<ReadonlyArray<DocEntry>> {
  const files = await listMdxFiles(dir)
  const entries: Array<DocEntry> = []

  for (const file of files) {
    const raw = await readFile(file, "utf8")
    const { frontmatter } = parseFrontmatter(raw)

    const rawStatus = asString(frontmatter, "status") ?? "pending"
    const upstreamPath = asString(frontmatter, "upstreamPath")
    const upstreamCommit = asString(frontmatter, "upstreamCommit")

    entries.push({
      file: path.relative(dir, file),
      title: asString(frontmatter, "title") ?? "(无标题)",
      version: asString(frontmatter, "version") ?? "v4",
      status: STATUSES.has(rawStatus) ? (rawStatus as TranslationStatus) : "pending",
      upstreamPath,
      upstreamCommit,
      translators: asArray(frontmatter, "translators"),
      orphaned: upstreamPath === undefined || upstreamCommit === undefined
    })
  }

  return entries.sort((a, b) => a.file.localeCompare(b.file))
}

export interface StatusSummary {
  readonly total: number
  readonly byStatus: Readonly<Record<TranslationStatus, number>>
  readonly byVersion: Readonly<Record<string, number>>
  readonly orphaned: number
  readonly published: ReadonlyArray<DocEntry>
}

export function summarize(entries: ReadonlyArray<DocEntry>): StatusSummary {
  const byStatus: Record<TranslationStatus, number> = {
    pending: 0,
    translating: 0,
    reviewing: 0,
    published: 0,
    stale: 0
  }
  const byVersion: Record<string, number> = {}
  let orphaned = 0
  const published: Array<DocEntry> = []

  for (const entry of entries) {
    byStatus[entry.status] += 1
    byVersion[entry.version] = (byVersion[entry.version] ?? 0) + 1
    if (entry.orphaned) orphaned += 1
    if (entry.status === "published") published.push(entry)
  }

  return {
    total: entries.length,
    byStatus,
    byVersion,
    orphaned,
    published
  }
}
