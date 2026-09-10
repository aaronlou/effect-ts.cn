/**
 * Agent 起草提案队列（proposal queue）。
 *
 * 为什么需要：Agent 时代最大的杠杆不是"让 Agent 读"，而是**让 Agent 产出可审阅的痕迹**。
 * 219 页未译 + 每日上游漂移，靠人力永远追不上；而"机器写、人审"之所以安全，
 * 前提是仓库里已经有**能机械判定的门禁**（frontmatter / 路径镜像 / 术语 / 元数据残留）。
 *
 * 设计要点（每一条都是为了防止"AI 批量灌水"）：
 * 1. 提案是**文件**（`.proposals/<id>.json`），不是数据库：可 review、可 diff、可回滚、零后端；
 * 2. 提案里的内容必须过**与人工投稿完全相同的门禁**（直接复用 `checkDocs` 的规则）；
 * 3. **治理不变量**：`status` 只能是 `translating` / `reviewing`；`reviewers` 必须为空
 *    —— Agent 不能自行发布，也不能替自己背书；
 * 4. `draftedBy` 必须可追溯（agent 必须声明 model），`rationale` 必须写出理由；
 * 5. 落地（apply）是**显式的人工动作**，且默认不覆盖已有译文。
 */
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { checkSingleFile, loadGlossary, loadNav, type Glossary } from "./check.js"
import { asArray, asString, parseFrontmatter } from "./frontmatter.js"
import type { DocsNav } from "./nav.js"
import { scanDocsDir } from "./status.js"

export const PROPOSAL_KINDS = ["translation", "stale-update", "faq", "glossary"] as const
export type ProposalKind = (typeof PROPOSAL_KINDS)[number]

/** 提案内容允许的状态：Agent 不得声明已发布，发布由人类决定 */
const ALLOWED_CONTENT_STATUSES: ReadonlySet<string> = new Set(["translating", "reviewing"])

/** rationale 的最短长度：逼出"为什么"，而不是"AI 生成" */
const MIN_RATIONALE_LENGTH = 20

export interface ProposalDraft {
  readonly id: string
  readonly kind: ProposalKind
  readonly createdAt: string
  readonly draftedBy: {
    readonly kind: "agent" | "human"
    readonly name: string
    readonly model?: string
    readonly promptVersion?: string
  }
  readonly rationale: string
  readonly target: {
    readonly slug: string
    readonly upstreamPath: string
    readonly upstreamCommit?: string
  }
  /** 完整 MDX（含 frontmatter）；translation / stale-update 必填 */
  readonly content?: string
  readonly notes?: string
}

export interface ProposalIssue {
  readonly level: "error" | "warning"
  readonly message: string
}

export interface ProposalContext {
  readonly nav?: DocsNav
  readonly glossary?: Glossary
  readonly navPaths: ReadonlySet<string>
  readonly translatedSlugs: ReadonlySet<string>
}

export interface ProposalCheckResult {
  readonly total: number
  readonly byKind: Record<ProposalKind, number>
  readonly errors: ReadonlyArray<ProposalIssue>
  readonly warnings: ReadonlyArray<ProposalIssue>
  readonly proposals: ReadonlyArray<ProposalDraft>
}

export async function loadProposalContext(options: {
  readonly navFile: string
  readonly glossaryFile: string
  readonly docsDir: string
}): Promise<ProposalContext> {
  const nav = await loadNav(options.navFile)
  const glossary = await loadGlossary(options.glossaryFile)

  const navPaths = new Set<string>()
  for (const sections of Object.values(nav?.versions ?? {})) {
    for (const section of sections) {
      for (const item of section.items) navPaths.add(item.upstreamPath)
    }
  }

  const entries = await scanDocsDir(options.docsDir)
  const translatedSlugs = new Set(entries.map((entry) => entry.file.replace(/\.mdx?$/, "")))

  return {
    ...(nav !== undefined ? { nav } : {}),
    glossary,
    navPaths,
    translatedSlugs
  }
}

