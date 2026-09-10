/**
 * 提案队列的「出队」测试。
 *
 * 背景：`proposals:apply` 把内容写进 content/docs 后，提案 JSON 仍留在队列里，
 * `proposals:check` 就会因「该页已有中文译文」整片报错（真实发生过：81 条重复项把门禁顶红）。
 * 一个提案的生命周期必须是：起草 → 校验 → 落地 → 出队。
 */
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { pruneConsumedProposals } from "../src/proposals"

const frontmatter = (upstreamPath: string): string =>
  `---\ntitle: 示例\nstatus: reviewing\nupstreamPath: ${upstreamPath}\nupstreamCommit: bf4625446a02894046b6937a317dde2cde115fe7\ntranslators: [t]\nreviewers: []\n---\n\n正文\n`

const makeWorkspace = async (): Promise<{ docsDir: string; proposalsDir: string }> => {
  const root = await mkdtemp(path.join(tmpdir(), "ecn-prune-"))
  const docsDir = path.join(root, "docs")
  const proposalsDir = path.join(root, ".proposals")
  await mkdir(path.join(docsDir, "v4"), { recursive: true })
  await mkdir(proposalsDir, { recursive: true })
  // 已落地的一页
  await writeFile(path.join(docsDir, "v4/landed.mdx"), frontmatter("v4/landed.mdx"), "utf8")
  // 已落地的提案（应被出队）
  await writeFile(
    path.join(proposalsDir, "translation-v4-landed.json"),
    JSON.stringify({ kind: "translation", target: { slug: "v4/landed", upstreamPath: "v4/landed.mdx" } }),
    "utf8"
  )
  // 尚未落地的提案（不得被动）
  await writeFile(
    path.join(proposalsDir, "translation-v4-pending.json"),
    JSON.stringify({ kind: "translation", target: { slug: "v4/pending", upstreamPath: "v4/pending.mdx" } }),
    "utf8"
  )
  // stale-update 的目标本来就已存在，不在清理范围
  await writeFile(
    path.join(proposalsDir, "stale-update-v4-landed.json"),
    JSON.stringify({ kind: "stale-update", target: { slug: "v4/landed" } }),
    "utf8"
  )
  return { docsDir, proposalsDir }
}

describe("proposals:prune 出队", () => {
  it("dry-run 只报告不删除", async () => {
    const { docsDir, proposalsDir } = await makeWorkspace()
    const result = await pruneConsumedProposals({ proposalsDir, docsDir, write: false })
    expect(result.consumed).toEqual(["translation-v4-landed"])
    expect(result.removed).toEqual([])
    expect(await readdir(proposalsDir)).toHaveLength(3)
  })

  it("--write 删除已落地提案，保留未落地与 stale-update", async () => {
    const { docsDir, proposalsDir } = await makeWorkspace()
    const result = await pruneConsumedProposals({ proposalsDir, docsDir, write: true })
    expect(result.removed).toEqual(["translation-v4-landed"])
    const left = (await readdir(proposalsDir)).sort()
    expect(left).toEqual(["stale-update-v4-landed.json", "translation-v4-pending.json"])
  })

  it("幂等：再跑一次无事发生", async () => {
    const { docsDir, proposalsDir } = await makeWorkspace()
    await pruneConsumedProposals({ proposalsDir, docsDir, write: true })
    const again = await pruneConsumedProposals({ proposalsDir, docsDir, write: true })
    expect(again.consumed).toEqual([])
  })
})
