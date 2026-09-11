/**
 * 报错解释（S2 v0）质量门禁：
 * - 能从真实报错里提取检索锚点；
 * - 有相关文档时给出引用（不臆测）；
 * - 未翻译主题诚实拒答并给英文原文；
 * - 完全无关的报错不得硬答。
 */
import { describe, expect, it } from "vitest"
import {
  composeExplanation,
  corpus,
  createCorpusIndex,
  createTopicRouter,
  extractIdentifiers,
  type CorpusPendingPage
} from "../src/index.js"

const index = createCorpusIndex(corpus)
const router = createTopicRouter(corpus.pages, corpus.pending)

/**
 * 合成"未翻译页面"：站点 234 页已全部译完，真实 pending 为空，
 * 因此这条"未翻译 → 拒答 + 给英文原文"的路径必须用合成语料才能持续验证。
 * 主题词 `zygo` 在已译语料里不存在，保证不会误判为已翻译。
 */
const syntheticPending: ReadonlyArray<CorpusPendingPage> = [
  {
    slug: "v4/schema/zygo-design",
    version: "v4",
    title: "Zygo Schema Design",
    sectionLabel: "Schema",
    upstreamPath: "v4/schema/zygo-design.mdx",
    officialUrl: "https://effect.website/docs/v4/schema/zygo-design"
  }
]
const syntheticRouter = createTopicRouter(corpus.pages, syntheticPending)

const explain = (errorText: string) =>
  composeExplanation({
    errorText,
    okHits: index.search(
      extractIdentifiers(errorText).join(" ") !== "" ? extractIdentifiers(errorText).join(" ") : errorText.slice(0, 200),
      { limit: 5 }
    ),
    pending: corpus.pending,
    router
  })

describe("extractIdentifiers", () => {
  it("提取模块限定 API、包名、错误码与错误类型", () => {
    const ids = extractIdentifiers(
      "TS2345: Argument of type 'Effect<number, never, never>' ... Effect.runPromise ... @effect/schema ... TypeError ... Layer.Layer<Foo, never, never>"
    )
    expect(ids).toContain("Effect.runPromise")
    expect(ids).toContain("@effect/schema")
    expect(ids).toContain("TS2345")
    expect(ids).toContain("TypeError")
    expect(ids).toContain("Layer.Layer")
  })

  it("无关文本不产生锚点（避免乱检索）", () => {
    expect(extractIdentifiers("The quick brown fox jumps over the lazy dog")).toEqual([])
  })
})

describe("composeExplanation", () => {
  it("报错涉及已译文 API → 给出引用，且不把它说成诊断结论", () => {
    const result = explain(
      "TS2345: Argument of type 'Effect<number, never, never>' is not assignable to parameter of type 'number'. Did you mean to call Effect.runPromise?"
    )
    expect(result.refused).toBe(false)
    expect(result.identifiers.length).toBeGreaterThan(0)
    expect(result.citations.length).toBeGreaterThan(0)
    expect(result.answer).toContain("最相关")
    expect(result.disclaimer).toContain("不是自动诊断结论")
  })

  it("报错涉及已翻译主题（Layer）→ 引用到《Layer 与依赖注入》", () => {
    const result = explain(
      "Type 'Layer.Layer<Database, never, never>' is not assignable to type 'Layer.Layer<never, never, never>'"
    )
    expect(result.refused).toBe(false)
    expect(result.citations.some((item) => item.slug.includes("requirements-management/layers"))).toBe(true)
  })

  it("报错涉及未翻译主题 → 拒答 + 官方英文原文（合成 pending 语料）", () => {
    const result = composeExplanation({
      // 带中文的真实形态报错（纯英文且无锚点会先被"不硬答"守卫拦下，那是另一条路径）
      errorText:
        "报错：类型不匹配 —— Type 'Zygo.Zygo<string>' is not assignable to type 'Zygo.Zygo<number>'",
      okHits: [],
      pending: syntheticPending,
      router: syntheticRouter
    })
    expect(result.refused).toBe(true)
    expect(result.citations).toEqual([])
    expect(result.refusal?.reason).toBe("untranslated")
    expect(result.refusal?.suggestions?.some((item) => item.slug.startsWith("v4/schema/"))).toBe(true)
  })

  it("完全无关的报错 → no-match 拒答并给出行动出口", () => {
    const result = explain("The quick brown fox jumps over the lazy dog")
    expect(result.refused).toBe(true)
    expect(result.refusal?.reason).toBe("no-match")
    expect(result.refusal?.message).toContain("Issue")
  })
})
