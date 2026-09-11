/**
 * 多路检索融合（RRF）的单元测试。
 *
 * 这是"白话查不到"那一刀的底座：模型把问题改写成若干条术语化查询后，
 * 各自的检索结果要能**确定性地**并成一路，且不能丢掉任何一路的命中
 * （漏掉 = 制造"模型说没有、其实文档里有"的假拒答）。
 */
import { describe, expect, it } from "vitest"
import { applyOrder, fuseHits, RRF_K, type CorpusChunk, type CorpusPage, type SearchHit } from "../src/index.js"

const page = (slug: string, title: string): CorpusPage =>
  ({
    slug,
    version: slug.startsWith("v3") ? "v3" : "v4",
    title,
    url: `/docs/${slug}/`,
    officialUrl: `https://effect.website/docs/${slug}`,
    status: "published"
  }) as CorpusPage

const hit = (slug: string, index: number, score: number): SearchHit => {
  const chunk: CorpusChunk = {
    id: `${slug}#${index}`,
    slug,
    version: slug.startsWith("v3") ? "v3" : "v4",
    pageTitle: slug,
    headingPath: [`小节${index}`],
    text: `第 ${index} 段正文`,
    hasCode: false
  }
  return { chunk, page: page(slug, slug), score }
}

describe("fuseHits（RRF 融合）", () => {
  it("只出现在某一路的命中不会被丢掉", () => {
    const fused = fuseHits([[hit("a", 0, 9)], [hit("b", 0, 1)]])
    expect(fused.map((entry) => entry.chunk.id).sort()).toEqual(["a#0", "b#0"])
  })

  it("两路都排第一的命中，胜过只在一路排第一的命中", () => {
    const both = hit("both", 0, 5)
    const fused = fuseHits([
      [both, hit("only-a", 0, 8)],
      [both, hit("only-b", 0, 8)]
    ])
    expect(fused[0]?.chunk.id).toBe("both#0")
  })

  it("同一路的排名越靠前，融合分越高（名次可比，分数不可比）", () => {
    const fused = fuseHits([[hit("a", 0, 1), hit("a", 1, 99)]])
    expect(fused[0]?.chunk.id).toBe("a#0")
  })

  it("score 保留最强的 BM25 分，而不是 RRF 分（否则 minScore 门禁会把一切都判成弱）", () => {
    const fused = fuseHits([[hit("a", 0, 7.5)]])
    expect(fused[0]?.score).toBe(7.5)
    // RRF 分只有 1/(k+1) ≈ 0.016，绝不能拿它当 score
    expect(1 / (RRF_K + 1)).toBeLessThan(0.05)
  })

  it("同一路里重复出现的切片按身份去重，融合分累加", () => {
    const fused = fuseHits([[hit("a", 0, 3), hit("a", 0, 3)]])
    expect(fused.length).toBe(1)
    expect(fused[0]?.score).toBe(3)
  })

  it("完全确定性：同样的输入给出同样的顺序", () => {
    const first = fuseHits([[hit("a", 0, 3), hit("b", 0, 3)], [hit("c", 0, 3)]])
    const second = fuseHits([[hit("a", 0, 3), hit("b", 0, 3)], [hit("c", 0, 3)]])
    expect(first.map((entry) => entry.chunk.id)).toEqual(second.map((entry) => entry.chunk.id))
  })
})

describe("applyOrder（模型重排：只换顺序，不增删）", () => {
  const hits = [hit("a", 0, 1), hit("b", 0, 1), hit("c", 0, 1)]

  it("按给定顺序重排窗口内的候选", () => {
    const reordered = applyOrder(hits, [2, 0, 1], 3)
    expect(reordered.map((entry) => entry.chunk.id)).toEqual(["c#0", "a#0", "b#0"])
  })

  it("模型漏掉的编号（重排输出残缺）不会让候选消失", () => {
    const reordered = applyOrder(hits, [2], 3)
    expect(reordered.map((entry) => entry.chunk.id)).toEqual(["c#0", "a#0", "b#0"])
  })

  it("非法编号与重复编号被忽略，集合与长度不变", () => {
    const reordered = applyOrder(hits, [1, 1, 99, -3], 3)
    expect(reordered.map((entry) => entry.chunk.id)).toEqual(["b#0", "a#0", "c#0"])
  })

  it("窗口之外的候选保持原样追加", () => {
    const four = [...hits, hit("d", 0, 1)]
    const reordered = applyOrder(four, [1, 0], 2)
    expect(reordered.map((entry) => entry.chunk.id)).toEqual(["b#0", "a#0", "c#0", "d#0"])
  })
})
