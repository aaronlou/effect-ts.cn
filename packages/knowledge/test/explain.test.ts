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
  extractIdentifiers
} from "../src/index.js"

const index = createCorpusIndex(corpus)
const router = createTopicRouter(corpus.pages, corpus.pending)

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

  it("报错涉及未翻译主题（Schema）→ 拒答 + 官方英文原文", () => {
    const result = explain(
      "Type 'Schema.Schema<string, string, never>' is not assignable to type 'Schema.Schema<number, number, never>'"
    )
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
