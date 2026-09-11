/**
 * 提案队列单测：重点不是"能解析 JSON"，而是**治理不变量真的拦得住**。
 *
 * 每条负面用例都对应一个现实风险：Agent 自我发布、Agent 给自己背书、
 * Agent 不声明模型、Agent 用一句"AI 生成"当理由、Agent 起草的内容绕过术语门禁。
 */
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { Glossary } from "../src/check.js"
import type { DocsNav } from "../src/nav.js"
import { writeFile } from "node:fs/promises"
import {
  applyProposal,
  loadProposalContext,
  loadProposals,
  validateProposal,
  type ProposalContext
} from "../src/proposals.js"

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..")

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

const context = (translatedSlugs: ReadonlyArray<string> = []): ProposalContext => ({
  nav: NAV,
  glossary: GLOSSARY,
  navPaths: new Set(["v4/error-management/fallback.mdx"]),
  translatedSlugs: new Set(translatedSlugs)
})

const contentOf = (options: { status?: string; reviewers?: string; body?: string } = {}): string =>
  [
    "---",
    "title: 回退与恢复",
    `status: ${options.status ?? "reviewing"}`,
    "upstreamPath: v4/error-management/fallback.mdx",
    "upstreamCommit: 16b1646850ded8b32b8b86bbdd941092d55d8f24",
    "translators: [tester]",
    `reviewers: ${options.reviewers ?? "[]"}`,
    "---",
    "",
    options.body ?? "这是中文译文正文，讲的是回退策略。",
    ""
  ].join("\n")

const proposalOf = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    id: "p1",
    kind: "translation",
    createdAt: "2026-09-10T00:00:00.000Z",
    draftedBy: { kind: "agent", name: "tester", model: "test-model" },
    rationale: "这一页是新手路径的必经页，且被站内多篇译文引用，值得优先翻译。",
    target: {
      slug: "v4/error-management/fallback",
      upstreamPath: "v4/error-management/fallback.mdx"
    },
    content: contentOf(),
    ...overrides
  })

const check = async (raw: string, ctx: ProposalContext = context()) =>
  validateProposal("p1", raw, ctx)

const messages = (errors: ReadonlyArray<{ message: string }>): string =>
  errors.map((issue) => issue.message).join("\n")

describe("提案队列：健康提案", () => {
  it("完整、合规的提案 → 通过，并产出结构化提案", async () => {
    const result = await check(proposalOf())
    expect(messages(result.errors)).toBe("")
    expect(result.proposal?.kind).toBe("translation")
    expect(result.proposal?.target.slug).toBe("v4/error-management/fallback")
  })

  it("仓库里的模板必须始终可用（否则新人的第一次体验就是失败的）", async () => {
    const ctx = await loadProposalContext({
      navFile: path.join(REPO_ROOT, "apps/site/src/data/docs-nav.json"),
      glossaryFile: path.join(REPO_ROOT, "docs/glossary.json"),
      docsDir: path.join(REPO_ROOT, "apps/site/src/content/docs")
    })
    const raw = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(REPO_ROOT, ".proposals/_template.translation.json"), "utf8")
    )
    // 模板里的示例 slug 必须是**真实 nav 路径**（好让新人照抄），但站点 234 页已全部译完，
    // 于是"该页已有中文译文"这条会命中模板 —— 那是内容状态，不是模板本身的问题。
    // 因此在"模拟尚未翻译"的上下文里验证模板结构（契约不变量 + 必填字段）。
    const result = await validateProposal("_template.translation", raw, {
      ...ctx,
      translatedSlugs: new Set<string>()
    })
    expect(messages(result.errors)).toBe("")
    expect(result.proposal).toBeDefined()
  })
})

