/**
 * Effect 使用深度扫描（L0–L4）：回答"有多少 Agent 项目**真的**在用 Effect"。
 *
 * 复用生态榜采集器已经用真实数据校准过的判定与扫描（`packages/content`）：
 * `extractEffectDeps` / `summarizeCentrality` / `summarizeCapabilities` / `scanTarball` /
 * `detectVendoredEffect` —— 尤其是最后那个：实测有仓库在 `.context/effect/` 里塞了一份
 * Effect 源码，不剔除就会把**库自己的文件**当成"这个项目的用法"，能力数字被严重放大。
 *
 * ── 与生态榜的关键差异：取数策略 ──────────────────────────────────────────
 * 生态榜用 contents API 读 package.json（1 个文件 = 1 次 API 调用），所以只能抽样 24 个；
 * 观测台的候选池大一个数量级，而且**最高星的那批恰好是几百 MB 的 monorepo**。
 * 于是这里换了两处：
 *   1. **manifest 走 raw.githubusercontent**（不吃 API 配额）⇒ 可以**全读**所有 package.json，
 *      不再抽样，"没依赖 effect"因此是**确定结论**而不是采样推断；
 *   2. **tarball 只在出现 effect 信号时才下** —— 生态榜对"package.json 超过 24 个"的仓库
 *      一律下 tarball，实测 n8n / dify 这类仓库每个要几百 MB，1612 个候选会跑到天亮。
 *
 * 配额账：每个仓库 **1 次** API 调用（文件树），其余全部走 raw / codeload（0 配额）。
 */
import {
  FileCache,
  createFetcher,
  detectVendoredEffect,
  extractEffectDeps,
  scanTarball,
  summarizeCapabilities,
  summarizeCentrality,
  type FileEvidence,
  type PackageObservation
} from "@ecn/content"
import type { Candidate } from "./candidate.js"

/**
 * Effect 使用深度（methodology §5）。
 *
 * `unknown` 是**必须存在**的一档：扫描失败（网络/tarball 超时）绝不能落成 L0 ——
 * 那会把"没测到"写成"没用 Effect"。
 */
export type EffectDepth = "L0" | "L1" | "L2" | "L3" | "L4" | "unknown"

/**
 * 证据强度 —— 报告里必须能区分"我们全都读了"和"我们只读了抽样"。
 *
 * - `tarball`：下载全仓扫过（最强：依赖清单完整 + 逐文件确认真的 import 了）
 * - `manifest-full`：所有 package.json 都读到了，且都不依赖 effect（**确定**的 L0）
 * - `manifest-sampled`：只读到部分 manifest（网络失败），结论是推断
 * - `none`：什么都没读到（unknown）
 */
export type EvidenceLevel = "tarball" | "manifest-full" | "manifest-sampled" | "none"

export interface EffectScanEntry {
  readonly repo: string
  readonly stars: number
  readonly language: string | null
  readonly via: ReadonlyArray<string>
  readonly depth: EffectDepth
  readonly evidenceLevel: EvidenceLevel
  /** 仓库里 package.json 总数（判断"全读"还是"抽样"的依据） */
  readonly packageCount: number
  /** 读 manifest 时的失败次数；> 0 时结论降级为 sampled / unknown */
  readonly manifestFailures: number
  /** 全仓运行时 effect 系依赖的并集 */
  readonly deps: ReadonlyArray<string>
  readonly runtimePackages: ReadonlyArray<string>
  readonly centrality: "core" | "partial" | "incidental"
  readonly ratio: number
  readonly scannedFiles: number
  /** 真的 import 了 effect 的文件数 */
  readonly effectFiles: number
  /** 最值得读的文件（文件级证据） */
  readonly evidence: ReadonlyArray<string>
  readonly capabilities: ReadonlyArray<string>
  readonly usesAi: boolean
  readonly scanError?: string
}

export interface EffectScanResult {
  readonly scannedAt: string
  readonly candidates: number
  readonly entries: ReadonlyArray<EffectScanEntry>
  readonly byDepth: Readonly<Record<EffectDepth, number>>
  readonly byEvidence: Readonly<Record<EvidenceLevel, number>>
}