export async function validateProposal(
  id: string,
  raw: string,
  context: ProposalContext
): Promise<{
  readonly proposal?: ProposalDraft
  readonly errors: ReadonlyArray<ProposalIssue>
  readonly warnings: ReadonlyArray<ProposalIssue>
}> {
  const errors: Array<ProposalIssue> = []
  const warnings: Array<ProposalIssue> = []
  const error = (message: string): void => {
    errors.push({ level: "error", message: `${id}: ${message}` })
  }
  const warn = (message: string): void => {
    warnings.push({ level: "warning", message: `${id}: ${message}` })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    error(`不是合法 JSON（${String(cause)}）`)
    return { errors, warnings }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    error("提案必须是一个 JSON 对象")
    return { errors, warnings }
  }
  const record = parsed as Record<string, unknown>

  const declaredId = typeof record["id"] === "string" ? record["id"] : undefined
  if (declaredId === undefined) error("缺少 id")
  else if (declaredId !== id) error(`id 与文件名不一致（${declaredId} ≠ ${id}）`)

  const kind = typeof record["kind"] === "string" ? record["kind"] : undefined
  if (kind === undefined) {
    error("缺少 kind")
  } else if (!(PROPOSAL_KINDS as ReadonlyArray<string>).includes(kind)) {
    error(`kind 非法：${kind}（应为 ${PROPOSAL_KINDS.join(" | ")}）`)
  }

  const createdAt = typeof record["createdAt"] === "string" ? record["createdAt"] : undefined
  if (createdAt === undefined) error("缺少 createdAt")
  else if (Number.isNaN(Date.parse(createdAt))) error(`createdAt 不是可解析的时间：${createdAt}`)

  const draftedByRaw = record["draftedBy"]
  let draftedBy: ProposalDraft["draftedBy"] | undefined
  if (typeof draftedByRaw !== "object" || draftedByRaw === null) {
    error("缺少 draftedBy（谁起草的必须可追溯）")
  } else {
    const draft = draftedByRaw as Record<string, unknown>
    const draftedKind = draft["kind"]
    const name = draft["name"]
    const model = draft["model"]
    if (draftedKind !== "agent" && draftedKind !== "human") {
      error("draftedBy.kind 必须是 agent 或 human")
    }
    if (typeof name !== "string" || name.trim() === "") error("draftedBy.name 不能为空")
    if (draftedKind === "agent" && (typeof model !== "string" || model.trim() === "")) {
      error("draftedBy.kind=agent 时必须声明 draftedBy.model（provenance 不能缺）")
    }
    if ((draftedKind === "agent" || draftedKind === "human") && typeof name === "string") {
      draftedBy = {
        kind: draftedKind,
        name,
        ...(typeof model === "string" ? { model } : {}),
        ...(typeof draft["promptVersion"] === "string" ? { promptVersion: draft["promptVersion"] } : {})
      }
    }
  }

  const rationale = typeof record["rationale"] === "string" ? record["rationale"] : undefined
  if (rationale === undefined) error("缺少 rationale")
  else if (rationale.trim().length < MIN_RATIONALE_LENGTH) {
    error(`rationale 至少 ${MIN_RATIONALE_LENGTH} 字：要写清「为什么提这个」，不接受「AI 生成」这类空话`)
  }

  const targetRaw = record["target"]
  let target: ProposalDraft["target"] | undefined
  if (typeof targetRaw !== "object" || targetRaw === null) {
    error("缺少 target")
  } else {
    const raw = targetRaw as Record<string, unknown>
    const slug = typeof raw["slug"] === "string" ? raw["slug"] : undefined
    const upstreamPath = typeof raw["upstreamPath"] === "string" ? raw["upstreamPath"] : undefined
    const upstreamCommit = typeof raw["upstreamCommit"] === "string" ? raw["upstreamCommit"] : undefined

    if (slug === undefined || slug.trim() === "") error("缺少 target.slug")
    if (upstreamPath === undefined || upstreamPath.trim() === "") error("缺少 target.upstreamPath")

    if (slug !== undefined && upstreamPath !== undefined) {
      const slugFromPath = upstreamPath.replace(/\.mdx?$/, "")
      if (slug !== slugFromPath) {
        error(`target.slug 必须镜像 upstreamPath：${slug} ≠ ${slugFromPath}`)
      }
      if (context.navPaths.size > 0 && !context.navPaths.has(upstreamPath)) {
        error(`target.upstreamPath 不在官方导航清单中：${upstreamPath}`)
      }
      if (upstreamCommit !== undefined && !/^[0-9a-f]{40}$/.test(upstreamCommit)) {
        error(`target.upstreamCommit 需为 40 位小写 hex：${upstreamCommit}`)
      }
      target = { slug, upstreamPath, ...(upstreamCommit !== undefined ? { upstreamCommit } : {}) }
    }
  }

  const content = typeof record["content"] === "string" ? record["content"] : undefined

  if ((kind === "translation" || kind === "stale-update") && (content === undefined || content.trim() === "")) {
    error(`${kind} 提案必须提供完整 content（含 frontmatter 的 MDX）`)
  }
  if (kind === "translation" && target !== undefined && context.translatedSlugs.has(target.slug)) {
    error(`该页已有中文译文（${target.slug}）—— 若要更新落后译文，请用 kind="stale-update"`)
  }
  if (kind === "stale-update" && target !== undefined && target.upstreamCommit === undefined) {
    error('kind="stale-update" 必须给出 target.upstreamCommit（要更新到哪个上游 commit）')
  }

  if (content !== undefined && content.trim() !== "" && target !== undefined) {
    const { frontmatter } = parseFrontmatter(content)

    const status = asString(frontmatter, "status")
    if (status === undefined) error("content 的 frontmatter 缺少 status")
    else if (!ALLOWED_CONTENT_STATUSES.has(status)) {
      error(`content 的 status 只能是 translating 或 reviewing（当前 ${status}）—— 发布由人决定`)
    }

    if (asArray(frontmatter, "reviewers").length > 0) {
      error("content 的 reviewers 必须为空：Agent 不能替自己背书")
    }

    const contentUpstreamPath = asString(frontmatter, "upstreamPath")
    if (contentUpstreamPath !== undefined && contentUpstreamPath !== target.upstreamPath) {
      error(
        `content.upstreamPath（${contentUpstreamPath}）与 target.upstreamPath（${target.upstreamPath}）不一致`
      )
    }

    // 关键：Agent 起草的内容要过**与人工投稿相同**的门禁
    const gate = await checkSingleFile({
      rel: `${target.slug}.mdx`,
      raw: content,
      ...(context.nav !== undefined ? { nav: context.nav } : {}),
      ...(context.glossary !== undefined ? { glossary: context.glossary } : {})
    })
    for (const issue of gate.errors) error(`内容门禁：${issue.message}`)
    for (const issue of gate.warnings) warn(`内容门禁：${issue.message}`)
  } else if (kind === "faq" || kind === "glossary") {
    warn("该提案不产生 .mdx 变更（faq / glossary 目前仅作记录，由维护者人工落地）")
  }

  if (errors.length > 0) return { errors, warnings }

  return {
    proposal: {
      id: declaredId ?? id,
      kind: kind as ProposalKind,
      createdAt: createdAt ?? new Date(0).toISOString(),
      draftedBy: draftedBy as ProposalDraft["draftedBy"],
      rationale: rationale ?? "",
      target: target as ProposalDraft["target"],
      ...(content !== undefined ? { content } : {}),
      ...(typeof record["notes"] === "string" ? { notes: record["notes"] } : {})
    },
    errors,
    warnings
  }
}

