/**
 * 引用协议 · 构建期单测。
 *
 * 覆盖两层：
 * - 摘要算法（sha256 截断）必须是**真算法**，且地址与基线无关（否则译文更新会让历史引用失效）；
 * - `cite:check` 门禁必须真的能拦住坏数据（摘要错、地址冲突、指纹不符、缺产物）。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { Corpus, CorpusChunk } from "@ecn/knowledge"
import { citationDigest, contentHash, sha16 } from "../src/citation.js"
import { checkCitations } from "../src/cite-check.js"

const dirs: Array<string> = []

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

async function writeCorpus(corpus: Corpus): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ecn-cite-"))
  dirs.push(dir)
  const file = path.join(dir, "corpus.json")
  await writeFile(file, JSON.stringify(corpus), "utf8")
  return file
}

describe("摘要算法", () => {
  it("sha16 是真 sha256 的截断（可用任何语言复算）", () => {
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(sha16("abc")).toBe("ba7816bf8f01cfea")
    expect(sha16("")).toBe("e3b0c44298fc1c14")
  })

  it("引用地址与 baseline commit 无关（译文更新后旧引用不会 404）", () => {
    const a = citationDigest("v4/x/y", "某小节")
    expect(a).toBe(citationDigest("v4/x/y", "某小节"))
    expect(a).not.toBe(citationDigest("v4/x/y", "别的小节"))
    expect(a).not.toBe(citationDigest("v4/x/z", "某小节"))
    expect(a).toMatch(/^[0-9a-f]{16}$/)
  })

  it("内容指纹随正文变化", () => {
    expect(contentHash("原文")).toBe(contentHash("原文"))
    expect(contentHash("原文")).not.toBe(contentHash("原文改了"))
  })
})

function chunkOf(slug: string, index: number, anchor: string | undefined, text: string): CorpusChunk {
  const digest = anchor !== undefined ? citationDigest(slug, anchor) : undefined
  return {
    id: `${slug}#${index}`,
    slug,
    version: "v4",
    pageTitle: "测试页",
    headingPath: ["小节"],
    ...(anchor !== undefined ? { anchor } : {}),
    ...(digest !== undefined ? { citeDigest: digest, contentHash: contentHash(text) } : {}),
    text,
    hasCode: false
  }
}

function corpusOf(chunks: ReadonlyArray<CorpusChunk>, citations: number): Corpus {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    upstream: { repo: "Effect-TS/website", dir: "apps/web/src/content/docs", head: null, snapshotFiles: 0 },
    pages: [
      {
        slug: "v4/x/y",
        version: "v4",
        title: "测试页",
        status: "published",
        url: "/docs/v4/x/y/",
        officialUrl: "https://effect.website/docs/v4/x/y",
        markdown: "",
        chunks: [...chunks]
      }
    ],
    pending: [],
    stats: { pages: 1, chunks: chunks.length, pendingPages: 0, citations, upstreamHead: null }
  }
}

describe("cite:check 门禁", () => {
  it("健康语料 → 0 错误", async () => {
    const chunks = [chunkOf("v4/x/y", 0, "a", "第一段。"), chunkOf("v4/x/y", 1, "b", "第二段。")]
    const file = await writeCorpus(corpusOf(chunks, 2))
    const result = await checkCitations({ corpusFile: file })
    expect(result.errors).toEqual([])
    expect(result.citations).toBe(2)
  })

  it("摘要与 (slug, anchor) 不匹配 → 报错", async () => {
    const bad: CorpusChunk = { ...chunkOf("v4/x/y", 0, "a", "第一段。"), citeDigest: "0000000000000000" }
    const file = await writeCorpus(corpusOf([bad], 1))
    const result = await checkCitations({ corpusFile: file })
    expect(result.errors.some((issue) => issue.message.includes("不匹配"))).toBe(true)
  })

  it("两个小节抢同一地址 → 报错（引用会指向错误的证据）", async () => {
    const first = chunkOf("v4/x/y", 0, "a", "A。")
    const stolen: CorpusChunk = { ...chunkOf("v4/x/y", 1, "b", "B。"), citeDigest: first.citeDigest }
    const file = await writeCorpus(corpusOf([first, stolen], 1))
    const result = await checkCitations({ corpusFile: file })
    expect(result.errors.some((issue) => issue.message.includes("共用同一引用地址"))).toBe(true)
  })

  it("指纹与正文不符 → 报错（漂移检测会误报）", async () => {
    const bad: CorpusChunk = { ...chunkOf("v4/x/y", 0, "a", "第一段。"), contentHash: "ffffffffffffffff" }
    const file = await writeCorpus(corpusOf([bad], 1))
    const result = await checkCitations({ corpusFile: file })
    expect(result.errors.some((issue) => issue.message.includes("contentHash"))).toBe(true)
  })

  it("同一小节的多个切片必须共享引用元信息（小节 = 一个地址）", async () => {
    const [a, b] = ["第一段。", "第二段。"]
    const sectionText = `${a}\n\n${b}`
    const shared = { citeDigest: citationDigest("v4/x/y", "a"), contentHash: contentHash(sectionText) }
    const chunks: ReadonlyArray<CorpusChunk> = [
      { ...chunkOf("v4/x/y", 0, "a", a), ...shared },
      { ...chunkOf("v4/x/y", 1, "a", b), ...shared }
    ]
    const file = await writeCorpus(corpusOf(chunks, 1))
    const result = await checkCitations({ corpusFile: file })
    expect(result.errors).toEqual([])
    expect(result.citations).toBe(1)
  })

  it("页级切片不该带引用字段 → 报错", async () => {
    const bad: CorpusChunk = {
      ...chunkOf("v4/x/y", 0, undefined, "无锚点正文。"),
      citeDigest: "aaaaaaaaaaaaaaaa"
    }
    const file = await writeCorpus(corpusOf([bad], 1))
    const result = await checkCitations({ corpusFile: file })
    expect(result.errors.some((issue) => issue.message.includes("无锚点却带引用字段"))).toBe(true)
  })

  it("语料统计与实际不一致 → 报错", async () => {
    const chunks = [chunkOf("v4/x/y", 0, "a", "第一段。")]
    const file = await writeCorpus(corpusOf(chunks, 7))
    const result = await checkCitations({ corpusFile: file })
    expect(result.errors.some((issue) => issue.message.includes("stats.citations"))).toBe(true)
  })
})
