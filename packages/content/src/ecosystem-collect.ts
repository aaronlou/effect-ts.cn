/**
 * 生态榜采集器（网络侧）。
 *
 * 与 `ecosystem.ts`（纯判据）分离的原因：判据要能被测试钉死，网络必须可替换。
 *
 * 这里做三件事，且都留下可复核的痕迹：
 *   1. **多渠道发现** —— 实测证明单通道会漏：关键词扫描漏掉了 `rivet-dev/actors`(6,123★)、
 *      `AnswerOverflow`(2,013★)、`MapleTechLabs/maple`(1,772★)、`octanejs/octane`(1,383★)，
 *      这四个是靠「package.json 里出现 `@effect/ai`」这条依赖通道补出来的。
 *   2. **依赖验证** —— 把仓库里**所有** package.json 读出来判定。不看 README、不看印象
 *      （`sst/sst` 26,290★ 实测 195 个 package.json 里一个都不依赖 effect）。
 *   3. **能力证据** —— 下载 tarball 全仓扫描 `.ts`，只在真的 `import "effect"` 的文件里统计。
 *      全量而非抽样：抽样漏掉某个 API 会变成「这个项目没用 Stream」的错误结论。
 *
 * 产物是**观测**，不含任何中文点评 —— 点评是人的事（`ecosystem-annotations.json`），
 * 由 `ecosystem-build` 合并。机器负责事实，人负责解释。
 *
 * ── 关于配额（踩过的坑，别重犯）──────────────────────────────────────────────
 * 一次完整采集要发约 3600 次 API 调用（786 个候选 × 元数据 + 文件树 + 若干 package.json），
 * 而 GitHub 认证用户是 **5000 次/小时**。没有缓存时，跑第二遍就会把配额打爆，
 * 而 403 会被误读成「这个仓库不依赖 effect」——一次限流就伪装成一次成功的筛选。
 * 所以：**每一样 API 结果与 tarball 扫描结果都落磁盘缓存**，并有跑前预检与提前止损。
 */
import { execFile } from "node:child_process"
import type { Dirent } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import {
  type CapabilitySummary,
  type Centrality,
  type FileEvidence,
  type PackageObservation,
  extractEffectDeps,
  scanFile,
  summarizeCapabilities,
  summarizeCentrality
} from "./ecosystem.js"

const execFileAsync = promisify(execFile)
const API = "https://api.github.com"

/** 配额不足时抛出 —— 必须能让采集**提前停下并保留部分结果**，而不是一路 403 装成筛选成功。 */
export class RateLimitedError extends Error {
  constructor(
    readonly resetAt: Date | undefined,
    message: string
  ) {
    super(message)
    this.name = "RateLimitedError"
  }
}

// ── 磁盘缓存：key → string | null（null = 确认不存在）────────────────────────

export class FileCache {
  private readonly map = new Map<string, string | null>()
  private dirty = false

  constructor(private readonly file?: string) {}

  static async load(file: string | undefined): Promise<FileCache> {
    const cache = new FileCache(file)
    if (file === undefined) return cache
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, string | null>
      for (const [k, v] of Object.entries(raw)) cache.map.set(k, v)
    } catch {
      // 缓存不存在或损坏都可忽略：它只是加速手段
    }
    return cache
  }

  get(key: string): string | null | undefined {
    return this.map.get(key)
  }

  /**
   * 按「仓库 + 文件路径」查，**忽略 ref**。
   *
   * 血泪教训：缓存键里带了 ref（默认分支名），后来把 ref 改成 `HEAD` 之后，
   * 全部缓存瞬间失效 → 又去打了 100 多次 API → 撞上限流。
   * 我们读的一直是默认分支，ref 换写法不该让缓存作废。
   */
  getFile(repo: string, filePath: string): string | null | undefined {
    const direct = this.map.get(`file:${repo}:${filePath}`)
    if (direct !== undefined) return direct
    for (const [k, v] of this.map) {
      if (k.startsWith(`file:${repo}@`) && k.endsWith(`:${filePath}`)) return v
    }
    return undefined
  }

  set(key: string, value: string | null): void {
    this.map.set(key, value)
    this.dirty = true
  }

  get size(): number {
    return this.map.size
  }

  async save(): Promise<void> {
    if (this.file === undefined || !this.dirty) return
    await mkdir(path.dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(Object.fromEntries(this.map)))
    this.dirty = false
  }
}

function token(): string | undefined {
  return process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
}

