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
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
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

export interface PackedProposal {
  readonly id: string
  /** 落盘的提案 JSON 绝对路径 */
  readonly file: string
  readonly upstreamPath: string
  readonly title: string
}

export interface SkippedDraft {
  readonly id: string
  readonly file: string
  readonly reason: string
}

export interface PackResult {
  readonly packed: ReadonlyArray<PackedProposal>
  readonly skipped: ReadonlyArray<SkippedDraft>
  readonly errors: ReadonlyArray<string>
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
export interface ProposalCheckOptions {
  /**
   * 是否检查"多条提案指向同一页"。
   *
   * 为什么要跨提案检查：单条提案的校验只看**它自己**，两条提案同时瞄准
   * `v4/schema/filters` 时各自都合法，但只可能有一条被合并 ——
   * 另一条会静静变成幽灵工作量。默认开启。
   */
  readonly checkDuplicateTargets?: boolean
}

export async function loadProposals(
  dir: string,
  context: ProposalContext,
  options: ProposalCheckOptions = {}
): Promise<ProposalCheckResult> {
  const checkDuplicateTargets = options.checkDuplicateTargets ?? true
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

  /** slug → 第一个声明它的提案（用于发现"两条提案抢同一页"） */
  const claimants = new Map<string, string>()
  for (const name of names) {
    const id = name.replace(/\.json$/, "")
    const raw = await readFile(path.join(proposalsDir, name), "utf8")
    const result = await validateProposal(id, raw, context)
    errors.push(...result.errors)
    warnings.push(...result.warnings)
    if (result.proposal !== undefined) {
      const slug = result.proposal.target.slug
      const owner = claimants.get(slug)
      if (checkDuplicateTargets && owner !== undefined) {
        errors.push({
          level: "error",
          message: `${id}: 与提案 ${owner} 指向同一页 ${slug} —— 只有一条会被合并，请先合并或删除多余的提案`
        })
      } else {
        claimants.set(slug, id)
      }
      proposals.push(result.proposal)
      byKind[result.proposal.kind] += 1
    }
  }

  return { total: names.length, byKind, errors, warnings, proposals }
}

/** 递归列出草稿目录下的 .mdx（跳过 `_` 前缀，与内容集合规则一致） */
async function listDraftFiles(dir: string): Promise<ReadonlyArray<string>> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: Array<string> = []
  for (const entry of entries) {
    if (entry.name.startsWith("_")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listDraftFiles(full)))
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      files.push(full)
    }
  }
  return files.sort()
}

/**
 * 把批量起草的暂存 MDX 打包成合规提案 JSON。
 *
 * 动机：手写 219 条 JSON 的转义（正文含引号、反引号、换行）必然出错；让机器做转义，
 * 人只写 MDX。打包完成后由 CLI 复用 `loadProposals` 再跑一遍闸门。
 *
 * 合约要点：
 * - `id = "translation-" + upstreamPath 去掉 .mdx、'/' 换成 '-'`，必须等于文件名；
 * - `target.slug` 仍**镜像 upstreamPath**（含 `/`）—— 这是校验器强制的契约，
 *   id 用的连字符 slug 只是文件名；
 * - `content` 是完整 MDX 原文（含 frontmatter），一字不改；
 * - 任一篇缺 `upstreamPath` / `upstreamCommit` ⇒ 报错且**不写出任何文件**（避免半批）。
 */