/** 读取并校验一个目录下的全部提案（`_` 前缀视为模板/草稿，跳过） */
export async function loadProposals(
  dir: string,
  context: ProposalContext
): Promise<ProposalCheckResult> {
  const proposalsDir = path.resolve(dir)
  const byKind: Record<ProposalKind, number> = {
    translation: 0,
    "stale-update": 0,
    faq: 0,
    glossary: 0
  }
  const errors: Array<ProposalIssue> = []
  const warnings: Array<ProposalIssue> = []
  const proposals: Array<ProposalDraft> = []

  if (!existsSync(proposalsDir)) {
    return { total: 0, byKind, errors, warnings, proposals }
  }

  const names = (await readdir(proposalsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort()

  for (const name of names) {
    const raw = await readFile(path.join(proposalsDir, name), "utf8")
    const result = await validateProposal(name.replace(/\.json$/, ""), raw, context)
    errors.push(...result.errors)
    warnings.push(...result.warnings)
    if (result.proposal !== undefined) {
      proposals.push(result.proposal)
      byKind[result.proposal.kind] += 1
    }
  }

  return { total: names.length, byKind, errors, warnings, proposals }
}

/** 落地一条提案（显式的人工动作）：写入译文文件，返回落盘路径 */
export async function applyProposal(
  proposal: ProposalDraft,
  options: { readonly docsDir: string; readonly force: boolean }
): Promise<string> {
  if (proposal.content === undefined) {
    throw new Error(`提案 ${proposal.id} 没有 content（faq / glossary 需人工落地）`)
  }
  const target = path.resolve(options.docsDir, `${proposal.target.slug}.mdx`)
  if (existsSync(target) && !options.force) {
    throw new Error(`目标已存在：${target}（确要覆盖请加 --force）`)
  }
  await mkdir(path.dirname(target), { recursive: true })
  const body = proposal.content.endsWith("\n") ? proposal.content : `${proposal.content}\n`
  await writeFile(target, body, "utf8")
  return target
}
