/**
 * 轻量 git 封装（仅用于内容管线 CLI，避免引入额外依赖）
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/** 返回上游仓库 HEAD commit；失败返回 null */
export async function headCommit(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", dir, "rev-parse", "HEAD"])
    return stdout.trim() || null
  } catch {
    return null
  }
}

/**
 * `older` 是否是 `newer` 的祖先（即 `older` 更早）。
 *
 * 返回 `null` 表示**无法判定**（不是 git 仓库、或 commit 不存在）。
 * 这个三态很关键：把"无法判定"或"不是祖先"一律当成"落后"，
 * 会在**本地基线比上游更新**时产生大量误报 ——
 * 而"落后"是要开 issue 指名道姓的，误报直接损害"同步即信誉"。
 */
export async function isAncestor(
  dir: string,
  older: string,
  newer: string
): Promise<boolean | null> {
  try {
    await execFileAsync("git", ["-C", dir, "merge-base", "--is-ancestor", older, newer])
    return true
  } catch (error) {
    // 退出码 1：git 明确回答"不是祖先"（通常是本地基线比上游更新）
    if (typeof error === "object" && error !== null && (error as { code?: number }).code === 1) {
      return false
    }
    // 其它情况（不是仓库、对象缺失）无法判定
    return null
  }
}

/** 返回某个文件最近一次提交的 commit；文件不存在/无历史返回 null */
export async function lastCommitOf(
  dir: string,
  relPath: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      dir,
      "log",
      "-1",
      "--format=%H",
      "--",
      relPath
    ])
    return stdout.trim() || null
  } catch {
    return null
  }
}