export async function packProposals(options: {
  readonly draftsDir: string
  readonly outDir: string
  /** 译文目录：用于跳过「目标页已落地」的草稿（避免把已发布的页面又打成提案） */
  readonly docsDir?: string
  readonly agent: string
  readonly model?: string
  readonly promptVersion: string
  readonly rationale?: string
  readonly force: boolean
}): Promise<PackResult> {
  const draftsDir = path.resolve(options.draftsDir)
  const outDir = path.resolve(options.outDir)
  const errors: Array<string> = []
  const packed: Array<PackedProposal> = []
  const skipped: Array<SkippedDraft> = []

  if (!existsSync(draftsDir)) {
    return { packed, skipped, errors: [`草稿目录不存在：${draftsDir}`] }
  }

  interface Plan {
    readonly id: string
    readonly file: string
    readonly upstreamPath: string
    readonly title: string
    readonly json: string
  }

  /**
   * 已落地的页面集合。
   *
   * 为什么必须在这里拦：打包是幂等操作，但如果把**已经落地**的草稿重新打成提案，
   * 队列里就会堆出一批「目标页已存在」的重复提案，`proposals:check` 随即整片报错
   * （真实发生过两次：81 条重复项把门禁顶红）。要更新已落地的页面请用 kind="stale-update"。
   */
  const landed = new Set<string>()
  if (options.docsDir !== undefined && existsSync(options.docsDir)) {
    for (const entry of await scanDocsDir(options.docsDir)) {
      landed.add(entry.file.replace(/\.mdx?$/, ""))
    }
  }

  const plans: Array<Plan> = []
  for (const draft of await listDraftFiles(draftsDir)) {
    const rel = path.relative(draftsDir, draft).split(path.sep).join("/")
    const raw = await readFile(draft, "utf8")
    const { frontmatter } = parseFrontmatter(raw)

    const upstreamPath = asString(frontmatter, "upstreamPath")
    const upstreamCommit = asString(frontmatter, "upstreamCommit")
    if (upstreamPath === undefined || upstreamPath.trim() === "") {
      errors.push(`${rel}: 缺少 frontmatter.upstreamPath（无法确定提案 id 与上游基线）`)
      continue
    }
    if (upstreamCommit === undefined || upstreamCommit.trim() === "") {
      errors.push(`${rel}: 缺少 frontmatter.upstreamCommit（翻译所对照的上游 commit）`)
      continue
    }

    const targetSlug = upstreamPath.replace(/\.mdx?$/, "")
    const id = `translation-${targetSlug.split("/").join("-")}`
    if (landed.has(targetSlug) && !options.force) {
      skipped.push({
        id,
        file: path.join(outDir, `${id}.json`),
        reason: "目标页已落地（已发布译文），不再打包；如需更新请用 kind=\"stale-update\""
      })
      continue
    }
    const title = asString(frontmatter, "title") ?? targetSlug
    const rationale =
      options.rationale ??
      `将上游文档 ${upstreamPath}（${title}）翻译为中文，纳入 effect-ts.cn 中文文档站。`

    const proposal: ProposalDraft = {
      id,
      kind: "translation",
      createdAt: new Date().toISOString(),
      draftedBy: {
        kind: "agent",
        name: options.agent,
        ...(options.model !== undefined ? { model: options.model } : {}),
        promptVersion: options.promptVersion
      },
      rationale,
      target: { slug: targetSlug, upstreamPath, upstreamCommit },
      content: raw
    }

    plans.push({
      id,
      file: path.join(outDir, `${id}.json`),
      upstreamPath,
      title,
      json: `${JSON.stringify(proposal, null, 2)}\n`
    })
  }

  if (errors.length > 0) {
    return { packed, skipped, errors }
  }

  await mkdir(outDir, { recursive: true })
  for (const plan of plans) {
    if (existsSync(plan.file) && !options.force) {
      skipped.push({ id: plan.id, file: plan.file, reason: "已存在同名提案（--force 可覆盖）" })
      continue
    }
    await writeFile(plan.file, plan.json, "utf8")
    packed.push({ id: plan.id, file: plan.file, upstreamPath: plan.upstreamPath, title: plan.title })
  }

  return { packed, skipped, errors }
}

/** 落地一条提案（显式的人工动作）：写入译文文件，返回落盘路径 */
/**
 * 清理「已落地」的提案（幂等）。
 *
 * 为什么需要：`proposals:apply` 把内容写进 content/docs 之后，提案 JSON 仍留在队列里，
 * 于是 `proposals:check` 会因「该页已有中文译文」整片报错 —— 队列看起来永远不干净。
 * 一个提案的生命周期应当是：起草 → 校验 → 落地 → **出队**。
 */
export async function pruneConsumedProposals(options: {
  readonly proposalsDir: string
  readonly docsDir: string
  readonly write: boolean
}): Promise<{ readonly consumed: ReadonlyArray<string>; readonly removed: ReadonlyArray<string> }> {
  const entries = await scanDocsDir(options.docsDir)
  const translated = new Set(entries.map((entry) => entry.file.replace(/\.mdx?$/, "")))
  const consumed: Array<string> = []
  const removed: Array<string> = []
  const names = (await readdir(options.proposalsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort()

  for (const name of names) {
    const file = path.join(options.proposalsDir, name)
    let parsed: { kind?: string; target?: { slug?: string } }
    try {
      parsed = JSON.parse(await readFile(file, "utf8")) as typeof parsed
    } catch {
      continue
    }
    // 只处理已落地的 translation（stale-update 的目标本来就已存在，不在清理范围）
    if (parsed.kind !== "translation") continue
    const slug = parsed.target?.slug
    if (typeof slug !== "string" || !translated.has(slug)) continue
    consumed.push(name.replace(/\.json$/, ""))
    if (options.write) {
      await rm(file, { force: true })
      removed.push(name.replace(/\.json$/, ""))
    }
  }
  return { consumed, removed }
}

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
