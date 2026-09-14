/**
 * 快照：把一次发现的结果**冻结**成可引用、可逐月比较的产物。
 *
 * 计划 §36/§37 的两条硬要求在这里落地：
 * - **禁止覆盖旧数据** ⇒ 目录名带 `snapshot_date`，第二次跑同一天会拒绝覆盖（除非显式 `--force`）；
 * - **必须可复现** ⇒ 同目录下留下查询集、每次调用的 total_count、以及分类器/数据集版本号。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Candidate, SearchCall } from "./candidate.js"
import type { DiscoveryFrame, DiscoveryResult } from "./discover.js"

/** 数据集版本：口径变了就 +1（报告里必须写清用的是哪一版） */
export const DATASET_VERSION = "0.1"
export const CLASSIFIER_VERSION = "0.1"

export interface EcosystemSummary {
  readonly totalCandidates: number
  /** 按 GitHub 的 language 字段（**参考口径**，已知按字节占比、会误判 TS 为 JS） */
  readonly byGithubLanguage: ReadonlyArray<{ readonly language: string; readonly count: number }>
  /** TS 候选单独列出：只有它们需要深度扫描（Effect 是 TS 生态） */
  readonly typeScriptCandidates: number
  readonly stars: {
    readonly total: number
    readonly median: number
    readonly mean: number
    readonly p90: number
    readonly max: number
  }
  /** 近 90 天有 push（"活着"的粗判据） */
  readonly active90d: number
  readonly withLicense: number
  readonly archivedExcluded: number
  readonly forksExcluded: number
  readonly duplicateMerges: number
  readonly possibleDuplicateGroups: number
  readonly topTopics: ReadonlyArray<{ readonly topic: string; readonly count: number }>
}

const median = (sorted: ReadonlyArray<number>): number => {
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle]!
}

const percentile = (sorted: ReadonlyArray<number>, ratio: number): number => {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))
  return sorted[index]!
}

export function summarize(result: DiscoveryResult, now: Date = new Date()): EcosystemSummary {
  const candidates = result.candidates
  const stars = candidates.map((candidate) => candidate.stars).sort((a, b) => a - b)

  const languageCounts = new Map<string, number>()
  for (const candidate of candidates) {
    const key = candidate.githubLanguage ?? "(未知)"
    languageCounts.set(key, (languageCounts.get(key) ?? 0) + 1)
  }

  const topicCounts = new Map<string, number>()
  for (const candidate of candidates) {
    for (const topic of candidate.topics) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1)
  }

  const cutoff = now.getTime() - 90 * 86_400_000

  return {
    totalCandidates: candidates.length,
    byGithubLanguage: [...languageCounts.entries()]
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count),
    typeScriptCandidates: candidates.filter((candidate) => candidate.githubLanguage === "TypeScript").length,
    stars: {
      total: stars.reduce((sum, value) => sum + value, 0),
      median: median(stars),
      mean: stars.length === 0 ? 0 : Math.round(stars.reduce((sum, value) => sum + value, 0) / stars.length),
      p90: percentile(stars, 0.9),
      max: stars[stars.length - 1] ?? 0
    },
    active90d: candidates.filter((candidate) => Date.parse(candidate.pushedAt) >= cutoff).length,
    withLicense: candidates.filter((candidate) => candidate.license !== null).length,
    archivedExcluded: result.dedupe.droppedArchived.length,
    forksExcluded: result.dedupe.droppedForks.length,
    duplicateMerges: result.dedupe.merged,
    possibleDuplicateGroups: result.dedupe.possibleDuplicates.length,
    topTopics: [...topicCounts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
      .slice(0, 20)
  }
}

export interface SnapshotPaths {
  readonly dir: string
  readonly candidates: string
  readonly frame: string
  readonly calls: string
  readonly summary: string
}

export interface WriteSnapshotOptions {
  /** 快照根目录（默认 `packages/observatory/data/snapshots`） */
  readonly root: string
  readonly force?: boolean
}

