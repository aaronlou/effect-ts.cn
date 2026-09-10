/**
 * 译文 ↔ 上游快照比对：产出 stale（落后）/ missing（上游已删）/ ok 清单。
 * “同步即信誉”的判定逻辑，供本地自查与 CI 门禁复用。
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { DocEntry } from "./status.js"
import { scanDocsDir } from "./status.js"
import type { Snapshot } from "./snapshot.js"

export type StaleReason =
  | "commit-changed" // 本地基线落后于上游最近 commit
  | "upstream-missing" // 本地声明了 upstreamPath，但快照里找不到该文件（上游移动/删除）

export interface DiffItem {
  readonly localFile: string
  readonly version: string
  readonly upstreamPath: string
  readonly localCommit: string | undefined
  readonly upstreamCommit: string | null
  readonly reason: StaleReason
}

export interface DiffReport {
  readonly generatedAt: string
  readonly localTotal: number
  readonly checked: number
  readonly okCount: number
  readonly stale: ReadonlyArray<DiffItem>
}

/** 归一化：去掉 docs/ 前缀、统一 posix 分隔符 */
export function normalizeUpstreamPath(p: string): string {
  const posix = p.split(path.sep).join("/")
  return posix.replace(/^docs\//, "")
}

export async function loadSnapshot(snapshotPath: string): Promise<Snapshot> {
  const raw = await readFile(snapshotPath, "utf8")
  return JSON.parse(raw) as Snapshot
}

export async function diffTranslations(
  docsDir: string,
  snapshot: Snapshot
): Promise<DiffReport> {
  const local = await scanDocsDir(docsDir)
  const stale: Array<DiffItem> = []
  let checked = 0
  let okCount = 0

  for (const entry of local) {
    if (entry.upstreamPath === undefined) {
      // 无上游基线的“孤儿译文”，不属于可判定“落后”的对象
      continue
    }
    checked += 1
    const key = normalizeUpstreamPath(entry.upstreamPath)
    const upstreamCommit = snapshot.files[key]
    if (upstreamCommit === undefined) {
      stale.push({
        localFile: entry.file,
        version: entry.version,
        upstreamPath: entry.upstreamPath,
        localCommit: entry.upstreamCommit,
        upstreamCommit: null,
        reason: "upstream-missing"
      })
      continue
    }
    if (entry.upstreamCommit !== upstreamCommit) {
      stale.push({
        localFile: entry.file,
        version: entry.version,
        upstreamPath: entry.upstreamPath,
        localCommit: entry.upstreamCommit,
        upstreamCommit,
        reason: "commit-changed"
      })
      continue
    }
    okCount += 1
  }

  return {
    generatedAt: new Date().toISOString(),
    localTotal: local.length,
    checked,
    okCount,
    stale
  }
}
