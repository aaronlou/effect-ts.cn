/**
 * 译文内容门禁（PR 快速校验：不克隆上游、不联网）。
 *
 * 覆盖：
 * - frontmatter 必填字段 / 状态枚举 / 基线 commit 格式
 * - 本地路径必须镜像 upstreamPath（v4/… 目录结构一致）
 * - upstreamPath 必须存在于官方导航清单（docs-nav.json）
 * - 生命周期：非 pending/translating 必须有译者；published 必须有审校
 * - 术语黑名单（docs/glossary.json）
 * - 代码围栏不得残留 twoslash / import.meta.vitest / showLineNumbers / name="
 * - 警告：疑似未翻译段落（代码块外出现 ≥12 个连续英文词）
 *
 * 「是否落后于上游」由 snapshot + diff 负责（需要上游仓库），见 PLAN.md §6。
 */
import { readFile } from "node:fs/promises"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { asArray, asString, parseFrontmatter } from "./frontmatter.js"
import type { DocsNav } from "./nav.js"

export type CheckLevel = "error" | "warning"

export interface CheckIssue {
  readonly level: CheckLevel
  readonly file: string
  readonly message: string
}

export interface CheckResult {
  readonly total: number
  readonly errors: ReadonlyArray<CheckIssue>
  readonly warnings: ReadonlyArray<CheckIssue>
}

export interface GlossaryRule {
  readonly term: string
  readonly preferred?: string
  readonly note?: string
}

export interface Glossary {
  readonly forbidden?: ReadonlyArray<GlossaryRule>
}

const STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "translating",
  "reviewing",
  "published",
  "stale"
])

const VALIDATED_STATUSES: ReadonlySet<string> = new Set(["reviewing", "published", "stale"])

/** 这些工具元数据只存在于上游（twoslash 等），译文里必须剥掉 */
const TOOLING_LEFTOVERS: ReadonlyArray<string> = [
  "twoslash",
  "import.meta.vitest",
  "showLineNumbers",
  "name=\""
]

const COMMIT_RE = /^[0-9a-f]{40}$/

/** 连续英文词串（≥12 个）——用于粗筛"漏译段落" */
const ENGLISH_RUN_RE = /(?:\b[A-Za-z][A-Za-z'’-]*\b[ \t,.;:()[\]"'`/-]*){12,}/

/** 与 Astro 内容集合一致的收录规则：跳过 _ 前缀，收 .md/.mdx */
async function listCollectionFiles(dir: string): Promise<ReadonlyArray<string>> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: Array<string> = []
  for (const entry of entries) {
    if (entry.name.startsWith("_")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listCollectionFiles(full)))
    } else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

/** 去掉代码块与行内代码，只留正文（用于术语黑名单） */
export function stripCode(body: string): string {
  return body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "")
}

export async function loadGlossary(file: string): Promise<Glossary> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Glossary
  } catch {
    return {}
  }
}

export async function loadNav(file: string): Promise<DocsNav | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as DocsNav
  } catch {
    return undefined
  }
}

function collectNavPaths(nav: DocsNav | undefined): ReadonlySet<string> {
  const paths = new Set<string>()
  if (nav === undefined) return paths
  for (const sections of Object.values(nav.versions)) {
    for (const section of sections) {
      for (const item of section.items) paths.add(item.upstreamPath)
    }
  }
  return paths
}

export async function checkDocs(options: {
  readonly docsDir: string
  readonly nav?: DocsNav
  readonly glossary?: Glossary
}): Promise<CheckResult> {
  const docsDir = path.resolve(options.docsDir)
  const files = await listCollectionFiles(docsDir)
  const navPaths = collectNavPaths(options.nav)
  const errors: Array<CheckIssue> = []
  const warnings: Array<CheckIssue> = []

  for (const file of files) {
    const rel = path.relative(docsDir, file).split(path.sep).join("/")
    const raw = await readFile(file, "utf8")
    const { frontmatter, body } = parseFrontmatter(raw)

    const error = (message: string): void => {
      errors.push({ level: "error", file: rel, message })
    }
    const warn = (message: string): void => {
      warnings.push({ level: "warning", file: rel, message })
    }

    // 1) frontmatter 必填与格式
    const title = asString(frontmatter, "title")
    if (title === undefined || title.trim() === "") {
      error("缺少必填字段 title")
    }

    const status = asString(frontmatter, "status")
    if (status === undefined) {
      error("缺少必填字段 status（pending|translating|reviewing|published|stale）")
    } else if (!STATUSES.has(status)) {
      error(`status 非法：${status}`)
    }

    const upstreamPath = asString(frontmatter, "upstreamPath")
    const upstreamCommit = asString(frontmatter, "upstreamCommit")
    if (upstreamPath === undefined) {
      error("缺少 upstreamPath（相对官方 content/docs 的路径，如 v4/getting-started/why-effect.mdx）")
    }
    if (upstreamCommit === undefined) {
      error("缺少 upstreamCommit（翻译所对照的上游 commit）")
    } else if (!COMMIT_RE.test(upstreamCommit)) {
      error(`upstreamCommit 需为 40 位小写十六进制：${upstreamCommit}`)
    }

    // 2) 生命周期约束
    const translators = asArray(frontmatter, "translators")
    const reviewers = asArray(frontmatter, "reviewers")
    if (status !== undefined && VALIDATED_STATUSES.has(status) && translators.length === 0) {
      error(`status=${status} 必须填写 translators`)
    }
    if (status === "published" && reviewers.length === 0) {
      error("status=published 必须填写 reviewers（审校通过后方可发布）")
    }

    // 3) 目录镜像一致性 + 上游路径存在性
    if (upstreamPath !== undefined) {
      const localSlug = rel.replace(/\.mdx?$/, "")
      const upstreamSlug = upstreamPath.replace(/\.mdx?$/, "")
      if (localSlug !== upstreamSlug) {
        error(`本地路径需镜像官方：本地 ${localSlug} ≠ upstreamPath ${upstreamSlug}`)
      }
      if (navPaths.size > 0 && !navPaths.has(upstreamPath)) {
        error(`upstreamPath 不在官方导航清单中（可能是路径写错或上游已移动）：${upstreamPath}`)
      }
    }

    // 4) 代码围栏工具元数据残留
    for (const token of TOOLING_LEFTOVERS) {
      if (raw.includes(token)) {
        error(`代码围栏残留工具元数据「${token}」：应与上游代码逐字一致，只保留语言标记`)
      }
    }

    // 5) 术语黑名单（只看正文）
    const prose = stripCode(body)
    for (const rule of options.glossary?.forbidden ?? []) {
      if (rule.term !== undefined && rule.term !== "" && prose.includes(rule.term)) {
        const preferred = rule.preferred !== undefined ? ` → 请改用 ${rule.preferred}` : ""
        const note = rule.note !== undefined ? `（${rule.note}）` : ""
        error(`术语禁用词「${rule.term}」${preferred}${note}`)
      }
    }

    // 6) 疑似漏译（警告，不阻断）
    let inFence = false
    body.split(/\r?\n/).forEach((line, index) => {
      if (line.trimStart().startsWith("```")) {
        inFence = !inFence
        return
      }
      if (inFence) return
      if (ENGLISH_RUN_RE.test(line)) {
        warn(`疑似未翻译段落（第 ${index + 1} 行）`)
      }
    })
  }

  return { total: files.length, errors, warnings }
}
