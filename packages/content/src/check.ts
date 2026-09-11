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
 * - 不得残留官方 Starlight 框架导入（组件标签可保留，渲染由本站接管）
 * - 警告：页内 ASCII 锚点未用 {#id} 固定；疑似未翻译段落（代码块外出现 ≥12 个连续英文词）
 *
 * 「是否落后于上游」由 snapshot + diff 负责（需要上游仓库），见 PLAN.md §6。
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
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

/** 官方文档是 Starlight MDX：翻译时要删掉框架导入行，保留组件标签 */
const FRAMEWORK_IMPORT_LEFTOVERS: ReadonlyArray<string> = [
  "@astrojs/starlight",
  "astro/components"
]

const COMMIT_RE = /^[0-9a-f]{40}$/

/**
 * 「机器可复核」审校身份。
 *
 * 它表示：代码块与上游逐字节一致、标题/组件/链接结构对齐、术语门禁 0 命中、
 * 引用锚点可达 —— 这些都是**机器能验的**部分，**不等于人类精读**。
 * 站点上的展示文案见 apps/site/src/data/provenance.ts。
 */
export const MACHINE_REVIEWERS: ReadonlySet<string> = new Set(["ecn-review"])

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
  /**
   * 是否要求 published 页面至少有一位**非机器**审校者。
   *
   * 默认 false：站点当前 234 篇全部只有 `reviewers: [ecn-review]`（机器可复核），
   * 打开它会立刻全红 —— 是否以及何时收紧是**维护者的人类决定**，
   * Agent 既不该自己把页面标成 published，也不该替维护者宣布"已人工审校"。
   * 维护者决定收紧时：`pnpm content:check --require-human-reviewer`（并加进 CI）。
   */
  readonly requireHumanReviewer?: boolean
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
    if (
      status === "published" &&
      options.requireHumanReviewer === true &&
      reviewers.length > 0 &&
      reviewers.every((reviewer) => MACHINE_REVIEWERS.has(reviewer))
    ) {
      error(
        `status=published 但审校者只有机器身份（${reviewers.join("、")}）：` +
          "机器可复核 ≠ 人工精读，请维护者精读后追加自己的名字到 reviewers"
      )
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

    // 4b) 官方框架导入残留（译文应删掉 import 行、保留组件标签）
    for (const token of FRAMEWORK_IMPORT_LEFTOVERS) {
      if (raw.includes(token)) {
        error(
          `残留官方框架导入「${token}」：请删除该 import 行，保留 <Aside>/<Steps>/<Tabs>/<TabItem> 组件标签（本站已提供同名实现）`
        )
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

    // 7) 页内锚点：ASCII 锚点（来自上游英文 slug）必须用显式锚点固定，
    //    否则标题中文化后自动 slug 变化，跳转会失效。
    //    固定方式：在标题前一行写 `<span id="upstream-slug" />`（MDX 合法；
    //    `{#id}` 语法在 MDX 中会导致解析错误）。
    const anchoredIds = new Set(
      [...raw.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((match) => match[1])
    )
    for (const match of body.matchAll(/\]\(#([^)\s]+)\)/g)) {
      const anchor = match[1]
      if (anchor === undefined) continue
      if (!/^[A-Za-z0-9_-]+$/.test(anchor)) continue
      if (!anchoredIds.has(anchor)) {
        warn(
          `页内锚点 #${anchor} 未固定：请在标题前一行加 <span id="${anchor}" />，否则标题中文化后该跳转失效`
        )
      }
    }

    // 8) 疑似漏译（警告，不阻断）
    //    注意：URL 与行内代码不计入英文词串（否则长链接会误报）；行号按文件真实行号报告
    const frontmatterOffset =
      raw.split(/\r?\n/).length - body.split(/\r?\n/).length
    let inFence = false
    body.split(/\r?\n/).forEach((line, index) => {
      if (line.trimStart().startsWith("```")) {
        inFence = !inFence
        return
      }
      if (inFence) return
      const cleaned = line.replace(/https?:\/\/\S+/g, " ").replace(/`[^`]*`/g, " ")
      if (ENGLISH_RUN_RE.test(cleaned)) {
        warn(`疑似未翻译段落（第 ${index + 1 + frontmatterOffset} 行）`)
      }
    })
  }

  return { total: files.length, errors, warnings }
}

/**
 * 对**单篇内容**跑同一套门禁规则。
 *
 * 为什么要复用而不是另写一套：Agent 起草的译文必须与人工投稿过**同一道闸** ——
 * 否则"机器写、人审"就会悄悄降低标准。实现上把它落到临时目录再走 `checkDocs`，
 * 保证规则永远只有一份（不会随重构漂移）。
 */
export async function checkSingleFile(options: {
  readonly rel: string
  readonly raw: string
  readonly nav?: DocsNav
  readonly glossary?: Glossary
  readonly requireHumanReviewer?: boolean
}): Promise<{
  readonly errors: ReadonlyArray<CheckIssue>
  readonly warnings: ReadonlyArray<CheckIssue>
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "ecn-check-one-"))
  try {
    const full = path.join(dir, options.rel)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, options.raw, "utf8")
    const result = await checkDocs({
      docsDir: dir,
      ...(options.nav !== undefined ? { nav: options.nav } : {}),
      ...(options.glossary !== undefined ? { glossary: options.glossary } : {}),
      ...(options.requireHumanReviewer !== undefined
        ? { requireHumanReviewer: options.requireHumanReviewer }
        : {})
    })
    return { errors: result.errors, warnings: result.warnings }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
