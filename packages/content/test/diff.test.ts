/**
 * diff 判定单测。
 *
 * 核心断言：**"落后"必须靠 git 祖先关系判定，不能拿两个 commit 字符串比不同就下结论。**
 * 所以这里真的建一个临时 git 仓库，产出两个有先后关系的 commit（older → newer）来断言。
 *
 * 曾经的行为：`local !== upstream ⇒ 落后`。当译文基线是抓取时的仓库 HEAD（比上游
 * 该文件的最后改动更新）时，会把**其实是最新的**译文误报成落后 —— 一次 83 篇。
 */
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { Snapshot } from "../src/snapshot.js"
import { diffTranslations } from "../src/diff.js"

const dirs: Array<string> = []

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

/** 用 -c 传身份，避免动到全局 git 配置 */
const git = (cwd: string, ...args: Array<string>): string =>
  execFileSync(
    "git",
    ["-C", cwd, "-c", "user.name=ecn-test", "-c", "user.email=ecn@example.com", ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim()

/** 建一个含两次提交的仓库：older（v1）是 newer（v2）的祖先 */
async function makeRepo(): Promise<{ repo: string; older: string; newer: string }> {
  const repo = await mkdtemp(path.join(tmpdir(), "ecn-diff-git-"))
  dirs.push(repo)
  await mkdir(path.join(repo, "v4"), { recursive: true })
  await writeFile(path.join(repo, "v4/x.mdx"), "# v1\n", "utf8")
  git(repo, "init")
  git(repo, "add", ".")
  git(repo, "commit", "-m", "v1")
  const older = git(repo, "rev-parse", "HEAD")
  await writeFile(path.join(repo, "v4/x.mdx"), "# v2\n", "utf8")
  git(repo, "add", ".")
  git(repo, "commit", "-m", "v2")
  const newer = git(repo, "rev-parse", "HEAD")
  return { repo, older, newer }
}

async function makeDocs(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ecn-diff-docs-"))
  dirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content, "utf8")
  }
  return dir
}

const doc = (commit: string): string =>
  [
    "---",
    "title: X",
    "status: published",
    "upstreamPath: v4/x.mdx",
    `upstreamCommit: ${commit}`,
    "translators: [t]",
    "reviewers: [r]",
    "---",
    "",
    "正文。",
    ""
  ].join("\n")

const snapshotWith = (commit: string, repoRoot?: string): Snapshot => ({
  generatedAt: "2026-01-01T00:00:00.000Z",
  top: commit,
  fileCount: 1,
  files: { "v4/x.mdx": commit },
  ...(repoRoot !== undefined ? { repoRoot } : {})
})

describe("diff：落后判定（基于 git 祖先关系）", () => {
  it("本地基线 = 上游 ⇒ 同步，不计落后", async () => {
    const { repo, older } = await makeRepo()
    const docs = await makeDocs({ "v4/x.mdx": doc(older) })
    const report = await diffTranslations(docs, snapshotWith(older, repo), { repoDir: repo })
    expect(report.okCount).toBe(1)
    expect(report.stale).toEqual([])
    expect(report.ahead).toEqual([])
  })

  it("本地基线是上游的祖先 ⇒ 真落后", async () => {
    const { repo, older, newer } = await makeRepo()
    const docs = await makeDocs({ "v4/x.mdx": doc(older) })
    const report = await diffTranslations(docs, snapshotWith(newer, repo), { repoDir: repo })
    expect(report.stale).toHaveLength(1)
    expect(report.stale[0]?.reason).toBe("commit-changed")
  })

  it("本地基线比上游更新 ⇒ **不**落后（回归：曾经被误报成落后）", async () => {
    const { repo, older, newer } = await makeRepo()
    const docs = await makeDocs({ "v4/x.mdx": doc(newer) })
    const report = await diffTranslations(docs, snapshotWith(older, repo), { repoDir: repo })
    expect(report.stale).toEqual([])
    expect(report.ahead).toHaveLength(1)
    expect(report.ahead[0]?.reason).toBe("baseline-newer")
  })

  it("没有 git 仓库 ⇒ 无法判定，且**不**算落后（宁可漏报也不误报）", async () => {
    const { older, newer } = await makeRepo()
    const docs = await makeDocs({ "v4/x.mdx": doc(newer) })
    // 既不传 repoDir，快照里也没有 repoRoot
    const report = await diffTranslations(docs, snapshotWith(older))
    expect(report.stale).toEqual([])
    expect(report.ahead).toHaveLength(1)
    expect(report.ahead[0]?.reason).toBe("undetermined")
  })

  it("上游已删除该文件 ⇒ 落后（upstream-missing）", async () => {
    const { repo, older } = await makeRepo()
    const docs = await makeDocs({ "v4/x.mdx": doc(older) })
    const snapshot: Snapshot = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      top: older,
      fileCount: 0,
      files: {}
    }
    const report = await diffTranslations(docs, snapshot, { repoDir: repo })
    expect(report.stale).toHaveLength(1)
    expect(report.stale[0]?.reason).toBe("upstream-missing")
  })
})
