/**
 * 生态榜：判定一个 GitHub 仓库「是不是用 Effect 写的」，以及「用到了 Effect 的哪些能力」。
 *
 * 这里全是**纯函数**（零 I/O、零网络），网络采集在 `ecosystem-collect.ts`，CI 门禁只读产物。
 * 这么切分的原因和 `packages/knowledge` 一样：判据必须能被测试钉住。
 *
 * 为什么不用「README/描述里提到 Effect」当判据：
 * 实测（781 个 TypeScript + >1000★ + AI 关键词的候选仓库）里，只有 24 个真的依赖 effect。
 * 按印象收录会同时犯两类错 ——
 *   · 假阳性：`colinhacks/zod`（43,930★）只是把 Effect 当 benchmark 对手（devDependencies
 *     且路径在 `packages/bench/`）；`vercel/ai` 只在 `examples/` 里用。
 *   · 假阴性：`sst/sst`（26,290★）195 个 package.json 里一个都不依赖 effect。
 * 所以判据只有一个：**package.json 里有没有 `effect` / `@effect/*`**。
 */

// ── 依赖判据 ────────────────────────────────────────────────────────────────

const EFFECT_PKG = /^(effect|@effect\/[a-z0-9-]+)$/

/**
 * 「边角路径」：这些目录里的依赖不能证明项目主体用 Effect。
 * 典型反例都是在这一层被抓出来的 —— zod 的 `packages/bench/`、vercel/ai 的 `examples/`、
 * cloudflare/agents 的 `site/`（文档示例）。
 */
const INCIDENTAL_PATH =
  /(^|\/)(bench|benchmarks?|examples?|docs?|site|website|fixtures?|__tests__|tests?|e2e|demos?|playground|samples?|templates?|starters?)(\/|$)/i

export interface EffectDeps {
  readonly runtime: readonly string[]
  readonly dev: readonly string[]
}

export interface PackageObservation {
  /** 仓库内相对路径，例如 `packages/core/package.json` */
  readonly path: string
  /** `dependencies` + `peerDependencies` 里的 effect 系包 */
  readonly runtime: readonly string[]
  /** 只在 `devDependencies` 里出现的 effect 系包 */
  readonly dev: readonly string[]
}

export type CentralityVerdict = "core" | "partial" | "incidental"

export interface Centrality {
  /** 仓库里 package.json 总数 */
  readonly totalPackages: number
  /** 主体（非边角路径）且运行时依赖 effect 的包 */
  readonly runtimePackages: readonly string[]
  /** 仅 devDependencies 依赖 effect 的包 */
  readonly devOnlyPackages: readonly string[]
  /** 命中但落在边角路径的包 */
  readonly incidentalPackages: readonly string[]
  /** 0–1：主体包中依赖 effect 的比例，页面上叫「Effect 渗透度」 */
  readonly ratio: number
  readonly verdict: CentralityVerdict
}

/** 从一段 package.json 文本里抽出 effect 系依赖。解析失败返回 undefined（不抛）。 */
export function extractEffectDeps(pkgJsonText: string): EffectDeps | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(pkgJsonText)
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const pkg = parsed as Record<string, unknown>
  const pick = (field: string): string[] => {
    const value = pkg[field]
    if (typeof value !== "object" || value === null) return []
    return Object.keys(value as Record<string, unknown>)
      .filter((name) => EFFECT_PKG.test(name))
      .sort()
  }
  const runtime = [...new Set([...pick("dependencies"), ...pick("peerDependencies")])].sort()
  const dev = pick("devDependencies").filter((name) => !runtime.includes(name))
  return { runtime, dev }
}

/** 路径是否属于「边角」（bench / examples / docs …）。 */
export function isIncidentalPath(pkgPath: string): boolean {
  return INCIDENTAL_PATH.test(pkgPath)
}

/**
 * 中心度：Effect 在这个项目里是骨架还是边角。
 *
 * 判 `incidental` 的条件是**主体包里一个运行时依赖都没有** —— 只有 devDependencies
 * 或只出现在 bench/examples 的一律出局（zod / vercel-ai / open-seo / sandcastle 都是这样被筛掉的）。
 */