describe("治理不变量：Agent 不得自我发布 / 自我背书", () => {
  it("content.status = published → 拒绝", async () => {
    const result = await check(proposalOf({ content: contentOf({ status: "published" }) }))
    expect(messages(result.errors)).toContain("status 只能是 translating 或 reviewing")
  })

  it("content.reviewers 非空 → 拒绝", async () => {
    const result = await check(proposalOf({ content: contentOf({ reviewers: "[tester]" }) }))
    expect(messages(result.errors)).toContain("reviewers 必须为空")
  })

  it("agent 未声明 model → 拒绝（provenance 不能缺）", async () => {
    const result = await check(
      proposalOf({ draftedBy: { kind: "agent", name: "tester" } })
    )
    expect(messages(result.errors)).toContain("必须声明 draftedBy.model")
  })

  it("rationale 太短（如「AI 生成」）→ 拒绝", async () => {
    const result = await check(proposalOf({ rationale: "AI 生成" }))
    expect(messages(result.errors)).toContain("rationale 至少")
  })
})

describe("提案结构校验", () => {
  it("非法 JSON → 拒绝", async () => {
    const result = await check("{ 这不是 json")
    expect(messages(result.errors)).toContain("不是合法 JSON")
  })

  it("id 与文件名不一致 → 拒绝", async () => {
    const result = await check(proposalOf({ id: "另一个名字" }))
    expect(messages(result.errors)).toContain("id 与文件名不一致")
  })

  it("kind 非法 → 拒绝", async () => {
    const result = await check(proposalOf({ kind: "rewrite-everything" }))
    expect(messages(result.errors)).toContain("kind 非法")
  })

  it("target.slug 不镜像 upstreamPath → 拒绝", async () => {
    const result = await check(
      proposalOf({
        target: { slug: "v4/error-management/other", upstreamPath: "v4/error-management/fallback.mdx" }
      })
    )
    expect(messages(result.errors)).toContain("必须镜像 upstreamPath")
  })

  it("upstreamPath 不在官方导航清单 → 拒绝", async () => {
    const result = await check(
      proposalOf({
        target: { slug: "v4/error-management/ghost", upstreamPath: "v4/error-management/ghost.mdx" }
      })
    )
    expect(messages(result.errors)).toContain("不在官方导航清单中")
  })

  it("translation 但该页已有译文 → 拒绝（应改用 stale-update）", async () => {
    const result = await check(proposalOf(), context(["v4/error-management/fallback"]))
    expect(messages(result.errors)).toContain("已有中文译文")
    expect(messages(result.errors)).toContain("stale-update")
  })

  it("stale-update 缺 target.upstreamCommit → 拒绝", async () => {
    const result = await check(
      proposalOf({ kind: "stale-update" }),
      context(["v4/error-management/fallback"])
    )
    expect(messages(result.errors)).toContain("必须给出 target.upstreamCommit")
  })

  it("translation 缺 content → 拒绝", async () => {
    const result = await check(proposalOf({ content: undefined }))
    expect(messages(result.errors)).toContain("必须提供完整 content")
  })
})

describe("跨提案检查：两条提案不能抢同一页", () => {
  const dirs: Array<string> = []

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop()
      if (dir !== undefined) await rm(dir, { recursive: true, force: true })
    }
  })

  it("两条提案指向同一 slug → 报错（另一条会变成幽灵工作量）", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ecn-dup-"))
    dirs.push(dir)
    await writeFile(path.join(dir, "a.json"), proposalOf({ id: "a" }), "utf8")
    await writeFile(path.join(dir, "b.json"), proposalOf({ id: "b" }), "utf8")

    const result = await loadProposals(dir, context())
    expect(result.total).toBe(2)
    expect(
      result.errors.some((issue) => issue.message.includes("指向同一页")),
      messages(result.errors)
    ).toBe(true)
  })

  it("不同 slug 的提案互不干扰", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ecn-nodup-"))
    dirs.push(dir)
    await writeFile(path.join(dir, "a.json"), proposalOf({ id: "a" }), "utf8")
    const other = proposalOf({ id: "b" }).replace(
      "v4/error-management/fallback",
      "v4/error-management/ghost"
    )
    await writeFile(path.join(dir, "b.json"), other, "utf8")

    const result = await loadProposals(dir, context())
    // ghost 不在导航清单里，会有结构错误，但**不应**出现"指向同一页"
    expect(result.errors.some((issue) => issue.message.includes("指向同一页"))).toBe(false)
  })
})

