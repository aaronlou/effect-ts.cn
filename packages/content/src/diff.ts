/**
 * 译文 ↔ 上游快照比对：产出 stale（真落后）/ ahead（不落后）/ missing（上游已删）清单。
 * “同步即信誉”的判定逻辑，供本地自查与 CI 门禁复用。
 *
 * **判定"落后"不能只比 commit 字符串。**
 *
 * 上游快照里存的是"该文件最近一次**被改动**的 commit"，而我们的译文基线
 * 可能是抓取时的仓库 HEAD（比它**更新**）。两者不同并不代表译文落后 ——
 * 只有"本地基线是上游 commit 的**祖先**"才叫真落后。
 *
 * 曾经这里直接 `local !== upstream ⇒ 落后`，于是一次性把 83 篇**其实是最新的**
 * 译文误报成落后。而"落后"是要开 issue 指名道姓的 —— 误报会直接把
 * "同步即信誉"变成噪音，比漏报更伤。
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { DocEntry } from "./status.js"
import { scanDocsDir } from "./status.js"
import type { Snapshot } from "./snapshot.js"
import { isAncestor } from "./git.js"

export type DiffItemKind = "stale" | "ahead"

export type DiffReason =
  | "commit-changed" // 真落后：本地基线是上游最近 commit 的祖先
  | "no-baseline" // 译文没有 upstreamCommit，无法证明同步（欠账）
  | "upstream-missing" // 本地声明了 upstreamPath，但快照里找不到（上游移动/删除）
  | "baseline-newer" // 基线比上游最近改动更新 —— 不是落后
  | "undetermined" // 无法判定（没给 git 仓库 / commit 缺失）

export interface DiffItem {
  readonly localFile: string
  readonly version: string
  readonly upstreamPath: string
  readonly localCommit: string | undefined
  readonly upstreamCommit: string | null
  readonly kind: DiffItemKind
  readonly reason: DiffReason
}

export interface DiffReport {
  readonly generatedAt: string
  readonly localTotal: number
  readonly checked: number
  readonly okCount: number
  readonly stale: ReadonlyArray<DiffItem>
  /**
   * 基线不同但**并非落后**（基线更新，或无法判定）。
   * 刻意不计入 `stale`：宁可漏报，也不要把"其实是最新的"译文指名道姓地说成落后。
   */
  readonly ahead: ReadonlyArray<DiffItem>
  /** 本次用于判定的 git 仓库根；缺失表示没能用上祖先关系（结论可能含"无法判定"） */
  readonly repoRoot?: string
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
  snapshot: Snapshot,
  options: { readonly repoDir?: string } = {}
): Promise<DiffReport> {
  const repoDir = options.repoDir ?? snapshot.repoRoot
  const local: ReadonlyArray<DocEntry> = await scanDocsDir(docsDir)
  const stale: Array<DiffItem> = []
  const ahead: Array<DiffItem> = []
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

    const base = {
      localFile: entry.file,
      version: entry.version,
      upstreamPath: entry.upstreamPath,
      localCommit: entry.upstreamCommit,
      upstreamCommit: upstreamCommit ?? null
    }

    if (upstreamCommit === undefined || upstreamCommit === null) {
      stale.push({ ...base, kind: "stale", reason: "upstream-missing" })
      continue
    }
    if (entry.upstreamCommit === undefined) {
      stale.push({ ...base, kind: "stale", reason: "no-baseline" })
      continue
    }
    if (entry.upstreamCommit === upstreamCommit) {
      okCount += 1
      continue
    }

    // 基线不同：用 git 祖先关系判定，而不是比字符串
    const ancestor =
      repoDir !== undefined
        ? await isAncestor(repoDir, entry.upstreamCommit, upstreamCommit)
        : null

    if (ancestor === true) {
      stale.push({ ...base, kind: "stale", reason: "commit-changed" })
    } else if (ancestor === false) {
      ahead.push({ ...base, kind: "ahead", reason: "baseline-newer" })
    } else {
      ahead.push({ ...base, kind: "ahead", reason: "undetermined" })
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    localTotal: local.length,
    checked,
    okCount,
    stale,
    ahead,
    ...(repoDir !== undefined ? { repoRoot: repoDir } : {})
  }
}
