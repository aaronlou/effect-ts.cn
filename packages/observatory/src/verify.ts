/**
 * 快照自检：**证据不许自相矛盾**。
 *
 * 为什么值得单独写一个门禁：这份 snapshot 会被当成"事实"引用（写进报告、文章、乃至别人的 PPT）。
 * 一旦 `summary.json` 和 `candidates.json` 对不上、或者某条候选的 `via` 指向一条不存在的查询，
 * 读者没有任何办法发现 —— 数字看起来永远是对的。
 *
 * 与生态榜 `ecosystem:check` 同源：那一条要求"点评必须指向采集到的真实文件"，
 * 这一条要求"每条候选都能回溯到真实查询、每个汇总数字都能由明细重算"。
 *
 * 纯函数、零网络：CI 里直接对已提交的快照跑。
 */
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import type { Candidate } from "./candidate.js"

export interface SnapshotCheckResult {
  readonly snapshot: string
  readonly candidates: number
  readonly issues: ReadonlyArray<string>
}

interface FrameFile {
  readonly datasetVersion?: string
  readonly generatedAt?: string
  readonly statement?: string
  readonly frame?: {
    readonly snapshotDate?: string
    readonly minStars?: number
    readonly pushedSince?: string
    readonly languages?: ReadonlyArray<string>
    readonly queryCount?: number
  }
}

interface CallsFile {
  readonly calls?: ReadonlyArray<{
    readonly query?: string
    readonly language?: string
    readonly keyword?: string
    readonly effectiveMinStars?: number
    readonly totalCount?: number
    readonly taken?: number
    readonly truncated?: boolean
  }>
}

interface SnapshotSummary {
  readonly totalCandidates?: number
  readonly typeScriptCandidates?: number
  readonly byGithubLanguage?: ReadonlyArray<{ readonly language: string; readonly count: number }>
  readonly stars?: { readonly median?: number; readonly max?: number; readonly total?: number }
}

const readJson = async <T>(file: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T
  } catch {
    return undefined
  }
}

/** 列出快照目录（按名字排序，最后一个是最新的） */
export async function listSnapshots(root: string): Promise<ReadonlyArray<string>> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * 校验一份快照。
 *
 * 检查的都是"错了就一定会误导读者"的点：
 * 1. 四个文件必须齐全（缺一个就没法复现）；
 * 2. 宇宙声明与版本号必须存在（报告要引用它）；
 * 3. 汇总必须能由明细重算（语言分布、总数、TS 数）；
 * 4. 每条候选的 `via` 必须指向本次真实跑过的查询；
 * 5. 主集里不许出现 fork / archived（去重规则说好要排除的）；
 * 6. 被抬高的下限必须在 frame 里有记录（否则读者会以为泛词覆盖了全部星段）。
 */
export async function verifySnapshot(dir: string): Promise<SnapshotCheckResult> {
  const issues: Array<string> = []

  const frame = await readJson<FrameFile>(path.join(dir, "frame.json"))
  const calls = await readJson<CallsFile>(path.join(dir, "search-calls.json"))
  const summary = await readJson<SnapshotSummary>(path.join(dir, "summary.json"))
  const candidatesFile = await readJson<{ candidates?: ReadonlyArray<Candidate> }>(path.join(dir, "candidates.json"))

  if (frame === undefined) issues.push("缺 frame.json")
  if (calls === undefined) issues.push("缺 search-calls.json")
  if (summary === undefined) issues.push("缺 summary.json")
  if (candidatesFile === undefined) issues.push("缺 candidates.json")
  if (issues.length > 0) return { snapshot: dir, candidates: 0, issues }

  const candidates = candidatesFile?.candidates ?? []
  const callList = calls?.calls ?? []

  // 2) 可复现性元数据
  if (frame?.statement === undefined || frame.statement.trim() === "") {
    issues.push("frame.statement 缺失 —— 有界宇宙的声明是报告的第一页，不能为空")
  }
  if (frame?.datasetVersion === undefined) issues.push("frame.datasetVersion 缺失（不可复现）")
  if (frame?.generatedAt === undefined) issues.push("frame.generatedAt 缺失（不可复现）")
  if (frame?.frame?.snapshotDate === undefined) issues.push("frame.frame.snapshotDate 缺失")

  // 3) 汇总能由明细重算
  if (summary?.totalCandidates !== candidates.length) {
    issues.push(`summary.totalCandidates=${summary?.totalCandidates} 与 candidates.json 的 ${candidates.length} 条不一致`)
  }
  const ts = candidates.filter((candidate) => candidate.githubLanguage === "TypeScript").length
  if (summary?.typeScriptCandidates !== ts) {
    issues.push(`summary.typeScriptCandidates=${summary?.typeScriptCandidates} 与明细重算的 ${ts} 不一致`)
  }
  const recomputed = new Map<string, number>()
  for (const candidate of candidates) {
    const key = candidate.githubLanguage ?? "(未知)"
    recomputed.set(key, (recomputed.get(key) ?? 0) + 1)
  }
  for (const row of summary?.byGithubLanguage ?? []) {
    const actual = recomputed.get(row.language) ?? 0
    if (actual !== row.count) {
      issues.push(`语言分布对不上：${row.language} 汇总 ${row.count}，明细 ${actual}`)
    }
  }

  // 4) via 可回溯
  //
  // 判据直接取 search-calls.json 的 `language` / `keyword` 字段 ——
  // 初版用正则去反解 query 字符串（想从 `... language:typescript stars:>=300 ...` 里抠关键词），
  // 结果是永远抠不出来 ⇒ 满屏假阳性。结构化字段就在手边，没有理由去解析字符串。
  const knownPrefixes = new Set(
    callList
      .filter((call) => typeof call.language === "string" && typeof call.keyword === "string")
      .map((call) => `${(call as { language: string }).language}:${(call as { keyword: string }).keyword}`)
  )
  if (knownPrefixes.size === 0) issues.push("search-calls.json 里没有任何 query（无法验证 via）")
  for (const candidate of candidates) {
    if (candidate.via.length === 0) {
      issues.push(`${candidate.repo} 没有 via（无法回溯它是怎么被发现的）`)
      continue
    }
    for (const tag of candidate.via) {
      // via 形如 `TypeScript:agent` 或 `TypeScript:agent:stars>=600`（抬高下限的查询）
      const base = tag.replace(/:stars>=.*$/, "")
      if (!knownPrefixes.has(base)) {
        issues.push(`${candidate.repo} 的 via「${tag}」不对应本次任何一条查询`)
      }
    }
  }

  // 5) 去重规则说的和做的一致
  for (const candidate of candidates) {
    if (candidate.fork) issues.push(`${candidate.repo} 是 fork，不该在主集里`)
    if (candidate.archived) issues.push(`${candidate.repo} 已 archived，不该在主集里`)
  }

  // 6) 抬高下限必须留痕
  const raised = callList.filter((call) => (call.effectiveMinStars ?? 0) > (frame?.frame?.minStars ?? 0))
  const raisedRecorded = (frame as { raisedFloors?: ReadonlyArray<unknown> } | undefined)?.raisedFloors ?? []
  if (raised.length > 0 && raisedRecorded.length === 0) {
    issues.push(`有 ${raised.length} 条查询抬高了星数下限，但 frame.raisedFloors 是空的（读者会误以为它们覆盖全部星段）`)
  }

  return { snapshot: dir, candidates: candidates.length, issues }
}