function rateLimitFrom(res: Response): RateLimitedError | undefined {
  if (res.status !== 403 && res.status !== 429) return undefined
  if (res.headers.get("x-ratelimit-remaining") !== "0" && res.status !== 429) return undefined
  const reset = Number(res.headers.get("x-ratelimit-reset") ?? "0")
  const resetAt = reset > 0 ? new Date(reset * 1000) : undefined
  return new RateLimitedError(resetAt, `GitHub API 配额用尽${resetAt ? `，将于 ${resetAt.toLocaleString("zh-CN")} 重置` : ""}`)
}

/**
 * 带**超时**的 GitHub API 调用。
 *
 * 超时不是可选项：实测这台机器上 `api.github.com` 会间歇性挂起（`raw.githubusercontent.com`
 * 甚至整段 connect timeout）。`fetch` 默认不超时，一个挂死的连接会让 `Promise.all` 永远等下去。
 */
async function gh(pathname: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "ecn-ecosystem-collector",
    ...((init.headers as Record<string, string>) ?? {})
  }
  const t = token()
  if (t !== undefined) headers.authorization = `Bearer ${t}`
  let res: Response
  try {
    res = await fetch(`${API}${pathname}`, { ...init, headers, signal: AbortSignal.timeout(25000) })
  } catch (error) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      return gh(pathname, init, attempt + 1)
    }
    throw new Error(
      `GitHub API 无响应（重试 ${attempt} 次）：${pathname} —— ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const limited = rateLimitFrom(res)
  if (limited !== undefined) {
    // 配额用尽不是「重试能好」的错：多试一次就多浪费一次，直接上抛让调用方止损
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 2000))
      return gh(pathname, init, attempt + 1)
    }
    throw limited
  }
  if (res.status >= 500 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    return gh(pathname, init, attempt + 1)
  }
  return res
}

/**
 * 用**搜索接口**取 star 数（独立配额，和核心接口不共享 5000/小时）。
 *
 * 存在的意义：核心接口被限流时，元数据拿不到，但「这个仓库多少 star」不能因此丢 ——
 * 榜单分层完全依赖它。搜索接口的配额此时通常还是满的。
 */
export async function searchStars(repo: string): Promise<number | undefined> {
  const q = encodeURIComponent(`repo:${repo}`)
  const res = await gh(`/search/repositories?q=${q}&per_page=1`)
  if (!res.ok) return undefined
  const body = (await res.json()) as { items?: Array<{ stargazers_count: number }> }
  return body.items?.[0]?.stargazers_count
}

/** 跑前预检：配额不够就别开始（免得跑一半 403，把限流伪装成筛选结果）。 */
export async function checkQuota(needed: number): Promise<{ ok: boolean; remaining: number; resetAt?: Date }> {
  const res = await gh("/rate_limit")
  if (!res.ok) return { ok: true, remaining: Number.NaN }
  const body = (await res.json()) as { resources: { core: { remaining: number; reset: number } } }
  const core = body.resources.core
  return { ok: core.remaining >= needed, remaining: core.remaining, resetAt: core.reset > 0 ? new Date(core.reset * 1000) : undefined }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i]!, i)
    }
  })
  await Promise.all(workers)
  return out
}

function fetchText(url: string): Promise<string | undefined> {
  return fetch(url, { signal: AbortSignal.timeout(15000) })
    .then((res) => (res.ok ? res.text() : undefined))
    .catch(() => undefined)
}

// ── 带缓存的仓库读取器 ──────────────────────────────────────────────────────

export interface RepoMeta {
  readonly repo: string
  readonly stars: number
  readonly license: string | null
  readonly homepage: string | null
  readonly pushedAt: string
  readonly defaultBranch: string
  readonly archived: boolean
}

export interface Fetcher {
  readonly cache: FileCache
  meta(repo: string): Promise<RepoMeta | undefined>
  /** 全仓文件路径；undefined = 读不到（网络/限流），与「仓库是空的」区分 */
  blobs(repo: string): Promise<string[] | undefined>
  file(repo: string, ref: string, filePath: string): Promise<string | null | undefined>
  stats(): { hits: number; misses: number }
}

/**
 * 每一类请求都过缓存。
 *
 * 缓存命中率直接决定这个采集器可不可用：首次全量约 3600 次调用，之后重跑几乎不发请求。
 */
export function createFetcher(cache: FileCache): Fetcher {
  let hits = 0
  let misses = 0

  const cached = async <T>(key: string, produce: () => Promise<T | undefined>): Promise<T | undefined> => {
    const hit = cache.get(key)
    if (hit !== undefined) {
      hits++
      return hit === null ? undefined : (JSON.parse(hit) as T)
    }
    misses++
    const value = await produce()
    if (value !== undefined) cache.set(key, JSON.stringify(value))
    return value
  }

  return {
    cache,
    stats: () => ({ hits, misses }),
    meta(repo) {
      return cached<RepoMeta>(`meta:${repo}`, async () => {
        const res = await gh(`/repos/${repo}`)
        if (!res.ok) return undefined
        const m = (await res.json()) as {
          stargazers_count: number
          license: { spdx_id?: string } | null
          homepage: string | null
          pushed_at: string
          default_branch?: string
          archived?: boolean
        }
        return {
          repo,
          stars: m.stargazers_count,
          license: m.license?.spdx_id ?? null,
          homepage: m.homepage,
          pushedAt: m.pushed_at,
          defaultBranch: m.default_branch ?? "HEAD",
          archived: m.archived === true
        }
      })
    },
    blobs(repo) {
      return cached<string[]>(`tree:${repo}`, async () => {
        const res = await gh(`/repos/${repo}/git/trees/HEAD?recursive=1`)
        if (!res.ok) return undefined
        const body = (await res.json()) as { tree?: Array<{ path: string; type: string }> }
        return (body.tree ?? [])
          .filter((t) => t.type === "blob")
          .map((t) => t.path)
          .sort()
      })
    },
    async file(repo, ref, filePath) {
      const key = `file:${repo}:${filePath}`
      const hit = cache.getFile(repo, filePath)
      if (hit !== undefined) {
        hits++
        return hit
      }
      misses++
      const res = await gh(
        `/repos/${repo}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`
      )
      if (res.ok) {
        const body = (await res.json()) as { content?: string }
        if (typeof body.content === "string") {
          const text = Buffer.from(body.content, "base64").toString("utf8")
          cache.set(key, text)
          return text
        }
      } else if (res.status === 404) {
        cache.set(key, null)
        return null
      }
      // 兜底：raw 域名有时可达，且不占 API 配额
      const raw = await fetchText(`https://raw.githubusercontent.com/${repo}/${ref}/${filePath}`)
      if (raw !== undefined) cache.set(key, raw)
      return raw
    }
  }
}

