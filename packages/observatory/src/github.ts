/**
 * GitHub 访问层：**每一个响应都落盘**，且限流绝不伪装成"没有结果"。
 *
 * ── 为什么这么强调限流 ──────────────────────────────────────────────
 * 生态榜采集器踩过一次，写在 `packages/content/src/ecosystem-collect.ts` 的文件头：
 * 一次完整采集要 ~3600 次调用，而认证用户只有 **5000 次/小时**；
 * 没有缓存时跑第二遍就会打爆配额，而 **403 会被误读成「这个仓库不依赖 effect」** ——
 * 一次限流就此伪装成一次成功的筛选。
 *
 * 观测台的候选量级更大（跨语言、多关键词、逐月快照），所以三道闸门从第一天就要有：
 *   1. **磁盘缓存**：同一条 query 第二次跑零调用（也让"同样的查询得到同样的结果"可审计）；
 *   2. **跑前预检 + 提前止损**：剩余配额低于阈值就停，并如实报错；
 *   3. **错误即错误**：绝不把失败吞成空集 —— 空集会被写进 dataset。
 */
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

export interface GhResponse {
  readonly body: unknown
  readonly fromCache: boolean
}

export interface GitHubClientOptions {
  readonly cacheDir: string
  /**
   * search 请求之间的最小间隔（毫秒）：限额 30 次/分钟 ⇒ 默认 2300ms（≈26 次/分钟）。
   * **只对 `/search/*` 生效** —— core 是 5000 次/小时，用同一个间隔会把一次
   * 深度扫描从 3 分钟拖成 80 分钟（下一阶段要扫 1600 个仓库，这条差别很实在）。
   */
  readonly searchThrottleMs?: number
  /** core 请求之间的最小间隔（毫秒），默认 100ms（≈10 次/秒，远低于 5000/小时） */
  readonly coreThrottleMs?: number
  /** 每 N 次网络调用复核一次配额（`gh api rate_limit` 本身也计入 core） */
  readonly quotaCheckEvery?: number
  /** 配额恢复等待的上限（秒）。超过就放弃 —— 不让一次爬取把整天挂住 */
  readonly maxWaitSeconds?: number
  readonly sleep?: (ms: number) => Promise<void>
}