/**
 * 写快照。
 *
 * 已存在就**报错**而不是覆盖：逐月快照的整个价值在于"旧数据没被改过"，
 * 一次静默覆盖会让最早那期快照永久失去证据力。
 *
 * 注意这里必须**分辨错误类型**：`mkdir(dir, {recursive:false})` 在父目录不存在时
 * 抛的是 ENOENT 而不是 EEXIST —— 初版把任何错误都当成"已存在"，
 * 于是第一次跑（快照根目录还没建）会报出一条彻底误导人的"目录已存在"
 * （踩过一次：排错时盯着一个不存在的目录看了十分钟）。
 */
async function createSnapshotDir(dir: string, force: boolean): Promise<void> {
  await mkdir(path.dirname(dir), { recursive: true })
  try {
    await mkdir(dir, { recursive: false })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "EEXIST") {
      if (force) return
      throw new Error(
        `快照目录已存在：${dir}\n` +
          `快照是证据，不允许静默覆盖。要重跑请换一个 snapshot-date，或显式加 --force。`
      )
    }
    throw new Error(`无法创建快照目录 ${dir}：${code ?? String(error)}`)
  }
}

export async function writeSnapshot(
  result: DiscoveryResult,
  options: WriteSnapshotOptions
): Promise<SnapshotPaths> {
  const dir = path.join(options.root, result.frame.snapshotDate)
  const paths: SnapshotPaths = {
    dir,
    candidates: path.join(dir, "candidates.json"),
    frame: path.join(dir, "frame.json"),
    calls: path.join(dir, "search-calls.json"),
    summary: path.join(dir, "summary.json")
  }

  await createSnapshotDir(dir, options.force === true)

  const summary = summarize(result)
  const meta = {
    datasetVersion: DATASET_VERSION,
    classifierVersion: CLASSIFIER_VERSION,
    generatedAt: new Date().toISOString(),
    frame: result.frame,
    api: result.api,
    truncatedSlices: result.truncatedSlices,
    /** 泛词被抬高过的星数下限：不写进产物，读者会以为这些查询覆盖了全部星段 */
    raisedFloors: result.raisedFloors,
    statement: result.frame.statement
  }

  // candidates 用**紧凑**写法：它有几 MB，缩进会让体积翻倍而没有人会去读它的 diff
  // （要人读的是 frame/summary/search-calls 这三个小文件）
  await writeFile(paths.candidates, JSON.stringify({ meta, candidates: result.candidates }), "utf8")
  await writeFile(paths.frame, JSON.stringify(meta, null, 2), "utf8")
  await writeFile(
    paths.calls,
    JSON.stringify(
      {
        calls: result.calls,
        excluded: {
          forks: result.dedupe.droppedForks,
          archived: result.dedupe.droppedArchived,
          possibleDuplicates: result.dedupe.possibleDuplicates
        }
      },
      null,
      2
    ),
    "utf8"
  )
  await writeFile(paths.summary, JSON.stringify(summary, null, 2), "utf8")

  return paths
}

/**
 * 把 Effect 深度扫描结果写进**已有**快照目录。
 *
 * 与 `writeSnapshot` 的区别：那是"新建一期快照"（已存在即报错，保护历史）；
 * 这里是给同一期快照补一个派生文件（发现 → 扫描是两步，中间隔了几十分钟）。
 */
export async function writeEffectScan(dir: string, result: unknown): Promise<string> {
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, "effect-scan.json")
  await writeFile(file, JSON.stringify(result), "utf8")
  return file
}

/** 往已有快照写一个派生文件（分类结果等） */
export async function writeAiFile(dir: string, name: string, result: unknown): Promise<string> {
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, name)
  await writeFile(file, JSON.stringify(result), "utf8")
  return file
}

/** 读回已提交的候选池（扫描阶段要用） */
export async function readCandidates(dir: string): Promise<ReadonlyArray<Candidate>> {
  const raw = JSON.parse(await readFile(path.join(dir, "candidates.json"), "utf8")) as {
    candidates?: ReadonlyArray<Candidate>
  }
  return raw.candidates ?? []
}

export type { Candidate, SearchCall, DiscoveryFrame }