export function summarizeCentrality(totalPackages: number, observations: readonly PackageObservation[]): Centrality {
  const runtimePackages: string[] = []
  const devOnlyPackages: string[] = []
  const incidentalPackages: string[] = []
  for (const o of observations) {
    const incidental = isIncidentalPath(o.path)
    if (o.runtime.length > 0) {
      if (incidental) incidentalPackages.push(o.path)
      else runtimePackages.push(o.path)
    } else if (o.dev.length > 0) {
      devOnlyPackages.push(o.path)
    }
  }
  const total = Math.max(totalPackages, observations.length, 1)
  const ratio = Number((runtimePackages.length / total).toFixed(3))
  const verdict: CentralityVerdict =
    runtimePackages.length === 0 ? "incidental" : runtimePackages.length >= 3 || ratio >= 0.25 ? "core" : "partial"
  return {
    totalPackages: total,
    runtimePackages: runtimePackages.sort(),
    devOnlyPackages: devOnlyPackages.sort(),
    incidentalPackages: incidentalPackages.sort(),
    ratio,
    verdict
  }
}

// ── 能力证据 ────────────────────────────────────────────────────────────────

export interface Capability {
  readonly id: string
  readonly label: string
  /** 命中即认为用到了该能力 */
  readonly patterns: readonly RegExp[]
}

/**
 * Effect 能力清单。
 *
 * 只在**确实 import 了 effect 的文件**里统计（见 `fileUsesEffect`），
 * 否则 `Stream.` / `Schema.` 这类短前缀会撞上同名第三方库。
 */
export const CAPABILITIES: readonly Capability[] = [
  { id: "gen", label: "Effect.gen 组合", patterns: [/\bEffect\s*\.\s*(gen|flatMap|map|all|forEach|zip|tryPromise)\b/] },
  { id: "service", label: "服务与依赖注入", patterns: [/\bContext\s*\.\s*(Tag|GenericTag|Reference)\b/, /\bEffect\s*\.\s*Service\b/, /\bLayer\s*\.\s*(succeed|effect|scoped|merge|provide|mock|empty|unwrapScoped)\b/] },
  { id: "error", label: "类型化错误", patterns: [/\bSchema\s*\.\s*TaggedError\b/, /\bData\s*\.\s*TaggedError\b/, /\bEffect\s*\.\s*(catchTag|catchTags|catchAll|catchIf|orElse)\b/] },
  { id: "concurrency", label: "Fiber 与并发", patterns: [/\bEffect\s*\.\s*(fork|forkScoped|forkDaemon|race|raceAll|timeout)\b/, /\bFiber\s*\./] },
  { id: "primitives", label: "并发原语", patterns: [/\b(Queue|PubSub|Ref|SynchronizedRef|Deferred|Semaphore|STM)\s*\./] },
  { id: "stream", label: "Stream 流处理", patterns: [/\bStream\s*\./, /\bSink\s*\./, /\bChannel\s*\./] },
  { id: "schema", label: "Schema 校验", patterns: [/\bSchema\s*\./, /@effect\/schema/] },
  { id: "resource", label: "Scope 资源管理", patterns: [/\bEffect\s*\.\s*(acquireRelease|acquireReleaseWith|scoped|addFinalizer)\b/, /\bScope\s*\./] },
  { id: "config", label: "Config 配置", patterns: [/\bConfig\s*\./, /\bEffect\s*\.\s*config\b/] },
  { id: "platform", label: "@effect/platform", patterns: [/@effect\/platform/] },
  { id: "httpapi", label: "HttpApi 声明式接口", patterns: [/\bHttpApi\b/, /\bHttpApiBuilder\b/, /\bHttpApiGroup\b/] },
  { id: "sql", label: "@effect/sql 数据库", patterns: [/@effect\/sql/] },
  { id: "ai", label: "@effect/ai", patterns: [/@effect\/ai/] },
  { id: "observability", label: "可观测性", patterns: [/@effect\/opentelemetry/, /\bEffect\s*\.\s*(withSpan|annotateCurrentSpan|logDebug|logInfo)\b/, /\bMetric\s*\./] },
  { id: "cluster", label: "集群与工作流", patterns: [/@effect\/cluster/, /@effect\/workflow/, /\bWorkflow\b/] },
  { id: "cli", label: "命令行应用", patterns: [/@effect\/cli/] }
]

