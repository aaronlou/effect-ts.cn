/**
 * `code:check` 的"假绿"回归测试。
 *
 * 背景（真实事故）：CLI 曾对 frontmatter 缺 `upstreamPath` 的文件静默跳过，
 * 却照样打印 `✔ 代码块与标题数量和上游一致` —— 门禁**什么都没检查**却返回 0。
 * 一篇漏填 frontmatter 的草稿因此两次假绿通过。这里把行为钉死：
 * 有文件未参与检查 ⇒ 退出码 1；显式 `--allow-skipped` 才容忍。
 */
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = path.resolve(packageRoot, "..", "..")

const upstreamBody = `---
title: Demo
---

\`\`\`ts twoslash
const a = 1
\`\`\`
`

const translatedBody = (withUpstreamPath: boolean): string => `---
title: 演示
${withUpstreamPath ? "upstreamPath: v4/demo.mdx\nupstreamCommit: bf4625446a02894046b6937a317dde2cde115fe7\n" : ""}status: reviewing
translators: [ecn-agent]
reviewers: []
---

\`\`\`ts
const a = 1
\`\`\`
`

const makeFixture = async (
  withUpstreamPath: boolean
): Promise<{ upstreamDir: string; docsDir: string }> => {
  const root = await mkdtemp(path.join(tmpdir(), "ecn-codecheck-"))
  const upstreamDir = path.join(root, "upstream")
  const docsDir = path.join(root, "docs")
  await mkdir(path.join(upstreamDir, "v4"), { recursive: true })
  await mkdir(path.join(docsDir, "v4"), { recursive: true })
  await writeFile(path.join(upstreamDir, "v4/demo.mdx"), upstreamBody, "utf8")
  await writeFile(path.join(docsDir, "v4/demo.mdx"), translatedBody(withUpstreamPath), "utf8")
  return { upstreamDir, docsDir }
}

const runCli = (args: ReadonlyArray<string>): { status: number; output: string } => {
  try {
    const output = execFileSync(
      "pnpm",
      ["--filter", "@ecn/content", "exec", "tsx", "src/cli.ts", "code:check", ...args],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    )
    return { status: 0, output }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` }
  }
}

describe("code:check 不做假绿", () => {
  it("全部文件都参与检查且一致 ⇒ 退出码 0", async () => {
    const { upstreamDir, docsDir } = await makeFixture(true)
    const result = runCli(["--upstream", upstreamDir, "--docs", docsDir])
    expect(result.output).toContain("不一致 0 个")
    expect(result.status).toBe(0)
  }, 120_000)

  it("有文件因缺 upstreamPath 未参与检查 ⇒ 退出码 1 且点名该文件", async () => {
    const { upstreamDir, docsDir } = await makeFixture(false)
    const result = runCli(["--upstream", upstreamDir, "--docs", docsDir])
    expect(result.output).toContain("未参与检查")
    expect(result.output).toContain("demo.mdx")
    expect(result.status).toBe(1)
  }, 120_000)

  it("显式 --allow-skipped 才容忍未参与检查的文件", async () => {
    const { upstreamDir, docsDir } = await makeFixture(false)
    const result = runCli(["--upstream", upstreamDir, "--docs", docsDir, "--allow-skipped"])
    expect(result.status).toBe(0)
  }, 120_000)
})
