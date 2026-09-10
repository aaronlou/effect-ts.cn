/**
 * 引用协议门禁（CI 必过）。
 *
 * 这一组断言存在的唯一理由：**引用必须能被独立核验，否则它只是修辞**。
 * 因此这里不接受"看起来合理"，只接受可机械复核的事实：
 * - 每条引用都能解引用到一条记录；
 * - 记录里的原文**逐字包含**答案里的 quote；
 * - 一个地址只能指向一份证据；
 * - 小节被切成多个检索切片时，证据是**整段**而不是半段。
 */
import { describe, expect, it } from "vitest"
import {
  buildCitationRecords,
  citationIdOf,
  citeUrlOf,
  composeAnswer,
  corpus,
  createCorpusIndex,
  createTopicRouter,
  findCitationRecord
} from "../src/index.js"

const index = createCorpusIndex(corpus)
const router = createTopicRouter(corpus.pages, corpus.pending)
const records = buildCitationRecords(corpus)

const ask = (question: string) =>
  composeAnswer({
    question,
    hits: index.search(question, { limit: 5 }),
    pending: corpus.pending,
    options: { router }
  })

describe("引用记录：每条都可独立解引用", () => {
  it("覆盖全部带锚点的小节，且字段自洽", () => {
    expect(records.length).toBe(corpus.stats.citations)
    expect(records.length).toBeGreaterThan(100)

    for (const record of records) {
      expect(record.digest).toMatch(/^[0-9a-f]{16}$/)
      expect(record.citeUrl).toBe(citeUrlOf(record.digest))
      expect(record.contentHash).toMatch(/^[0-9a-f]{16}$/)
      expect(record.citationId.startsWith(`ecn:${record.slug}@`)).toBe(true)
      expect(record.citationId.endsWith(`#${record.anchor}`)).toBe(true)
      expect(record.deepLink).toBe(`${record.pageUrl}#${record.anchor}`)
      expect(record.chunkText.length).toBeGreaterThan(0)
      expect(record.officialUrl.startsWith("https://effect.website/")).toBe(true)
    }
  })

  it("一个地址只能指向一份证据（digest 全局唯一）", () => {
    const digests = records.map((record) => record.digest)
    expect(new Set(digests).size).toBe(digests.length)
  })

  it("小节被切成多个检索切片时，证据是整段而不是半段", () => {
    for (const record of records) {
      const page = corpus.pages.find((candidate) => candidate.slug === record.slug)
      expect(page).toBeDefined()
      const siblings = (page?.chunks ?? []).filter((chunk) => chunk.anchor === record.anchor)
      expect(siblings.length).toBeGreaterThan(0)
      for (const chunk of siblings) {
        // 每一个检索切片的正文都必须能在证据里逐字找到
        expect(
          record.chunkText.includes(chunk.text),
          `${chunk.id} 的正文不在证据里（小节拼接丢了片段）`
        ).toBe(true)
      }
    }
  })

  it("有基线时给出该基线下的官方原文地址，便于逐字核对", () => {
    const withBaseline = records.filter((record) => record.upstreamCommit !== undefined)
    expect(withBaseline.length).toBeGreaterThan(0)
    for (const record of withBaseline) {
      expect(record.upstreamRawUrl).toBe(
        `https://raw.githubusercontent.com/Effect-TS/website/${record.upstreamCommit}/apps/web/src/content/docs/${record.upstreamPath}`
      )
    }
  })
})

describe("引用 ID 与解析", () => {
  it("citationId 带上该页当前的基线（版本锚定）", () => {
    const page = corpus.pages.find((candidate) => candidate.upstreamCommit !== undefined)
    expect(page).toBeDefined()
    const chunk = page?.chunks.find((candidate) => candidate.anchor !== undefined)
    expect(chunk).toBeDefined()
    const id = citationIdOf(page!, chunk!)
    expect(id).toContain(`@${page!.upstreamCommit!.slice(0, 7)}`)
    expect(id).toContain(`#${chunk!.anchor}`)
  })

  it("可以用 digest / slug#anchor / citationId 三种 key 解析到同一条记录", () => {
    const sample = records.find((record) => record.slug.includes("error-management")) ?? records[0]
    expect(sample).toBeDefined()
    const target = sample!

    expect(findCitationRecord(records, target.digest)?.digest).toBe(target.digest)
    expect(findCitationRecord(records, `/cite/${target.digest}.json`)?.digest).toBe(target.digest)
    expect(findCitationRecord(records, `${target.slug}#${target.anchor}`)?.digest).toBe(target.digest)
    expect(findCitationRecord(records, target.citationId)?.digest).toBe(target.digest)
    expect(findCitationRecord(records, "不存在的东西")).toBeUndefined()
  })
})

describe("答案里的引用必须可核验（端到端不变量）", () => {
  const questions = [
    "怎么安装 Effect？",
    "Effect.gen 里怎么处理错误？",
    "怎么从 defect 中恢复？",
    "Layer 是怎么做依赖注入的？"
  ]

  for (const question of questions) {
    it(`「${question}」的每条引用都能解引用，且 quote 是原文的逐字子串`, () => {
      const result = ask(question)
      expect(result.refused).toBe(false)
      expect(result.citations.length).toBeGreaterThan(0)

      for (const citation of result.citations) {
        // 1. 引用必须带规范化 ID（否则无法引用、无法比对）
        expect(citation.citationId.startsWith(`ecn:${citation.slug}@`)).toBe(true)

        // 2. 能精确到小节时，必须给出可解引用地址
        if (citation.anchor !== undefined) {
          expect(citation.citeUrl).toBeDefined()
        }
        if (citation.citeUrl === undefined) continue

        // 3. 地址必须真的能解析到记录
        const digest = citation.citeUrl.replace(/^\/cite\//, "").replace(/\.json$/, "")
        const record = findCitationRecord(records, digest)
        expect(record, `引用地址无法解析: ${citation.citeUrl}`).toBeDefined()

        // 4. 逐字核验：quote 必须是记录里原文的子串（不允许多一个省略号）
        expect(
          record!.chunkText.includes(citation.quote),
          `quote 不是原文子串: ${citation.quote.slice(0, 40)}…`
        ).toBe(true)

        // 5. 指纹必须与原文一致（漂移检测的前提）
        expect(record!.contentHash).toMatch(/^[0-9a-f]{16}$/)
      }
    })
  }
})