/**
 * 观测 → 深度分级（纯函数，可单测）。
 *
 * 规则与 methodology §5 对齐：
 * - L0 完全不接触 Effect（既无依赖，也无真实 import）
 * - L1 只在边角路径依赖（`incidental`）—— 拿 Effect 当性能对比基准、只写在 examples 里
 * - L2 部分业务逻辑用了（`partial`）
 * - L3 Effect 是重要架构组成（`core`）
 * - L4 core **且能力面足够宽**（≥4 项且含服务/依赖注入/资源/流）⇒ Effect 是 Runtime 的地基
 */
export function depthOf(observation: {
  readonly deps: ReadonlyArray<string>
  readonly effectFiles: number
  readonly centrality: { readonly verdict: "core" | "partial" | "incidental" }
  readonly capabilities: { readonly present: ReadonlyArray<string> }
}): EffectDepth {
  if (observation.deps.length === 0 && observation.effectFiles === 0) return "L0"
  if (observation.centrality.verdict === "incidental") return "L1"
  if (observation.centrality.verdict === "partial") return "L2"
  const present = new Set(observation.capabilities.present)
  const wide = present.size >= 4 && (present.has("service") || present.has("resource") || present.has("stream"))
  return wide ? "L4" : "L3"
}

/** 并发跑一批任务（不引依赖：十行够了） */
async function mapLimit<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<Array<R>> {
  const out: Array<R> = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      out[index] = await fn(items[index]!, index)
    }
  })
  await Promise.all(workers)
  return out
}

const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.turbo|\.git|vendor)(\/|$)/