// ── 发现渠道 ────────────────────────────────────────────────────────────────

export interface Candidate {
  readonly repo: string
  readonly stars: number
  readonly via: readonly string[]
  readonly description?: string
}

/** 关键词扫描用的方向词。刻意覆盖 harness / 评测 / 推理 等容易被漏掉的说法。 */
export const AI_KEYWORDS = [
  "agent",
  "llm",
  "ai",
  "mcp",
  "rag",
  "gpt",
  "copilot",
  "chatbot",
  "harness",
  "inference",
  "embedding",
  "vector database",
  "prompt",
  "fine-tuning",
  "reinforcement learning",
  "coding assistant"
] as const

export async function discoverByKeywords(
  minStars: number,
  keywords: readonly string[] = AI_KEYWORDS
): Promise<Candidate[]> {
  const found = new Map<string, { stars: number; description?: string }>()
  for (const keyword of keywords) {
    // 只取第一页：查询按 star 降序，Effect 项目必在头部；两页会把候选池翻倍而收益极低
    for (const page of [1]) {
      const q = encodeURIComponent(`language:typescript stars:>${minStars} ${keyword} in:name,description,topics`)
      const res = await gh(`/search/repositories?q=${q}&sort=stars&order=desc&per_page=100&page=${page}`)
      if (!res.ok) break
      const body = (await res.json()) as {
        items?: Array<{ full_name: string; stargazers_count: number; description?: string }>
      }
      for (const item of body.items ?? []) {
        const prev = found.get(item.full_name)
        if (prev === undefined || prev.stars < item.stargazers_count)
          found.set(item.full_name, { stars: item.stargazers_count, description: item.description ?? undefined })
      }
      if ((body.items ?? []).length < 100) break
    }
  }
  return [...found.entries()].map(([repo, v]) => ({
    repo,
    stars: v.stars,
    via: ["keyword-sweep"],
    description: v.description
  }))
}

/**
 * 依赖反查：`package.json` 里出现某个 effect 系包。
 *
 * 代码搜索**按依赖名**比按关键词准得多 —— 命中的仓库一定在某个地方 import 了它。
 */
