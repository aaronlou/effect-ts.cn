/**
 * 翻译覆盖率统计（`progress` 命令）。
 *
 * 为什么需要它：`status` 只看**本地已有译文**，所以"还有多少页没译"看不见；
 * 而 219 页的工程必须能一眼回答：v4 到哪了、v3 到哪了、提案队列里压了多少、下一批该打哪一块。
 * 统计口径（三个集合互斥）：
 *   translated —— 已落地译文（apps/site/src/content/docs，任何 status）
 *   proposed   —— 已在 .proposals/ 起草、等待人审落地
 *   remaining  —— 官方导航里有、但上面两者都没有的页面
 */
import { existsSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import type { DocsNav } from "./nav.js"
import { scanDocsDir } from "./status.js"

export interface CoverageVersion {
  readonly version: string
  readonly total: number
  readonly translated: number
  readonly proposed: number
  readonly remaining: number
}

export interface CoverageSection {
  readonly version: string
  readonly section: string
  readonly remaining: number
}

export interface CoverageReport {
  readonly total: number
  readonly translated: number
  readonly proposed: number
  readonly remaining: number
  readonly versions: ReadonlyArray<CoverageVersion>
  /** 未译页面按章节聚合（按剩余量降序），用于决定下一批打哪里 */
  readonly sections: ReadonlyArray<CoverageSection>
  /** 未译页面清单（slug），便于直接派活 */
  readonly remainingSlugs: ReadonlyArray<string>
}

/** 读取 .proposals/ 下提案的 target.slug（忽略 `_` 前缀与非 translation 提案） */
async function proposedSlugs(proposalsDir: string): Promise<ReadonlySet<string>> {
  const slugs = new Set<string>()
  if (!existsSync(proposalsDir)) return slugs
  const names = (await readdir(proposalsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
  for (const name of names) {
    try {
      const raw = await readFile(path.join(proposalsDir, name), "utf8")
      const parsed = JSON.parse(raw) as { kind?: string; target?: { slug?: string } }
      if (parsed.kind !== "translation") continue
      const slug = parsed.target?.slug
      if (typeof slug === "string" && slug !== "") slugs.add(slug)
    } catch {
      // 坏提案交给 proposals:check 报错，这里只做统计
    }
  }
  return slugs
}

export async function buildCoverageReport(options: {
  readonly nav: DocsNav
  readonly docsDir: string
  readonly proposalsDir: string
}): Promise<CoverageReport> {
  const entries = await scanDocsDir(options.docsDir)
  const translated = new Set(entries.map((entry) => entry.file.replace(/\.mdx?$/, "")))
  const proposed = await proposedSlugs(options.proposalsDir)

  const perVersion = new Map<string, { total: number; translated: number; proposed: number }>()
  const perSection = new Map<string, { version: string; section: string; remaining: number }>()
  const remainingSlugs: Array<string> = []

  for (const [version, sections] of Object.entries(options.nav.versions)) {
    const stats = perVersion.get(version) ?? { total: 0, translated: 0, proposed: 0 }
    for (const section of sections) {
      for (const item of section.items) {
        stats.total += 1
        const isTranslated = translated.has(item.slug)
        const isProposed = !isTranslated && proposed.has(item.slug)
        if (isTranslated) stats.translated += 1
        else if (isProposed) stats.proposed += 1
        else {
          remainingSlugs.push(item.slug)
          const key = `${version}|${section.label}`
          const current: { version: string; section: string; remaining: number } =
            perSection.get(key) ?? { version, section: section.label, remaining: 0 }
          current.remaining += 1
          perSection.set(key, current)
        }
      }
    }
    perVersion.set(version, stats)
  }

  const versions: Array<CoverageVersion> = [...perVersion.entries()]
    .map(([version, stats]) => ({
      version,
      total: stats.total,
      translated: stats.translated,
      proposed: stats.proposed,
      remaining: stats.total - stats.translated - stats.proposed
    }))
    .sort((left, right) => right.total - left.total)

  const sections = [...perSection.values()]
    .map(({ version, section, remaining }) => ({ version, section, remaining }))
    .sort((left, right) => right.remaining - left.remaining || left.section.localeCompare(right.section))

  const total = versions.reduce((sum, item) => sum + item.total, 0)
  const translatedCount = versions.reduce((sum, item) => sum + item.translated, 0)
  const proposedCount = versions.reduce((sum, item) => sum + item.proposed, 0)

  return {
    total,
    translated: translatedCount,
    proposed: proposedCount,
    remaining: total - translatedCount - proposedCount,
    versions,
    sections,
    remainingSlugs: remainingSlugs.sort()
  }
}

export function formatCoverage(report: CoverageReport): string {
  const lines: Array<string> = []
  const pct = (value: number): string => (report.total === 0 ? "0%" : `${Math.round((value / report.total) * 100)}%`)
  lines.push(
    `翻译覆盖：${report.translated} 已译 + ${report.proposed} 提案中 = ${report.translated + report.proposed}/${report.total}（${pct(
      report.translated + report.proposed
    )}），剩余 ${report.remaining} 页`
  )
  for (const version of report.versions) {
    const done = version.translated + version.proposed
    lines.push(
      `  [${version.version}] ${done}/${version.total}（已译 ${version.translated} · 提案 ${version.proposed} · 剩余 ${version.remaining}）`
    )
  }
  if (report.sections.length > 0) {
    lines.push("未译页面按章节（剩余量降序，取前 10）：")
    for (const section of report.sections.slice(0, 10)) {
      lines.push(`  ${String(section.remaining).padStart(3)}  [${section.version}] ${section.section}`)
    }
  }
  return lines.join("\n")
}