/** 主体包优先：packages/ apps/ 排前面，边角路径排后面（读不到全部时的兜底顺序） */
const prioritizePackages = (paths: ReadonlyArray<string>): ReadonlyArray<string> => {
  const score = (p: string): number => {
    let value = 0
    if (/(^|\/)(packages|apps|crates|libs|modules)\//.test(p)) value -= 20
    if (/(^|\/)(bench|examples?|docs?|site|website|fixtures?|tests?|e2e|demos?)(\/|$)/i.test(p)) value += 30
    value += p.split("/").length
    return value
  }
  return [...paths].sort((a, b) => score(a) - score(b) || a.localeCompare(b))
}

export interface ScanOptions {
  readonly cacheFile: string
  readonly concurrency?: number
  readonly limit?: number
  readonly log?: (message: string) => void
}

const emptyByDepth = (): Record<EffectDepth, number> => ({ L0: 0, L1: 0, L2: 0, L3: 0, L4: 0, unknown: 0 })
const emptyByEvidence = (): Record<EvidenceLevel, number> => ({
  tarball: 0,
  "manifest-full": 0,
  "manifest-sampled": 0,
  none: 0
})

export async function scanEffect(
  candidates: ReadonlyArray<Candidate>,
  options: ScanOptions
): Promise<EffectScanResult> {
  const log = options.log ?? (() => {})
  const cache = await FileCache.load(options.cacheFile)
  const fetcher = createFetcher(cache)
  const targets = options.limit !== undefined ? candidates.slice(0, options.limit) : candidates

  /**
   * raw.githubusercontent：**不吃 API 配额**，所以可以全量读 manifest。
   *
   * 必须带重试：实测 8 路并发下 raw 会偶发失败（超时/429），
   * 而"某个 package.json 没读到"会被诚实地记成 `unknown` —— 于是 285 个仓库
   * （17.7%）变成了"不知道"，白白丢掉样本。重试比"更诚实地报告不知道"更有价值。
   */
  const rawFile = async (repo: string, ref: string, path: string): Promise<string | null | undefined> => {
    const key = `raw:${repo}@${ref}:${path}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit === null ? undefined : hit
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${path}`, {
          signal: AbortSignal.timeout(25_000)
        })
        if (response.status === 404) {
          cache.set(key, null)
          return null
        }
        if (response.ok) {
          const text = await response.text()
          cache.set(key, text)
          return text
        }
        // 429/5xx 值得等一等再试；其它状态码直接放弃（重试也不会变）
        if (response.status !== 429 && response.status < 500) return undefined
      } catch {
        // 超时/网络抖动：继续重试
      }
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)))
    }
    return undefined
  }

  /** tarball 深扫（带缓存的 scan2: 键，与生态榜共用同一份缓存格式） */
  const deepScan = async (
    repo: string,
    pushedAt: string
  ): Promise<{ files: FileEvidence[]; scanned: number; bytes: number; packages: Record<string, string>; error?: string }> => {
    const key = `scan2:${repo}@${pushedAt}`
    const cached = cache.get(key)
    if (cached !== undefined && cached !== null) {
      return JSON.parse(cached) as { files: FileEvidence[]; scanned: number; bytes: number; packages: Record<string, string> }
    }
    const scan = await scanTarball(repo)
    if (scan.error === undefined) {
      cache.set(key, JSON.stringify({ files: scan.files, scanned: scan.scanned, bytes: scan.bytes, packages: scan.packages }))
      await cache.save()
    }
    return scan
  }

  let done = 0
  const entries = await mapLimit(targets, options.concurrency ?? 6, async (candidate): Promise<EffectScanEntry> => {
    const base = {
      repo: candidate.repo,
      stars: candidate.stars,
      language: candidate.githubLanguage,
      via: candidate.via
    }
    const fail = (reason: string, extra: Partial<EffectScanEntry> = {}): EffectScanEntry => ({
      ...base,
      depth: "unknown",
      evidenceLevel: "none",
      packageCount: 0,
      manifestFailures: 1,
      deps: [],
      runtimePackages: [],
      centrality: "incidental",
      ratio: 0,
      scannedFiles: 0,
      effectFiles: 0,
      evidence: [],
      capabilities: [],
      usesAi: false,
      scanError: reason,
      ...extra
    })

    try {
      const paths = await fetcher.blobs(candidate.repo)
      if (paths === undefined) return fail("文件树读不到（网络/配额）—— 记为 unknown，不能当成没用 Effect")

      const allPkgPaths = paths.filter((p) => p.endsWith("package.json") && !SKIP_DIR.test(p))

      // 全量读 manifest（raw，无配额）。读不到的那几个单独计数。
      let manifestFailures = 0
      const observations: Array<PackageObservation> = []
      const missing = await mapLimit(prioritizePackages(allPkgPaths), 8, async (path): Promise<number> => {
        const text = await rawFile(candidate.repo, "HEAD", path)
        if (text === undefined) return 1
        if (text === null) return 0
        const deps = extractEffectDeps(text)
        if (deps === undefined || (deps.runtime.length === 0 && deps.dev.length === 0)) return 0
        observations.push({ path, runtime: deps.runtime, dev: deps.dev })
        return 0
      })
      manifestFailures += missing.reduce((sum, value) => sum + value, 0)

      // 没有任何 effect 信号
      if (observations.length === 0) {
        if (manifestFailures > 0) {
          // 回退 tarball（它从压缩包里读**全部** package.json，不依赖 raw）。
          // 只在"仓库不太大"时做 —— 几十个 package.json 的巨型 monorepo 下 tarball 是几百 MB，
          // 那种情况宁可如实记 unknown，也不要让一次采集跑到天亮。
          if (paths.length <= 5000) {
            const meta = await fetcher.meta(candidate.repo).catch(() => undefined)
            const scan = await deepScan(candidate.repo, meta?.pushedAt ?? "unknown")
            if (scan.error === undefined && Object.keys(scan.packages).length > 0) {
              const tarballObservations: Array<PackageObservation> = []
              for (const [path, text] of Object.entries(scan.packages)) {
                const deps = extractEffectDeps(text)
                if (deps === undefined || (deps.runtime.length === 0 && deps.dev.length === 0)) continue
                tarballObservations.push({ path, runtime: deps.runtime, dev: deps.dev })
              }
              if (tarballObservations.length === 0) {
                const centrality = summarizeCentrality(
                  Math.max(Object.keys(scan.packages).length, allPkgPaths.length, 1),
                  []
                )
                return {
                  ...base,
                  depth: "L0",
                  evidenceLevel: "tarball",
                  packageCount: centrality.totalPackages,
                  manifestFailures,
                  deps: [],
                  runtimePackages: [],
                  centrality: centrality.verdict,
                  ratio: 0,
                  scannedFiles: scan.scanned,
                  effectFiles: 0,
                  evidence: [],
                  capabilities: [],
                  usesAi: false
                }
              }
            }
          }
          return fail(`有 ${manifestFailures} 个 package.json 没读到，无法断言"不依赖 effect"`, {
            packageCount: allPkgPaths.length,
            manifestFailures
          })
        }
        return {
          ...base,
          depth: "L0",
          // manifest 全部读到且都没有 effect ⇒ 这是**确定**结论（evidenceLevel 见类型注释）
          evidenceLevel: "manifest-full",
          packageCount: allPkgPaths.length,
          manifestFailures: 0,
          deps: [],
          runtimePackages: [],
          centrality: summarizeCentrality(allPkgPaths.length, []).verdict,
          ratio: 0,
          scannedFiles: 0,
          effectFiles: 0,
          evidence: [],
          capabilities: [],
          usesAi: false
        }
      }

      // 有信号 ⇒ tarball 深扫（0 API 配额）
      const meta = await fetcher.meta(candidate.repo).catch(() => undefined)
      const scan = await deepScan(candidate.repo, meta?.pushedAt ?? "unknown")
      if (scan.error !== undefined && Object.keys(scan.packages).length === 0) {
        return fail(`tarball 扫描失败：${scan.error}`, { packageCount: allPkgPaths.length, manifestFailures })
      }

      // 剔除内置的 Effect 源码（否则统计的是库自己，不是这个项目）
      const vendored = detectVendoredEffect(scan.packages)
      if (vendored.isEffectLibrary) {
        return fail("这个仓库本身就是 effect（上游库本体）", { packageCount: allPkgPaths.length, manifestFailures })
      }
      const isVendored = (p: string): boolean => vendored.roots.some((root) => p.startsWith(root))
      const packages = vendored.roots.length > 0
        ? Object.fromEntries(Object.entries(scan.packages).filter(([p]) => !isVendored(p)))
        : scan.packages
      const files = vendored.roots.length > 0 ? scan.files.filter((f) => !isVendored(f.path)) : scan.files

      const tarballObservations: Array<PackageObservation> = []
      for (const [path, text] of Object.entries(packages)) {
        const deps = extractEffectDeps(text)
        if (deps === undefined || (deps.runtime.length === 0 && deps.dev.length === 0)) continue
        tarballObservations.push({ path, runtime: deps.runtime, dev: deps.dev })
      }
      const totalPackages = Math.max(
        Object.keys(packages).filter((p) => !SKIP_DIR.test(p)).length,
        allPkgPaths.length,
        tarballObservations.length,
        1
      )
      const centrality = summarizeCentrality(totalPackages, tarballObservations)
      const capabilities = summarizeCapabilities(files, 12)
      const deps = [...new Set(tarballObservations.flatMap((observation) => observation.runtime))].sort()
      const depth = depthOf({
        deps,
        effectFiles: files.length,
        centrality,
        capabilities
      })

      return {
        ...base,
        depth,
        evidenceLevel: "tarball",
        packageCount: totalPackages,
        manifestFailures,
        deps,
        runtimePackages: centrality.runtimePackages,
        centrality: centrality.verdict,
        ratio: centrality.ratio,
        scannedFiles: scan.scanned,
        effectFiles: files.length,
        evidence: files.map((file) => file.path).sort().slice(0, 10),
        capabilities: capabilities.present,
        usesAi: capabilities.present.includes("ai")
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    } finally {
      done += 1
      if (done % 100 === 0) {
        log(`  已扫 ${done}/${targets.length}（缓存命中 ${fetcher.stats().hits}）`)
        await cache.save()
      }
    }
  })

  await cache.save()

  const byDepth = emptyByDepth()
  const byEvidence = emptyByEvidence()
  for (const entry of entries) {
    byDepth[entry.depth] += 1
    byEvidence[entry.evidenceLevel] += 1
  }

  return {
    scannedAt: new Date().toISOString(),
    candidates: entries.length,
    entries: entries.sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo)),
    byDepth,
    byEvidence
  }
}