export interface RateLimitSnapshot {
  readonly core: { readonly limit: number; readonly remaining: number; readonly reset: number }
  readonly search: { readonly limit: number; readonly remaining: number; readonly reset: number }
  readonly codeSearch: { readonly limit: number; readonly remaining: number; readonly reset: number }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class GitHubClient {
  private readonly cacheDir: string
  private readonly searchThrottleMs: number
  private readonly coreThrottleMs: number
  private readonly quotaCheckEvery: number
  private readonly maxWaitMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private lastCallAt = 0
  private callsSinceQuotaCheck = 0
  private cacheHits = 0
  private networkCalls = 0
  private waits = 0

  constructor(options: GitHubClientOptions) {
    this.cacheDir = options.cacheDir
    // 30 次/分钟的限额下，2.3s 的间隔 ≈ 26 次/分钟 —— 留出余量，避免刚好踩线
    this.searchThrottleMs = options.searchThrottleMs ?? 2300
    this.coreThrottleMs = options.coreThrottleMs ?? 100
    this.quotaCheckEvery = options.quotaCheckEvery ?? 20
    this.maxWaitMs = (options.maxWaitSeconds ?? 90) * 1000
    this.sleep = options.sleep ?? defaultSleep
  }

  get stats(): { readonly cacheHits: number; readonly networkCalls: number; readonly waits: number } {
    return { cacheHits: this.cacheHits, networkCalls: this.networkCalls, waits: this.waits }
  }

  async rateLimit(): Promise<RateLimitSnapshot> {
    const { stdout } = await run("gh", ["api", "rate_limit"], { maxBuffer: 8 * 1024 * 1024 })
    const raw = JSON.parse(stdout) as {
      resources: {
        core: { limit: number; remaining: number; reset: number }
        search: { limit: number; remaining: number; reset: number }
        code_search: { limit: number; remaining: number; reset: number }
      }
    }
    return {
      core: raw.resources.core,
      search: raw.resources.search,
      codeSearch: raw.resources.code_search
    }
  }

  private cachePath(key: string): string {
    const digest = createHash("sha256").update(key).digest("hex").slice(0, 24)
    return path.join(this.cacheDir, `${digest}.json`)
  }

  /**
   * 配额闸门。
   *
   * 两类资源的性质完全不同，必须分开处理：
   * - `search` 是 **30 次/分钟** —— 用光不等于失败，等一分钟就回来了，
   *   所以"等到重置"是对的（一次爬取几百次调用，中间必然会撞到）。
   * - `core` 是 **5000 次/小时** —— 等一小时不该把爬取挂住，剩余不足就直接放弃并说清楚。
   *
   * 初版把两者混成"剩余 < 200 就停"，而 search 的天花板只有 30 ⇒ 永远无法开始（被这个坑绊了一次）。
   */
  private async ensureQuota(apiPath: string): Promise<void> {
    this.callsSinceQuotaCheck += 1
    if (this.callsSinceQuotaCheck < this.quotaCheckEvery) return
    this.callsSinceQuotaCheck = 0

    const limits = await this.rateLimit()
    const isSearch = apiPath.startsWith("/search/")
    const resource = isSearch ? limits.search : limits.core

    // 低于 10%（且至少 2 次）时才动作，避免频繁等待
    const floor = Math.max(2, Math.floor(resource.limit * 0.1))
    if (resource.remaining >= floor) return

    const waitMs = resource.reset * 1000 - Date.now() + 2000
    if (waitMs > 0 && waitMs <= this.maxWaitMs) {
      this.waits += 1
      await this.sleep(waitMs)
      return
    }

    throw new Error(
      `GitHub ${isSearch ? "search" : "core"} 配额不足（剩余 ${resource.remaining}/${resource.limit}，` +
        `重置还需 ${Math.max(0, Math.round((resource.reset * 1000 - Date.now()) / 1000))}s）—— 停止爬取。` +
        `已完成的部分已落缓存，稍后重跑即可零成本续上。`
    )
  }

  /**
   * 取一个 API 路径，命中缓存则零调用。
   *
   * `trim` 用于**只缓存需要的字段**：GitHub 的仓库对象很大（带 topics/license/urls…），
   * 100 条一页的响应约 500KB，几十次调用就能堆出上百 MB 缓存。
   * 先在写盘前裁掉，缓存体积与解析时间都降一个数量级。
   *
   * `useCache: false` 用于"必须拿最新数据"的场景（例如快照日当天重跑核心指标）。
   */
  async api<T>(
    apiPath: string,
    options: { readonly useCache?: boolean; readonly trim?: (body: unknown) => unknown } = {}
  ): Promise<GhResponse & { body: T }> {
    const useCache = options.useCache ?? true
    const cachePath = this.cachePath(apiPath)

    if (useCache) {
      try {
        const cached = JSON.parse(await readFile(cachePath, "utf8")) as { body: T }
        this.cacheHits += 1
        return { body: cached.body, fromCache: true }
      } catch {
        // 没缓存或读不动：走网络
      }
    }

    await this.ensureQuota(apiPath)

    const throttle = apiPath.startsWith("/search/") ? this.searchThrottleMs : this.coreThrottleMs
    const since = Date.now() - this.lastCallAt
    if (since < throttle) await this.sleep(throttle - since)

    this.networkCalls += 1
    this.lastCallAt = Date.now()

    let stdout: string
    try {
      const result = await run("gh", ["api", apiPath], { maxBuffer: 64 * 1024 * 1024 })
      stdout = result.stdout
    } catch (error) {
      // 关键：把失败**原样抛出**，绝不返回空集
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`GitHub API 失败：${apiPath}\n${message}`)
    }

    const body = JSON.parse(stdout) as T
    const cached = options.trim !== undefined ? options.trim(body) : body
    await mkdir(this.cacheDir, { recursive: true })
    await writeFile(cachePath, JSON.stringify({ path: apiPath, fetchedAt: new Date().toISOString(), body: cached }), "utf8")
    return { body: cached as T, fromCache: false }
  }
}
