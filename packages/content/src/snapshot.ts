/**
 * 上游快照：把 effect 官方 docs 目录（每次上游文件 + 最近 commit）固化为 JSON，
 * 让“我们的译文落后了吗”可被程序化判定。快照是本地/CI 共用的中间产物。
 */
import { readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { headCommit, lastCommitOf } from "./git.js"

export interface Snapshot {
  readonly generatedAt: string
  readonly top: string | null
  readonly fileCount: number
  /** key：相对 docs 的路径（posix），value：该文件最近 commit */
  readonly files: Readonly<Record<string, string | null>>
}

export const UPSTREAM_CONTENT_EXTS = [".md", ".mdx"] as const

async function listContentFiles(
  dir: string,
  base: string
): Promise<ReadonlyArray<string>> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: Array<string> = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listContentFiles(full, base)))
    } else if (
      entry.isFile() &&
      UPSTREAM_CONTENT_EXTS.some((ext) => entry.name.endsWith(ext))
    ) {
      files.push(path.relative(base, full))
    }
  }
  return files
}

/** 扫描上游 docs 目录并生成快照对象（不落盘） */
export async function buildSnapshot(docsDir: string): Promise<Snapshot> {
  const root = path.resolve(docsDir)
  // 上游仓库根：若传入的是 <repo>/docs，则根为其父目录，git 路径需加 docs/ 前缀
  const isDocsDir = path.basename(root) === "docs"
  const repoRoot = isDocsDir ? path.dirname(root) : root
  const pathPrefix = isDocsDir ? `docs/` : ""

  const top = await headCommit(repoRoot)
  const files = await listContentFiles(root, root)

  const map: Record<string, string | null> = {}
  for (const rel of files) {
    const posix = rel.split(path.sep).join("/")
    map[posix] = await lastCommitOf(repoRoot, `${pathPrefix}${posix}`)
  }

  return {
    generatedAt: new Date().toISOString(),
    top,
    fileCount: files.length,
    files: map
  }
}

export async function writeSnapshot(snapshot: Snapshot, outFile: string): Promise<void> {
  await writeFile(outFile, JSON.stringify(snapshot, null, 2), "utf8")
}