export async function discoverByDependency(pkg: string, minStars: number, fetcher: Fetcher): Promise<Candidate[]> {
  const q = encodeURIComponent(`"${pkg}" filename:package.json`)
  const res = await gh(`/search/code?q=${q}&per_page=100`)
  if (!res.ok) return []
  const body = (await res.json()) as { items?: Array<{ repository: { full_name: string } }> }
  const repos = [...new Set((body.items ?? []).map((i) => i.repository.full_name))]
  return (
    await mapLimit(repos, 4, async (repo): Promise<Candidate | undefined> => {
      const meta = await fetcher.meta(repo)
      if (meta === undefined || meta.archived || meta.stars < minStars) return undefined
      return { repo, stars: meta.stars, via: [`dep:${pkg}`] }
    })
  ).filter((c): c is Candidate => c !== undefined)
}

// ── 全仓扫描 ────────────────────────────────────────────────────────────────

const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.turbo|\.git|vendor)(\/|$)/

/**
 * 每个仓库最多读多少个 package.json。
 *
 * 这是**配额问题**，不是性能问题：实测 `deepseek-ai/deepseek-harness` 有 289 个 package.json，
 * 全读一遍就吃掉 289 次 API 调用（每小时只有 5000 次）。几个这种巨无霸就能把配额打爆。
 * 抽样会低估「Effect 渗透度」的分子，所以观测里记下 `packagesScanned` 并在页面上如实标注。
 */
const MAX_PACKAGES_PER_REPO = 24

/** 抽样顺序：先看主体包（packages/ apps/ src/），边角路径与深层目录排后面。 */
function prioritizePackages(paths: readonly string[]): string[] {
  const score = (p: string): number => {
    let s = 0
    if (/(^|\/)(packages|apps|crates|libs|modules)\//.test(p)) s -= 20
    if (isIncidental(p)) s += 100
    s += p.split("/").length // 浅的优先
    return s
  }
  return [...paths].sort((a, b) => score(a) - score(b) || a.localeCompare(b))
}

function isIncidental(p: string): boolean {
  return /(^|\/)(bench|benchmarks?|examples?|docs?|site|website|fixtures?|__tests__|tests?|e2e|demos?|playground|samples?|templates?|starters?)(\/|$)/i.test(p)
}
const MAX_FILE_BYTES = 400 * 1024

interface ScanResult {
  readonly files: FileEvidence[]
  readonly scanned: number
  readonly bytes: number
  /** 从 tarball 里读到的全部 package.json（路径 → 内容）。tarball 不吃 API 配额，
   *  所以对「值得细看的仓库」用它能拿到**完整**依赖清单，而不是 API 抽样。 */
  readonly packages: Readonly<Record<string, string>>
  readonly error?: string
}

/**
 * 识别「仓库里塞了一份 Effect 源码」。
 *
 * 实测踩到：`maple` / `foldkit` / `hazel` / `lalph` 的仓库里各带一份 Effect（`.context/effect/`、
 * `repos/effect/`），于是 `Stream.ts`、`Metric.ts` 这些**库自己的文件**被当成"这个项目的用法"统计，
 * 能力数字被严重放大（foldkit 的 1432 个"effect 文件"里大部分是库本身）。
 *
 * 判据：某个 package.json 的 `name` 恰好是 `effect`，就说明那一支是 Effect 自身；
 * 把它所在的 `…/packages/effect` 之前的前缀当作 vendor 根，整支排除。
 * 如果前缀为空，说明**这个仓库本身就是 Effect**（effect-smol），单独标记，不进榜。
 */
export function detectVendoredEffect(packages: Readonly<Record<string, string>>): {
  roots: readonly string[]
  isEffectLibrary: boolean
} {
  const roots = new Set<string>()
  let isEffectLibrary = false
  for (const [p, text] of Object.entries(packages)) {
    let name: unknown
    try {
      name = (JSON.parse(text) as { name?: unknown }).name
    } catch {
      continue
    }
    if (name !== "effect") continue
    const marker = "packages/effect/package.json"
    const index = p.endsWith(marker) ? p.length - marker.length : -1
    if (index < 0) continue
    const root = p.slice(0, index).replace(/\/$/, "")
    if (root === "") isEffectLibrary = true
    else roots.add(`${root}/`)
  }
  return { roots: [...roots].sort(), isEffectLibrary }
}

async function walkAll(dir: string, match: (rel: string, name: string) => boolean): Promise<string[]> {
  const out: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      const rel = path.relative(dir, full)
      if (SKIP_DIR.test(rel)) continue
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && match(rel, entry.name)) out.push(full)
    }
  }
  return out.sort()
}