/** 该文件是否真的 import 了 effect —— 能力统计的前置条件。 */
export function fileUsesEffect(source: string): boolean {
  // 子路径要允许大写：`import * as Layer from "effect/Layer"` 是常见写法
  return /from\s+["'](effect|effect\/[A-Za-z0-9/_-]+|@effect\/[A-Za-z0-9/_-]+)["']/.test(source)
}

export interface FileEvidence {
  /** 仓库内相对路径 */
  readonly path: string
  readonly capabilities: readonly string[]
  /** 能力命中的总次数（越密越适合当「该读这里」的入口） */
  readonly hits: number
}

/** 扫描单个源文件，返回它用到的能力与命中次数。非 Effect 文件返回 undefined。 */
export function scanFile(path: string, source: string): FileEvidence | undefined {
  if (!fileUsesEffect(source)) return undefined
  const capabilities: string[] = []
  let hits = 0
  for (const cap of CAPABILITIES) {
    let matched = false
    for (const pattern of cap.patterns) {
      const found = source.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"))
      if (found !== null && found.length > 0) {
        matched = true
        hits += found.length
      }
    }
    if (matched) capabilities.push(cap.id)
  }
  return capabilities.length > 0 ? { path, capabilities, hits } : undefined
}

export interface CapabilitySummary {
  /** 能力 id → 出现该能力的文件数 */
  readonly counts: Readonly<Record<string, number>>
  readonly present: readonly string[]
  /** 按「能力命中密度」排序的入口文件（供人工写「该读这里」时取材） */
  readonly topFiles: readonly FileEvidence[]
}

/**
 * 测试文件（含 __tests__ / *.test.ts / *.spec.ts）。
 *
 * 它们**照样计入能力统计**（有测试说明这项能力真被用起来了），
 * 但排序时要沉底：opencode 的榜首一度全是 `*.test.ts`，而「该读这里」推荐测试文件是误导。
 */
export function isTestPath(filePath: string): boolean {
  return /(^|\/)(__tests__|tests?|e2e)(\/|$)|[._-](test|spec)\.[cm]?tsx?$/.test(filePath)
}

/** 汇总一个仓库的全部文件证据。 */
export function summarizeCapabilities(files: readonly FileEvidence[], topN = 8): CapabilitySummary {
  const counts: Record<string, number> = {}
  for (const f of files) for (const c of f.capabilities) counts[c] = (counts[c] ?? 0) + 1
  const present = CAPABILITIES.map((c) => c.id).filter((id) => (counts[id] ?? 0) > 0)
  const topFiles = [...files]
    .sort(
      (a, b) =>
        Number(isTestPath(a.path)) - Number(isTestPath(b.path)) ||
        b.hits - a.hits ||
        b.capabilities.length - a.capabilities.length ||
        a.path.localeCompare(b.path)
    )
    .slice(0, topN)
  return { counts, present, topFiles }
}

// ── 收录判据与门禁 ──────────────────────────────────────────────────────────

/** 主线门槛：star 达到此值进「主线」，否则进「精选」。 */
export const MAINLINE_STARS = 1000

export const CATEGORIES = ["coding-agent", "agent-framework", "llm-app", "llm-infra", "workflow", "rag-mcp", "other"] as const
export type Category = (typeof CATEGORIES)[number]

export const LEVELS = ["入门", "进阶", "硬核"] as const
export type Level = (typeof LEVELS)[number]

export interface ReadingHint {
  /** 仓库内相对路径；门禁只校验形态，真实存在性由定期巡检核对 */
  readonly path: string
  /** 一句话：读这里能看到什么 */
  readonly why: string
}

export interface EcosystemEntry {
  readonly repo: string
  readonly stars: number
  /** 数据快照日期（YYYY-MM-DD）；star 是会腐烂的数据，不假装实时 */
  readonly checkedAt: string
  readonly category: Category
  readonly level: Level
  readonly homepage?: string
  /** 一句话中文定位 */
  readonly summary: string
  readonly centrality: {
    readonly ratio: number
    readonly verdict: CentralityVerdict
    readonly runtimePackages: readonly string[]
    readonly totalPackages: number
  }
  readonly deps: readonly string[]
  readonly capabilities: readonly string[]
  /** 证据强度：扫描了多少 .ts，其中多少真的 import 了 effect */
  readonly evidence: { readonly scannedFiles: number; readonly effectFiles: number }
  readonly reading: readonly ReadingHint[]
  /** 采集渠道，用于说明「为什么它在榜上」 */
  readonly via: readonly string[]
  /** 与榜单内其它条目同源（例如 opencode 的衍生版）；不标注会让榜单看着比实际更多样 */
  readonly lineage?: string
}

export interface EcosystemFile {
  readonly generatedAt: string
  readonly method: string
  readonly mainlineStars: number
  /**
   * 能力 / 分类的中文标签随产物一起下发。
   * 站点因此不需要复制一份映射表 —— 复制出来的那份一定会和判据漂移。
   */
  readonly labels: {
    readonly capabilities: Readonly<Record<string, string>>
    readonly categories: Readonly<Record<Category, string>>
  }
  readonly entries: readonly EcosystemEntry[]
}

export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  "coding-agent": "编码 Agent",
  "agent-framework": "Agent 框架与编排",
  "llm-app": "LLM 应用",
  "llm-infra": "LLM 基建（可观测 / 评测 / 网关）",
  workflow: "工作流与自动化",
  "rag-mcp": "检索与 MCP",
  other: "其它"
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 榜单诚实性门禁（离线、确定性）。
 *
 * 刻意**不查网络**：CI 每次 push 都打 GitHub 会让门禁又慢又脆。
 * 这里只保证「产物自身没有撒谎」：
 *   · 每条都必须有运行时依赖 effect 的包（不许收边角依赖的项目）；
 *   · 主线/精选分层必须与 star 门槛一致；
 *   · 分类与难度必须是白名单内的值；
 *   · 「该读这里」必须写出为什么，且路径形态合法；
 *   · 不许重复收录、不许只写空话。
 * 「条目是否已经腐烂」（仓库没了 / 不再依赖 effect / star 掉下门槛）由每日巡检负责 ——
 * 那是会随时间变化的事实，属于同步问题，不属于构建门禁。
 */
export function validateEcosystem(file: EcosystemFile): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  if (file.entries.length === 0) problems.push("榜单为空")
  for (const e of file.entries) {
    const at = (msg: string) => problems.push(`${e.repo || "<缺 repo>"}: ${msg}`)
    if (!REPO_RE.test(e.repo)) at(`repo 形态非法（应为 owner/name）：${e.repo}`)
    if (seen.has(e.repo.toLowerCase())) at("重复收录")
    seen.add(e.repo.toLowerCase())
    if (!Number.isInteger(e.stars) || e.stars <= 0) at(`star 数非法：${e.stars}`)
    if (!DATE_RE.test(e.checkedAt)) at(`checkedAt 应为 YYYY-MM-DD：${e.checkedAt}`)
    if (e.centrality.runtimePackages.length === 0) at("没有任何运行时依赖 effect 的包（边角依赖不许进榜）")
    if (e.centrality.verdict === "incidental") at("中心度为 incidental 的项目不许进榜")
    if (Math.abs(e.centrality.ratio - Number((e.centrality.runtimePackages.length / e.centrality.totalPackages).toFixed(3))) > 0.001)
      at("centrality.ratio 与 runtimePackages/totalPackages 不一致")
    if (e.deps.length === 0) at("deps 为空")
    if (!e.deps.some((d) => EFFECT_PKG.test(d))) at("deps 里没有 effect 系包")
    if (!CATEGORIES.includes(e.category)) at(`分类不在白名单：${e.category}`)
    if (!LEVELS.includes(e.level)) at(`难度不在白名单：${e.level}`)
    if (e.summary.trim().length < 12) at("summary 太短（像占位符）")
    if (e.summary.trim().length > 160) at("summary 太长（超过 160 字）")
    if (e.reading.length === 0) at("没有「该读这里」")
    for (const r of e.reading) {
      if (r.path.startsWith("/") || /\s/.test(r.path)) at(`reading.path 形态非法：${r.path}`)
      if (r.why.trim().length < 8) at(`reading.why 太短：${r.path}`)
    }
    if (e.capabilities.length === 0) at("没有扫到任何 Effect 能力证据")
    // 声明了依赖 ≠ 真的在用：supermemory-mcp 在 dependencies 里写了 effect，
    // 但全仓没有一个文件 import 它。这种不许进榜。
    if (e.evidence.effectFiles < 1) at("声明了 effect 依赖，但全仓没有任何文件 import 它（声明≠使用）")
    if (e.evidence.effectFiles > e.evidence.scannedFiles) at("evidence.effectFiles 不可能大于 scannedFiles")
    for (const c of e.capabilities) if (!CAPABILITIES.some((x) => x.id === c)) at(`未知能力 id：${c}`)
    if (e.via.length === 0) at("没有记录采集渠道")
    // 难度标注的可疑组合：星数高 + 用 Effect 的文件很多，却标成「入门」。
    // 判据用 effectFiles（代码规模）而不是渗透度比例 —— ccmanager 只有 15 个 Effect 文件、
    // 渗透度 0.167，但确实是最适合第一次读的 Effect 项目之一，不该被这条拦下。
    if (e.stars >= file.mainlineStars && e.level === "入门" && e.evidence.effectFiles > 200)
      at("主线且规模不小，却标成「入门」，请复核难度")
  }
  return problems
}

export function capabilityLabel(id: string): string {
  return CAPABILITIES.find((c) => c.id === id)?.label ?? id
}

export function tierOf(entry: EcosystemEntry, mainlineStars = MAINLINE_STARS): "mainline" | "selected" {
  return entry.stars >= mainlineStars ? "mainline" : "selected"
}
