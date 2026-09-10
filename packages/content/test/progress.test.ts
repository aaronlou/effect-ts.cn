/**
 * 翻译覆盖率统计的测试。
 * 这个数字会被用来决定"下一批翻哪里"，算错会直接误导排期，所以口径必须钉死：
 * translated（已落地）+ proposed（提案中）+ remaining（未动）三者互斥且合计 = nav 条目数。
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { buildCoverageReport, formatCoverage } from "../src/progress"
import type { DocsNav } from "../src/nav"

const nav: DocsNav = {
  versions: {
    v4: [
      {
        label: "错误管理",
        order: 0,
        items: [
          { slug: "v4/error-management/two-error-types", label: "Two Types of Errors", order: 0, upstreamPath: "v4/error-management/two-error-types.mdx" },
          { slug: "v4/error-management/fallback", label: "Fallback", order: 1, upstreamPath: "v4/error-management/fallback.mdx" },
          { slug: "v4/error-management/matching", label: "Matching", order: 2, upstreamPath: "v4/error-management/matching.mdx" }
        ]
      }
    ],
    v3: [
      {
        label: "Schema",
        order: 0,
        items: [
          { slug: "v3/schema/introduction", label: "Introduction", order: 0, upstreamPath: "v3/schema/introduction.mdx" }
        ]
      }
    ]
  }
} as unknown as DocsNav

const makeWorkspace = async (): Promise<{ docsDir: string; proposalsDir: string }> => {
  const root = await mkdtemp(path.join(tmpdir(), "ecn-progress-"))
  const docsDir = path.join(root, "docs")
  const proposalsDir = path.join(root, ".proposals")
  await mkdir(path.join(docsDir, "v4/error-management"), { recursive: true })
  await mkdir(proposalsDir, { recursive: true })
  // 已落地一篇
  await writeFile(
    path.join(docsDir, "v4/error-management/two-error-types.mdx"),
    "---\ntitle: 两类错误\nstatus: reviewing\nupstreamPath: v4/error-management/two-error-types.mdx\nupstreamCommit: bf4625446a02894046b6937a317dde2cde115fe7\ntranslators: [x]\nreviewers: []\n---\n\n正文\n",
    "utf8"
  )
  // 提案一篇（translation）+ 一份非 translation 提案（不应计入）
  await writeFile(
    path.join(proposalsDir, "translation-v4-error-management-fallback.json"),
    JSON.stringify({ kind: "translation", target: { slug: "v4/error-management/fallback" } }),
    "utf8"
  )
  await writeFile(
    path.join(proposalsDir, "faq-something.json"),
    JSON.stringify({ kind: "faq", target: { slug: "v4/error-management/matching" } }),
    "utf8"
  )
  return { docsDir, proposalsDir }
}

describe("翻译覆盖率", () => {
  it("已译 / 提案 / 剩余三者互斥且合计等于 nav 总数", async () => {
    const { docsDir, proposalsDir } = await makeWorkspace()
    const report = await buildCoverageReport({ nav, docsDir, proposalsDir })

    expect(report.total).toBe(4)
    expect(report.translated).toBe(1)
    expect(report.proposed).toBe(1)
    expect(report.remaining).toBe(2)
    expect(report.translated + report.proposed + report.remaining).toBe(report.total)
  })

  it("非 translation 提案不计入覆盖率（FAQ / 术语提案不占译文名额）", async () => {
    const { docsDir, proposalsDir } = await makeWorkspace()
    const report = await buildCoverageReport({ nav, docsDir, proposalsDir })
    // matching 只出现在 faq 提案里 ⇒ 仍算未译
    expect(report.remainingSlugs).toContain("v4/error-management/matching")
  })

  it("按版本与章节给出剩余分布，便于决定下一批", async () => {
    const { docsDir, proposalsDir } = await makeWorkspace()
    const report = await buildCoverageReport({ nav, docsDir, proposalsDir })
    const v4 = report.versions.find((item) => item.version === "v4")
    expect(v4?.total).toBe(3)
    expect(v4?.remaining).toBe(1)
    expect(report.sections[0]).toEqual({ version: "v3", section: "Schema", remaining: 1 })
    expect(formatCoverage(report)).toContain("翻译覆盖")
  })
})