async function scanTarball(repo: string, attempt = 0): Promise<ScanResult> {
  const work = await mkdtemp(path.join(tmpdir(), "ecn-eco-"))
  const archive = path.join(work, "repo.tgz")
  try {
    const res = await fetch(`https://codeload.github.com/${repo}/tar.gz/HEAD`, { signal: AbortSignal.timeout(300000) })
    if (!res.ok) return { files: [], scanned: 0, bytes: 0, packages: {}, error: `tarball HTTP ${res.status}` }
    const buffer = Buffer.from(await res.arrayBuffer())
    await writeFile(archive, buffer)
    // 不能用 GNU tar 的 `--one-top-level`（macOS 的 bsdtar 不支持，会静默不生效）：
    // 显式建目录再解压，扫描时统一剥掉 GitHub tarball 自带的 `<repo>-HEAD/` 顶层目录。
    const extractDir = path.join(work, "src")
    await mkdir(extractDir, { recursive: true })
    await execFileAsync("tar", ["-xzf", archive, "-C", extractDir])
    // 剥掉 GitHub tarball 自带的 `<repo>-HEAD/` 顶层目录，路径才和仓库内相对路径一致
    const rel = (file: string): string => path.relative(extractDir, file).split(path.sep).slice(1).join("/")
    const tsFiles = await walkAll(extractDir, (_r, name) => /\.(ts|tsx|mts)$/.test(name) && !/\.d\.ts$/.test(name))
    const pkgFiles = await walkAll(extractDir, (_r, name) => name === "package.json")
    const packages: Record<string, string> = {}
    for (const file of pkgFiles) {
      try {
        packages[rel(file)] = await readFile(file, "utf8")
      } catch {
        continue
      }
    }
    const files: FileEvidence[] = []
    let scanned = 0
    for (const file of tsFiles) {
      try {
        const info = await stat(file)
        if (info.size > MAX_FILE_BYTES) continue
        const source = await readFile(file, "utf8")
        scanned++
        const evidence = scanFile(rel(file), source)
        if (evidence !== undefined) files.push(evidence)
      } catch {
        continue
      }
    }
    return { files, scanned, bytes: buffer.byteLength, packages }
  } catch (error) {
    // 静默吞掉会让「扫描 0 个文件」看起来像「这个项目没写 TS」——必须报出来。
    // 大仓库的 tarball 偶发超时，重试一次再放弃。
    if (attempt < 1) {
      await rm(work, { recursive: true, force: true })
      return scanTarball(repo, attempt + 1)
    }
    return { files: [], scanned: 0, bytes: 0, packages: {}, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

// ── 观测 ────────────────────────────────────────────────────────────────────

export interface RepoObservation {
  readonly repo: string
  readonly stars: number
  readonly license: string | null
  readonly homepage: string | null
  readonly pushedAt: string
  readonly totalPackages: number
  /** 实际读了多少个 package.json（≤ MAX_PACKAGES_PER_REPO）；小于 totalPackages 说明是抽样 */
  readonly packagesScanned: number
  readonly observations: readonly PackageObservation[]
  /** 有多少个 package.json 因为网络/限流没读到 —— 与「读了但不是 effect」严格区分 */
  readonly readFailures: number
  readonly centrality: Centrality
  /** 全仓运行时 effect 系依赖的并集 */
  readonly deps: readonly string[]
  /** 全仓扫描的 .ts 文件数 */
  readonly scannedFiles: number
  /** 其中真的 import 了 effect 的文件数 */
  readonly effectFiles: number
  /**
   * 真的 import 了 effect 的文件路径（仓库内相对路径）。
   * 「该读这里」的每条 path 都必须落在这个集合里或其子目录下 —— 由 build 强制核对。
   */
  readonly effectFilePaths: readonly string[]
  readonly capabilities: CapabilitySummary
  /** tarball 扫描失败时的原因；有值说明能力证据缺失，不能当成「没用这些能力」 */
  readonly scanError?: string
  readonly via: readonly string[]
  /** tarball 下载字节数；用于说明扫描是全覆盖还是被截断 */
  readonly tarballBytes: number
}

export interface ObservationFile {
  readonly collectedAt: string
  readonly channels: readonly string[]
  readonly candidateCount: number
  readonly observations: readonly RepoObservation[]
  /**
   * 依赖清单**没读到**的仓库（网络/限流）。
   * 单独列出而不是混进淘汰名单 —— 「未知」和「不依赖 effect」是两回事，
   * 混在一起会把一次网络故障伪装成一次成功的筛选。
   */
  readonly unreadable: readonly string[]
}

/**
 * 观测一个仓库。
 *
 * 策略（顺序很重要，直接决定配额够不够用）：
 *   1. **先用 API 做便宜的快速淘汰**：1 次文件树 + 少量 package.json。
 *      只有当「所有 package.json 都被读到、且一个都不依赖 effect」时才判定淘汰 ——
 *      否则可能把一个用 pnpm workspace 的 monorepo（根 package.json 干净）错杀。
 *   2. **值得细看的仓库改用 tarball**：下载一次，从里面读**完整**依赖清单 + 全仓扫描能力证据。
 *      tarball 走 codeload，**不消耗 API 配额**，所以这里既不抽样也不受 5000/小时限制。
 *
 * 实测：`deepseek-ai/deepseek-harness` 有 289 个 package.json，用 API 全读要 289 次调用；
 * 用 tarball 是 0 次。786 个候选里有几个这种巨无霸，就是它们把配额打爆的。
 */
export async function observeRepo(
  candidate: Candidate,
  fetcher: Fetcher,
  extraVia: readonly string[] = [],
  options: { readonly tarballOnly?: boolean } = {}
): Promise<RepoObservation | undefined> {
  // 定向跑（--repos）：已知要看哪些仓库，就不必用 API 做筛选，直接走 tarball。
  // 好处是完全不消耗 API 配额 —— 限流期间也能干活，也不会为了淘汰长尾而烧掉配额。
  const allPaths = options.tarballOnly === true ? undefined : await fetcher.blobs(candidate.repo).catch(() => undefined)
  const allPkgPaths = allPaths === undefined ? [] : allPaths.filter((p) => /(^|\/)package\.json$/.test(p))

  // 阶段 1：API 抽样
  let readFailures = 0
  let sampled: PackageObservation[] = []
  if (allPkgPaths.length > 0) {
    const sample = prioritizePackages(allPkgPaths).slice(0, MAX_PACKAGES_PER_REPO)
    sampled = (
      await mapLimit(sample, 6, async (p): Promise<PackageObservation | undefined> => {
        const text = await fetcher.file(candidate.repo, "HEAD", p).catch(() => undefined)
        if (text === undefined) {
          readFailures++
          return undefined
        }
        if (text === null) return undefined
        const deps = extractEffectDeps(text)
        if (deps === undefined || (deps.runtime.length === 0 && deps.dev.length === 0)) return undefined
        return { path: p, runtime: deps.runtime, dev: deps.dev }
      })
    ).filter((o): o is PackageObservation => o !== undefined)
  }

  // 只有「读全了、且全都不依赖 effect」才能便宜地淘汰（tarballOnly 模式没有抽样，跳过）
  const fullyRead =
    options.tarballOnly !== true && allPkgPaths.length > 0 && readFailures === 0 && allPkgPaths.length <= MAX_PACKAGES_PER_REPO
  if (fullyRead && sampled.length === 0) {
    const meta = await fetcher.meta(candidate.repo).catch(() => undefined)
    if (meta?.archived === true) return undefined
    return {
      repo: candidate.repo,
      stars: meta?.stars ?? candidate.stars,
      license: meta?.license ?? null,
      homepage: meta?.homepage ?? null,
      pushedAt: meta?.pushedAt ?? "unknown",
      totalPackages: allPkgPaths.length,
      packagesScanned: allPkgPaths.length,
      observations: [],
      readFailures: 0,
      centrality: summarizeCentrality(allPkgPaths.length, []),
      deps: [],
      scannedFiles: 0,
      effectFiles: 0,
      effectFilePaths: [],
      capabilities: { counts: {}, present: [], topFiles: [] },
      via: [...new Set([...candidate.via, ...extraVia])].sort(),
      tarballBytes: 0
    }
  }

  // 阶段 2：tarball（不占 API 配额）
  const meta = await fetcher.meta(candidate.repo).catch(() => undefined)
  if (meta?.archived === true) return undefined

  const scanKey = `scan2:${candidate.repo}@${meta?.pushedAt ?? "unknown"}`
  const cachedScan = fetcher.cache.get(scanKey)
  let scanFiles: FileEvidence[]
  let scanned: number
  let bytes: number
  let scanError: string | undefined
  let tarballPackages: Record<string, string>
  if (cachedScan !== undefined && cachedScan !== null) {
    const parsed = JSON.parse(cachedScan) as {
      files: FileEvidence[]
      scanned: number
      bytes: number
      packages: Record<string, string>
    }
    scanFiles = parsed.files
    scanned = parsed.scanned
    bytes = parsed.bytes
    tarballPackages = parsed.packages
  } else {
    const scan = await scanTarball(candidate.repo)
    scanFiles = scan.files
    scanned = scan.scanned
    bytes = scan.bytes
    scanError = scan.error
    tarballPackages = scan.packages
    if (scan.error === undefined) {
      fetcher.cache.set(scanKey, JSON.stringify({ files: scanFiles, scanned, bytes, packages: tarballPackages }))
      await fetcher.cache.save()
    }
  }

  // tarball 挂了 ⇒ 我们对这个仓库**一无所知**，必须记成「未知」。
  // 否则 summarizeCentrality(total=1, []) 会给出 incidental，把一次下载失败
  // 伪装成「这个项目不依赖 effect」—— eliza(19k★) 和 wa-automate(3.6k★) 就这样被误杀过一次。
  if (scanError !== undefined && Object.keys(tarballPackages).length === 0) {
    readFailures = Math.max(readFailures, 1)
  }

  // 剔除内置的 Effect 源码（否则统计的是库自己，不是这个项目）
  const vendored = detectVendoredEffect(tarballPackages)
  if (vendored.isEffectLibrary) return undefined
  const isVendored = (p: string): boolean => vendored.roots.some((root) => p.startsWith(root))
  if (vendored.roots.length > 0) {
    tarballPackages = Object.fromEntries(Object.entries(tarballPackages).filter(([p]) => !isVendored(p)))
    scanFiles = scanFiles.filter((f) => !isVendored(f.path))
  }

  // 用 tarball 里的完整依赖清单（不是 API 抽样）重新判定渗透度
  const tarballPkgPaths = Object.keys(tarballPackages).filter((p) => !SKIP_DIR.test(p))
  const observations: PackageObservation[] = []
  for (const [p, text] of Object.entries(tarballPackages)) {
    const deps = extractEffectDeps(text)
    if (deps === undefined || (deps.runtime.length === 0 && deps.dev.length === 0)) continue
    observations.push({ path: p, runtime: deps.runtime, dev: deps.dev })
  }
  const totalPackages = Math.max(tarballPkgPaths.length, allPkgPaths.length, observations.length, 1)
  const centrality = summarizeCentrality(totalPackages, observations)
  const deps = [...new Set(observations.flatMap((o) => o.runtime))].sort()
  const capabilities = summarizeCapabilities(scanFiles, 12)

  return {
    repo: candidate.repo,
    stars: meta?.stars ?? candidate.stars,
    license: meta?.license ?? null,
    homepage: meta?.homepage ?? null,
    pushedAt: meta?.pushedAt ?? "unknown",
    totalPackages,
    packagesScanned: Object.keys(tarballPackages).length,
    observations,
    readFailures,
    centrality,
    deps,
    scannedFiles: scanned,
    effectFiles: scanFiles.length,
    effectFilePaths: scanFiles.map((f) => f.path).sort().slice(0, 3000),
    capabilities,
    scanError,
    via: [...new Set([...candidate.via, ...extraVia])].sort(),
    tarballBytes: bytes
  }
}

// ── 编排 ────────────────────────────────────────────────────────────────────

export interface CollectOptions {
  readonly mainlineStars?: number
  readonly selectedFloor?: number
  readonly onlyRepos?: readonly string[]
  readonly keywords?: readonly string[]
  /** 缓存路径：采集要发几千个请求，重跑不该再发一遍 */
  readonly cacheFile?: string
  readonly log?: (message: string) => void
}

export async function collect(options: CollectOptions = {}): Promise<ObservationFile> {
  const mainlineStars = options.mainlineStars ?? 1000
  const selectedFloor = options.selectedFloor ?? 60
  const log = options.log ?? (() => {})
  const channels: string[] = []
  const cache = await FileCache.load(options.cacheFile)
  const fetcher = createFetcher(cache)

  const tarballOnlyRun = options.onlyRepos !== undefined && options.onlyRepos.length > 0
  const quota = tarballOnlyRun ? { ok: true, remaining: Number.NaN, resetAt: undefined } : await checkQuota(500)
  if (!quota.ok) {
    throw new RateLimitedError(
      quota.resetAt,
      `GitHub API 剩余配额只有 ${quota.remaining} 次，不足以完成采集。` +
        `${quota.resetAt ? `配额将于 ${quota.resetAt.toLocaleString("zh-CN")} 重置，` : ""}请稍后重跑 —— 缓存会保留已完成的观测。`
    )
  }
  if (!Number.isNaN(quota.remaining)) log(`API 配额剩余 ${quota.remaining} 次`)

  let candidates: Candidate[]
  if (options.onlyRepos !== undefined && options.onlyRepos.length > 0) {
    channels.push("explicit")
    candidates = (
      await mapLimit(
        [...options.onlyRepos],
        2,
        async (repo): Promise<Candidate | undefined> => {
          const meta = await fetcher.meta(repo).catch(() => undefined)
          if (meta !== undefined) return { repo, stars: meta.stars, via: ["explicit"] }
          const stars = await searchStars(repo).catch(() => undefined)
          log(`  ⚠ ${repo} 元数据不可得，改从搜索接口取 star${stars === undefined ? "（也失败，跳过）" : `：${stars}`}`)
          return stars === undefined ? undefined : { repo, stars, via: ["explicit"] }
        }
      )
    ).filter((c): c is Candidate => c !== undefined)
  } else {
    log("渠道 1/2：关键词扫描（主线）…")
    const byKeyword = await discoverByKeywords(mainlineStars, options.keywords)
    channels.push("keyword-sweep")
    log(`  → ${byKeyword.length} 个候选`)
    log("渠道 2/2：依赖反查 @effect/ai（含 <1000★ 的精选）…")
    const byDep = await discoverByDependency("@effect/ai", selectedFloor, fetcher)
    channels.push("dep:@effect/ai")
    log(`  → ${byDep.length} 个候选`)
    const merged = new Map<string, Candidate>()
    for (const c of [...byKeyword, ...byDep]) {
      const prev = merged.get(c.repo)
      merged.set(c.repo, prev === undefined ? c : { ...c, via: [...new Set([...prev.via, ...c.via])].sort() })
    }
    candidates = [...merged.values()].sort((a, b) => b.stars - a.stars)
  }

  const tarballOnly = options.onlyRepos !== undefined && options.onlyRepos.length > 0
  log(
    `共 ${candidates.length} 个候选，开始逐个验证依赖（这一步最慢，会下载 tarball 全仓扫描）…` +
      (tarballOnly ? "\n定向模式：跳过 API 筛选，直接扫 tarball（不消耗配额）" : "")
  )
  let done = 0
  const observed = await mapLimit(candidates, 4, async (c) => {
    const obs = await observeRepo(c, fetcher, [], { tarballOnly })
    done++
    const mark =
      obs === undefined
        ? "跳过（元数据不可得）"
        : obs.observations.length === 0 && obs.readFailures > 0
          ? `⚠ 依赖清单读不到（${obs.readFailures} 个）· 记为未知`
          : obs.centrality.verdict === "incidental"
            ? "边角依赖·淘汰"
            : obs.effectFiles === 0
              ? `⚠ 声明了 effect 但全仓无人 import（${obs.centrality.verdict}）· 淘汰`
              : `✔ ${obs.centrality.verdict} · ${obs.effectFiles} 个文件 import effect`
    log(`  [${done}/${candidates.length}] ${c.repo} (${c.stars}★) ${mark}`)
    return obs
  })
  await cache.save()

  const known = observed.filter((o): o is RepoObservation => o !== undefined)
  const unreadable = known
    .filter((o) => o.observations.length === 0 && o.readFailures > 0)
    .map((o) => o.repo)
    .sort()
  const observations = known
    .filter((o) => !(o.observations.length === 0 && o.readFailures > 0))
    .filter((o) => o.centrality.verdict !== "incidental")
    // 声明了依赖但全仓没有一个文件 import：不算「用 Effect 写的项目」
    .filter((o) => o.effectFiles > 0)
    .sort((a, b) => b.stars - a.stars)

  const stats = fetcher.stats()
  log(`缓存：命中 ${stats.hits} 次，实发 ${stats.misses} 次请求`)
  if (unreadable.length > 0)
    log(
      `⚠ ${unreadable.length} 个仓库的依赖清单读不到，已记为「未知」而非淘汰：${unreadable.slice(0, 5).join(", ")}${
        unreadable.length > 5 ? " …" : ""
      }`
    )
  return { collectedAt: new Date().toISOString(), channels, candidateCount: candidates.length, observations, unreadable }
}
