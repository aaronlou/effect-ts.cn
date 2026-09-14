/**
 * Agent 分类的编排：把候选池跑成一份**带证据**的分类结果。
 *
 * 取数策略与 effect-scan 一致（也是最省配额的那条路）：
 *   1. 每个仓库 **1 次** API 调用拿文件树（`fetcher.blobs`，带缓存）；
 *   2. manifest 走 **raw.githubusercontent**（不吃配额）⇒ 可以多读几个，不必抽样到只剩根目录；
 *   3. 分类本身是纯函数（`agent-classify.ts`），这里只负责取数与落盘。
 *
 * 证据强度分三档（methodology §4）：manifest（依赖清单）> paths（文件路径）> metadata（描述/topics）。
 * 报告里必须能说清每条结论是哪一档 —— 拿描述猜出来的 "agent" 和拿依赖清单判出来的
 * "agent" 不是一回事，混在一起报比例就是自欺。
 */
import { FileCache, createFetcher } from "@ecn/content"
import { classifyAgent, extractDependencyNames, type AgentClassification } from "./agent-classify.js"
import type { Candidate } from "./candidate.js"

/** 各语言的 manifest 文件名（识别「这个文件里有依赖清单」） */
const MANIFEST_PATTERN =
  /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|build\.gradle|build\.gradle\.kts|setup\.py|environment\.ya?ml|Pipfile)$/i

const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.turbo|\.git|vendor|third_party|\.venv|venv|site-packages)(\/|$)/

/** 每个仓库最多读几个 manifest：根目录优先，避免把 monorepo 的几十个全读一遍 */
const MAX_MANIFESTS = 12

export interface ClassifyOptions {
  readonly cacheFile: string
  readonly concurrency?: number
  readonly limit?: number
  readonly log?: (message: string) => void
}

export interface ClassifyResult {
  readonly classifiedAt: string
  readonly candidates: number
  readonly entries: ReadonlyArray<AgentClassification>
  readonly byVerdict: Readonly<Record<AgentClassification["verdict"], number>>
  readonly byTier: Readonly<Record<AgentClassification["evidenceTier"], number>>
  readonly byType: Readonly<Record<string, number>>
  /** 文件树读不到的仓库 —— 单独列出，不能当成"不是 agent" */
  readonly unreadable: ReadonlyArray<string>
}

const prioritize = (paths: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...paths].sort((a, b) => {
    const depth = (p: string): number => p.split("/").length
    const rootFirst = depth(a) - depth(b)
    if (rootFirst !== 0) return rootFirst
    return a.localeCompare(b)
  })

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

export async function classifyAll(
  candidates: ReadonlyArray<Candidate>,
  options: ClassifyOptions
): Promise<ClassifyResult> {
  const log = options.log ?? (() => {})
  const cache = await FileCache.load(options.cacheFile)
  const fetcher = createFetcher(cache)
  const targets = options.limit !== undefined ? candidates.slice(0, options.limit) : candidates

  const rawFile = async (repo: string, path: string): Promise<string | null | undefined> => {
    const key = `raw:${repo}@HEAD:${path}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit === null ? undefined : hit
    try {
      const response = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${path}`, {
        signal: AbortSignal.timeout(20_000)
      })
      if (response.status === 404) {
        cache.set(key, null)
        return null
      }
      if (!response.ok) return undefined
      const text = await response.text()
      cache.set(key, text)
      return text
    } catch {
      return undefined
    }
  }

  const unreadable: Array<string> = []
  let done = 0

  const entries = await mapLimit(targets, options.concurrency ?? 8, async (candidate): Promise<AgentClassification> => {
    try {
      const paths = await fetcher.blobs(candidate.repo)
      if (paths === undefined) {
        unreadable.push(candidate.repo)
        return classifyAgent({
          repo: candidate.repo,
          description: candidate.description,
          topics: candidate.topics,
          dependencies: [],
          paths: []
        })
      }

      const manifests = prioritize(paths.filter((path) => MANIFEST_PATTERN.test(path) && !SKIP_DIR.test(path))).slice(
        0,
        MAX_MANIFESTS
      )

      const dependencies = new Set<string>()
      for (const manifest of manifests) {
        const text = await rawFile(candidate.repo, manifest)
        if (text === undefined || text === null) continue
        for (const name of extractDependencyNames(candidate.githubLanguage, text, manifest)) dependencies.add(name)
      }

      return classifyAgent({
        repo: candidate.repo,
        description: candidate.description,
        topics: candidate.topics,
        dependencies: [...dependencies],
        paths
      })
    } catch {
      unreadable.push(candidate.repo)
      return classifyAgent({
        repo: candidate.repo,
        description: candidate.description,
        topics: candidate.topics,
        dependencies: [],
        paths: []
      })
    } finally {
      done += 1
      if (done % 200 === 0) {
        log(`  已分类 ${done}/${targets.length}（缓存命中 ${fetcher.stats().hits}）`)
        await cache.save()
      }
    }
  })

  await cache.save()

  const byVerdict = { agent: 0, "not-agent": 0, uncertain: 0 } as Record<AgentClassification["verdict"], number>
  const byTier = { manifest: 0, paths: 0, metadata: 0, none: 0 } as Record<AgentClassification["evidenceTier"], number>
  const byType: Record<string, number> = {}
  for (const entry of entries) {
    byVerdict[entry.verdict] += 1
    byTier[entry.evidenceTier] += 1
    byType[entry.agentType] = (byType[entry.agentType] ?? 0) + 1
  }

  return {
    classifiedAt: new Date().toISOString(),
    candidates: entries.length,
    entries,
    byVerdict,
    byTier,
    byType,
    unreadable
  }
}