describe("落地（apply）：显式的人工动作，且必须挡住误覆盖", () => {
  const dirs: Array<string> = []
  const makeDocsDir = async (): Promise<string> => {
    const dir = await mkdtemp(path.join(tmpdir(), "ecn-apply-"))
    dirs.push(dir)
    return dir
  }

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop()
      if (dir !== undefined) await rm(dir, { recursive: true, force: true })
    }
  })

  const accepted = async () => {
    const result = await check(proposalOf())
    expect(result.errors).toEqual([])
    return result.proposal!
  }

  it("写入目标路径并落盘内容（含末尾换行）", async () => {
    const docsDir = await makeDocsDir()
    const written = await applyProposal(await accepted(), { docsDir, force: false })
    expect(written).toBe(path.join(docsDir, "v4/error-management/fallback.mdx"))
    const text = await readFile(written, "utf8")
    expect(text).toContain("upstreamPath: v4/error-management/fallback.mdx")
    expect(text.endsWith("\n")).toBe(true)
  })

  it("目标已存在时拒绝覆盖（除非显式 --force）—— 防止悄悄盖掉人类译文", async () => {
    const docsDir = await makeDocsDir()
    const proposal = await accepted()
    await applyProposal(proposal, { docsDir, force: false })

    await expect(applyProposal(proposal, { docsDir, force: false })).rejects.toThrow("目标已存在")
    // --force 才允许覆盖
    await expect(applyProposal(proposal, { docsDir, force: true })).resolves.toContain(
      "v4/error-management/fallback.mdx"
    )
  })

  it("没有 content 的提案（faq / glossary）不能落地为译文", async () => {
    const docsDir = await makeDocsDir()
    await expect(
      applyProposal(
        {
          id: "faq-1",
          kind: "faq",
          createdAt: "2026-09-10T00:00:00.000Z",
          draftedBy: { kind: "human", name: "tester" },
          rationale: "这是一条只作记录的 FAQ 提案，不产生译文文件。",
          target: {
            slug: "v4/error-management/fallback",
            upstreamPath: "v4/error-management/fallback.mdx"
          }
        },
        { docsDir, force: false }
      )
    ).rejects.toThrow("没有 content")
  })
})

describe("Agent 起草的内容必须过人工投稿的同一道闸", () => {
  it("命中术语黑名单（图层）→ 拒绝", async () => {
    const result = await check(
      proposalOf({ content: contentOf({ body: "这里把 Layer 译成了图层，应当被拦住。" }) })
    )
    expect(messages(result.errors)).toContain("内容门禁")
    expect(messages(result.errors)).toContain("图层")
  })

  it("content.upstreamPath 与 target.upstreamPath 不一致 → 拒绝", async () => {
    const bad = contentOf().replace(
      "upstreamPath: v4/error-management/fallback.mdx",
      "upstreamPath: v4/error-management/other.mdx"
    )
    const result = await check(proposalOf({ content: bad }))
    expect(messages(result.errors)).toContain("不一致")
  })

  it("残留上游工具元数据（twoslash）→ 拒绝", async () => {
    const result = await check(
      proposalOf({
        content: contentOf({ body: "示例：\n\n```ts twoslash\nconst x = 1\n```\n" })
      })
    )
    expect(messages(result.errors)).toContain("工具元数据")
  })

  it("status 缺失 → 拒绝", async () => {
    const noStatus = contentOf().replace("status: reviewing\n", "")
    const result = await check(proposalOf({ content: noStatus }))
    expect(messages(result.errors)).toContain("缺少 status")
  })
})
