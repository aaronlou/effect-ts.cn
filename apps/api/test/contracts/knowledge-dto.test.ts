/**
 * 契约序列化测试（无需起 HTTP 服务）。
 *
 * 为什么测这个：`CitationDto` 是**对外承诺的 wire 形状**。如果 `citationId` / `citeUrl`
 * 不在契约里，HttpApi 编码时会把它们丢掉 —— 表面上"接口能跑"，但 Agent 拿到的引用
 * 就再也无法核验了。这类问题靠类型检查抓不到（`satisfies` 不会检查多余字段），
 * 只能靠序列化断言。
 *
 * 断言的是**不变量**，不是实现：
 * 1. 引用跨过 wire 之后，citationId 与 citeUrl 必须还在；
 * 2. 一条没有 citationId 的引用**不能被编码** —— 不可核验的引用不该出现在任何输出里。
 */
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { AskResponseDto } from "@ecn/contracts"

const citation = {
  citationId: "ecn:v4/error-management/unexpected-errors@16b1646#catchdefect",
  citeUrl: "/cite/c687fea774713640.json",
  slug: "v4/error-management/unexpected-errors",
  version: "v4",
  title: "意外错误",
  url: "/docs/v4/error-management/unexpected-errors/",
  officialUrl: "https://effect.website/docs/v4/error-management/unexpected-errors",
  commit: "16b1646850ded8b32b8b86bbdd941092d55d8f24",
  status: "published",
  anchor: "catchdefect",
  quote: "Effect.catchDefect 只处理 defect。"
}

const response = {
  question: "怎么从 defect 中恢复？",
  mode: "extractive" as const,
  answer: "站内中文译文里，与这个问题最相关的是：\n1. 《意外错误》› catchDefect",
  citations: [citation],
  refused: false,
  stalePages: [],
  disclaimer: "以上内容由站内中文译文检索合成。"
}

describe("AskResponseDto 的 wire 形状", () => {
  it("引用跨过序列化后，citationId 与 citeUrl 仍在（否则 Agent 无法核验）", () => {
    const encoded = Schema.encodeSync(AskResponseDto)(response) as {
      citations: ReadonlyArray<Record<string, unknown>>
    }
    expect(encoded.citations[0]?.["citationId"]).toBe(citation.citationId)
    expect(encoded.citations[0]?.["citeUrl"]).toBe(citation.citeUrl)
  })

  it("缺少 citationId 的引用无法编码（不可核验的引用不得出现在输出里）", () => {
    const broken = {
      ...response,
      citations: [
        {
          slug: citation.slug,
          version: citation.version,
          title: citation.title,
          url: citation.url,
          officialUrl: citation.officialUrl,
          status: citation.status,
          quote: citation.quote
        }
      ]
    }
    expect(() => Schema.encodeSync(AskResponseDto)(broken as never)).toThrow()
  })
})
