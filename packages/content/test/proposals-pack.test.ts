/**
 * 提案打包器单测：草稿 MDX → 合规提案 JSON。
 *
 * 这里断言的是「省手写转义」之后仍然**合规**：id 与文件名一致、target 镜像 upstreamPath、
 * content 原文不改、缺基线不许蒙混过关、已存在不许悄悄覆盖。打包后还要过一遍
 * `loadProposals`（与人工投稿同一道闸），确保一条命令就能给出结论。
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { Glossary } from "../src/check.js"
import type { DocsNav } from "../src/nav.js"
import { loadProposals, packProposals, type ProposalContext } from "../src/proposals.js"

const NAV: DocsNav = {
  generatedFrom: { repo: "Effect-TS/website", dir: "apps/web/src/content/docs", head: null, generatedAt: "" },
  versions: {
    v4: [
      {
        key: "error-management",
        label: "错误管理",
        order: 0,
        items: [
          {
            slug: "v4/error-management/fallback",
            label: "Fallback",
            order: 0,
            upstreamPath: "v4/error-management/fallback.mdx"
          }
        ]
      }
    ]
  }
}

const GLOSSARY: Glossary = { forbidden: [{ term: "图层", preferred: "Layer" }] }

const CONTEXT: ProposalContext = {
  nav: NAV,
  glossary: GLOSSARY,
  navPaths: new Set(["v4/error-management/fallback.mdx"]),
  translatedSlugs: new Set()
}

const UPSTREAM_PATH = "v4/error-management/fallback.mdx"
const UPSTREAM_COMMIT = "16b1646850ded8b32b8b86bbdd941092d55d8f24"

const draft = (frontmatter: ReadonlyArray<string> = []): string =>
  [
    "---",
    "title: 回退",
    "status: reviewing",
    `upstreamPath: ${UPSTREAM_PATH}`,
    ...frontmatter,
    "translators: [ecn-agent]",
    "reviewers: []",
    "---",
    "",
    "回退操作用于从带类型的失败中恢复。",
    "",
    "```ts",
    "const a = 1",
    "```",
    ""
  ].join("\n")

const WITH_COMMIT = [`upstreamCommit: ${UPSTREAM_COMMIT}`]

const dirs: Array<string> = []

async function makeDrafts(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ecn-pack-drafts-"))
  dirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content, "utf8")
  }
  return dir
}

async function makeOutDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ecn-pack-out-"))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const packOptions = (draftsDir: string, outDir: string, extra: Record<string, unknown> = {}) => ({
  draftsDir,
  outDir,
  agent: "ecn-agent",
  model: "test-model",
  promptVersion: "translate-v1",
  force: false,
  ...extra
})

describe("proposals:pack", () => {
  it("草稿 → 生成 JSON：id / kind / draftedBy / target / content 全部正确", async () => {
    const draftsDir = await makeDrafts({ "fallback.mdx": draft(WITH_COMMIT) })
    const outDir = await makeOutDir()

    const result = await packProposals(packOptions(draftsDir, outDir))
    expect(result.errors).toEqual([])
    expect(result.packed).toHaveLength(1)

    const id = "translation-v4-error-management-fallback"
    expect(result.packed[0]?.id).toBe(id)
    // id 必须等于文件名（提案契约）
    expect(path.basename(result.packed[0]?.file ?? "")).toBe(`${id}.json`)

    const written = JSON.parse(await readFile(result.packed[0]!.file, "utf8")) as Record<string, unknown>
    expect(written["id"]).toBe(id)
    expect(written["kind"]).toBe("translation")
    expect(Number.isNaN(Date.parse(String(written["createdAt"])))).toBe(false)
    expect(written["draftedBy"]).toEqual({
      kind: "agent",
      name: "ecn-agent",
      model: "test-model",
      promptVersion: "translate-v1"
    })
    // target.slug 仍镜像 upstreamPath（含 `/`）——id 用的连字符 slug 只是文件名
    expect(written["target"]).toEqual({
      slug: "v4/error-management/fallback",
      upstreamPath: UPSTREAM_PATH,
      upstreamCommit: UPSTREAM_COMMIT
    })
    // content 是完整 MDX 原文，一字不改
    expect(written["content"]).toBe(draft(WITH_COMMIT))
  })

  it("缺 --rationale 时用默认话术（含 upstreamPath 与该页标题），传了就用传入的", async () => {
    const draftsDir = await makeDrafts({ "fallback.mdx": draft(WITH_COMMIT) })
    const outDir = await makeOutDir()
    const result = await packProposals(packOptions(draftsDir, outDir))
    const written = JSON.parse(await readFile(result.packed[0]!.file, "utf8")) as {
      rationale: string
    }
    expect(written.rationale).toContain(UPSTREAM_PATH)
    expect(written.rationale).toContain("回退")
    expect(written.rationale.length).toBeGreaterThanOrEqual(20)

    const custom = "这一页是错误管理章节的收尾页，先把回退语义固定下来，方便后续引用。"
    const outDir2 = await makeOutDir()
    const result2 = await packProposals(
      packOptions(draftsDir, outDir2, { rationale: custom })
    )
    const written2 = JSON.parse(await readFile(result2.packed[0]!.file, "utf8")) as {
      rationale: string
    }
    expect(written2.rationale).toBe(custom)
  })

  it("缺 upstreamCommit → 报错，且不写出任何提案", async () => {
    const draftsDir = await makeDrafts({ "fallback.mdx": draft() })
    const outDir = await makeOutDir()
    const result = await packProposals(packOptions(draftsDir, outDir))
    expect(result.errors.join("\n")).toContain("upstreamCommit")
    expect(result.packed).toEqual([])
    expect(await readdir(outDir)).toEqual([])
  })

  it("缺 upstreamPath → 报错", async () => {
    const noPath = draft(WITH_COMMIT).replace(`upstreamPath: ${UPSTREAM_PATH}\n`, "")
    const draftsDir = await makeDrafts({ "fallback.mdx": noPath })
    const outDir = await makeOutDir()
    const result = await packProposals(packOptions(draftsDir, outDir))
    expect(result.errors.join("\n")).toContain("upstreamPath")
    expect(result.packed).toEqual([])
  })

  it("已存在同名提案不覆盖；--force 才覆盖", async () => {
    const draftsDir = await makeDrafts({ "fallback.mdx": draft(WITH_COMMIT) })
    const outDir = await makeOutDir()

    const first = await packProposals(packOptions(draftsDir, outDir, { model: "model-a" }))
    const file = first.packed[0]!.file
    expect(JSON.parse(await readFile(file, "utf8")).draftedBy.model).toBe("model-a")

    const second = await packProposals(packOptions(draftsDir, outDir, { model: "model-b" }))
    expect(second.packed).toEqual([])
    expect(second.skipped).toHaveLength(1)
    expect(second.skipped[0]?.reason).toContain("已存在")
    expect(JSON.parse(await readFile(file, "utf8")).draftedBy.model).toBe("model-a")

    const forced = await packProposals(
      packOptions(draftsDir, outDir, { model: "model-b", force: true })
    )
    expect(forced.packed).toHaveLength(1)
    expect(JSON.parse(await readFile(file, "utf8")).draftedBy.model).toBe("model-b")
  })

  it("跳过 `_` 前缀草稿与非 .mdx 文件", async () => {
    const draftsDir = await makeDrafts({
      "fallback.mdx": draft(WITH_COMMIT),
      "_draft.mdx": draft(WITH_COMMIT),
      "notes.txt": "not mdx"
    })
    const outDir = await makeOutDir()
    const result = await packProposals(packOptions(draftsDir, outDir))
    expect(result.packed).toHaveLength(1)
    expect(result.packed[0]?.id).toBe("translation-v4-error-management-fallback")
  })

  it("打包结果自动过 loadProposals（与人工投稿同一道闸）", async () => {
    const draftsDir = await makeDrafts({ "fallback.mdx": draft(WITH_COMMIT) })
    const outDir = await makeOutDir()
    await packProposals(packOptions(draftsDir, outDir))

    const checked = await loadProposals(outDir, CONTEXT)
    expect(checked.total).toBe(1)
    expect(checked.errors).toEqual([])
    expect(checked.byKind.translation).toBe(1)
  })
})

describe("proposals:pack 不打包已落地页面（防止队列自我污染）", () => {
  it("目标页已存在时跳过，并给出改用 stale-update 的提示", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ecn-pack-landed-"))
    const draftsDir = path.join(root, "drafts")
    const outDir = path.join(root, ".proposals")
    const docsDir = path.join(root, "docs")
    await mkdir(draftsDir, { recursive: true })
    await mkdir(path.join(docsDir, "v4"), { recursive: true })
    // 已落地
    await writeFile(path.join(docsDir, "v4/landed.mdx"), "---\ntitle: 已发布\n---\n\n正文\n", "utf8")
    // 两个草稿：一个目标已落地、一个未落地
    const fm = (p: string): string =>
      `---\ntitle: 示例\nstatus: reviewing\nupstreamPath: ${p}\nupstreamCommit: bf4625446a02894046b6937a317dde2cde115fe7\ntranslators: [t]\nreviewers: []\n---\n\n正文\n`
    await writeFile(path.join(draftsDir, "v4__landed.mdx"), fm("v4/landed.mdx"), "utf8")
    await writeFile(path.join(draftsDir, "v4__fresh.mdx"), fm("v4/fresh.mdx"), "utf8")

    const result = await packProposals({
      draftsDir,
      outDir,
      docsDir,
      agent: "test",
      promptVersion: "translate-v1",
      force: false
    })

    expect(result.packed.map((p) => p.id)).toEqual(["translation-v4-fresh"])
    expect(result.skipped.map((s) => s.id)).toEqual(["translation-v4-landed"])
    expect(result.skipped[0]?.reason).toContain("stale-update")
    expect(await readdir(outDir)).toEqual(["translation-v4-fresh.json"])
  })
})
