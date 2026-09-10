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
