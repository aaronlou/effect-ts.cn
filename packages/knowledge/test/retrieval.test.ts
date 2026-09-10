/**
 * 检索与答案质量门禁（CI 必过）。
 *
 * 这是"AI 可信"的第一道闸：
 * - recall@3：中文自然提问能否命中正确的官方页面；
 * - 拒答正确性：站内没有的内容必须拒答，且要区分"文档没有"与"中文尚未翻译"；
 * - 引用不变量：引用必须解析到真实页面（有锚点时还要能在该页锚点集合里找到）；
 * - 术语合规：答案文本必须过与译文相同的术语黑名单。
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  composeAnswer,
  corpus,
  createCorpusIndex,
  createTopicRouter,
  matchPendingPages
} from "../src/index.js"

const index = createCorpusIndex(corpus)
const router = createTopicRouter(corpus.pages, corpus.pending)

/** 与生产一致：所有答案组装都带上话题路由 */
const ask = (question: string, limit = 5) =>
  composeAnswer({
    question,
    hits: index.search(question, { limit }),
    pending: corpus.pending,
    options: { router }
  })

/** 语料里的真实锚点集合（用于校验引用可解析） */
function anchorsOf(slug: string): ReadonlySet<string> {
  const page = corpus.pages.find((candidate) => candidate.slug === slug)
  if (page === undefined) return new Set()
  return new Set(page.chunks.flatMap((chunk) => (chunk.anchor !== undefined ? [chunk.anchor] : [])))
}

const GOLDEN: ReadonlyArray<{ question: string; expectedSlug: string }> = [
  { question: "怎么安装 Effect？", expectedSlug: "v4/getting-started/installation" },
  { question: "为什么应该选择 Effect 而不是直接用 Promise？", expectedSlug: "v4/getting-started/why-effect" },
  { question: "Effect.gen 里怎么处理错误？", expectedSlug: "v4/getting-started/using-generators" },
  { question: "怎么运行一个 Effect？", expectedSlug: "v4/getting-started/running-effects" },
  { question: "怎么把 Promise 或者回调函数包成 Effect？", expectedSlug: "v4/getting-started/creating-effects" },
  { question: "pipe 管道怎么把多个操作组合起来？", expectedSlug: "v4/getting-started/building-pipelines" },
  { question: "Effect 类型上的三个类型参数分别是什么？", expectedSlug: "v4/getting-started/the-effect-type" },
  { question: "怎么按需导入 effect 的模块和函数？", expectedSlug: "v4/getting-started/importing-effect" },
  { question: "VS Code 插件和语言服务怎么安装？", expectedSlug: "v4/getting-started/devtools" },
  { question: "Effect.runSync 和 runPromise 有什么区别？", expectedSlug: "v4/getting-started/running-effects" },
  { question: "创建 Effect 有哪些方法？succeed 和 sync 的区别？", expectedSlug: "v4/getting-started/creating-effects" },
  { question: "新手应该从哪里开始学 Effect？", expectedSlug: "v4/onboarding" }
]

describe("检索质量（recall@3）", () => {
  for (const { question, expectedSlug } of GOLDEN) {
    it(`「${question}」→ ${expectedSlug}`, () => {
      const hits = index.search(question, { limit: 3 })
      const slugs = hits.map((hit) => hit.page.slug)
      expect(slugs, `实际 top3: ${slugs.join(", ")}`).toContain(expectedSlug)
    })
  }
})

describe("拒答：站内没有 vs 中文尚未翻译", () => {
  it("未翻译主题（Schema 数据校验）→ 拒答并给出英文原文建议", () => {
    const result = ask("Schema 是怎么做数据校验的？")
    expect(result.refused).toBe(true)
    expect(result.citations).toEqual([])
    expect(result.refusal?.reason).toBe("untranslated")
    expect(result.refusal?.suggestions?.some((item) => item.slug.startsWith("v4/schema/"))).toBe(true)
  })

  it("已翻译主题（Layer 依赖注入）→ 不得再判为未翻译", () => {
    const result = ask("Layer 是怎么做依赖注入的？")
    expect(result.refused).toBe(false)
    expect(result.citations.some((item) => item.slug.includes("requirements-management/layers"))).toBe(true)
  })

  it("定义型问题（Fiber 是什么）→ 优先定义小节，而不是同页的操作小节", () => {
    const result = ask("Fiber 是什么？")
    expect(result.refused).toBe(false)
    const first = result.citations[0]
    expect(first?.slug).toContain("concurrency/fibers")
    expect(first?.anchor ?? "").toMatch(/什么|虚拟线程/)
  })

  it("完全无关的问题 → no-match 拒答，且不产生任何引用", () => {
    const result = ask("今天北京的天气怎么样？")
    expect(result.refused).toBe(true)
    expect(result.citations).toHaveLength(0)
    expect(result.refusal?.reason).toBe("no-match")
    expect(result.answer).toBe("")
  })

  it("未翻译页面的标题匹配：matchPendingPages 能定位到官方页面", () => {
    const matches = matchPendingPages("Fiber 是什么？", corpus.pending)
    expect(matches.some((page) => page.slug.includes("concurrency/fibers"))).toBe(true)
  })
})

describe("话题归属（话题拥有者决定「回答」还是「诚实拒答」）", () => {
  it("Layer → translated（已有中文页）", () => {
    const route = router.route("Layer 怎么做依赖注入？")
    expect(route.kind).toBe("translated")
    if (route.kind === "translated") {
      expect(route.slugs).toContain("v4/requirements-management/layers")
    }
  })

  it("Fiber → translated（已有中文页）", () => {
    const route = router.route("Fiber 是什么？")
    expect(route.kind).toBe("translated")
    if (route.kind === "translated") {
      expect(route.slugs).toContain("v4/concurrency/fibers")
    }
  })

  it("Schema → pending：章节级话题（几十个页面 slug 都含 schema）也要能定位", () => {
    const route = router.route("怎么用 Schema 校验数据？")
    expect(route.kind).toBe("pending")
    if (route.kind === "pending") {
      expect(route.pages[0]?.slug.startsWith("v4/schema/")).toBe(true)
    }
  })

  it("Stream → pending，且建议优先给 v4 页面", () => {
    const route = router.route("Stream 怎么处理流式数据？")
    expect(route.kind).toBe("pending")
    if (route.kind === "pending") {
      expect(route.pages.some((page) => page.version === "v4" && page.slug.includes("stream"))).toBe(true)
    }
  })

  it("安装 → 已翻译（不得误判为未翻译）", () => {
    const route = router.route("怎么安装 Effect？")
    expect(route.kind).toBe("translated")
    if (route.kind === "translated") {
      expect(route.slugs).toContain("v4/getting-started/installation")
    }
  })

  it("无关问题 → none", () => {
    expect(router.route("今天北京的天气怎么样？").kind).toBe("none")
  })

  it("已知可回答问题仍能正常作答（话题路由不误伤）", () => {
    for (const { question } of GOLDEN) {
      const result = ask(question)
      expect(result.refused, `不应拒答: ${question}`).toBe(false)
    }
  })
})

describe("话题拥有者优先（归属页应排在顺带提及之前）", () => {
  it("「怎么安装 Effect？」头号命中是《安装》", () => {
    const question = "怎么安装 Effect？"
    const route = router.route(question)
    const boostSlugs = route.kind === "translated" ? route.slugs : []
    const hits = index.search(question, { limit: 3, boostSlugs })
    expect(hits[0]?.page.slug).toBe("v4/getting-started/installation")
  })
})

describe("引用不变量", () => {
  const answerable = GOLDEN.slice(0, 6)

  for (const { question } of answerable) {
    it(`「${question}」的引用可解析到真实页面与锚点`, () => {
      const result = ask(question)
      expect(result.refused).toBe(false)
      expect(result.citations.length).toBeGreaterThan(0)
      for (const citation of result.citations) {
        const page = corpus.pages.find((candidate) => candidate.slug === citation.slug)
        expect(page, `引用页面不存在: ${citation.slug}`).toBeDefined()
        expect(citation.url).toBe(`/docs/${citation.slug}/`)
        expect(citation.quote.length).toBeGreaterThan(0)
        if (citation.anchor !== undefined) {
          expect(anchorsOf(citation.slug).has(citation.anchor), `锚点不存在: ${citation.slug}#${citation.anchor}`).toBe(
            true
          )
        }
      }
    })
  }
})

describe("术语合规（AI 输出也必须守社区术语）", () => {
  const glossary = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "../../../docs/glossary.json"), "utf8")
  ) as { forbidden: ReadonlyArray<{ term: string }> }

  it("答案文本不包含任何禁用译法", () => {
    for (const { question } of GOLDEN) {
      const result = ask(question)
      for (const rule of glossary.forbidden) {
        expect(result.answer.includes(rule.term), `答案出现了禁用词「${rule.term}」: ${question}`).toBe(false)
      }
    }
  })
})

describe("语料自身的一致性", () => {
  it("统计信息与实际内容一致", () => {
    expect(corpus.stats.pages).toBe(corpus.pages.length)
    expect(corpus.stats.chunks).toBe(
      corpus.pages.reduce((sum, page) => sum + page.chunks.length, 0)
    )
    expect(corpus.stats.pendingPages).toBe(corpus.pending.length)
  })

  it("每个切片都有 slug/version/标题路径字段，且 id 唯一", () => {
    const ids = new Set<string>()
    for (const page of corpus.pages) {
      for (const chunk of page.chunks) {
        expect(chunk.slug).toBe(page.slug)
        expect(chunk.version).toBe(page.version)
        expect(chunk.text.length).toBeGreaterThan(0)
        expect(ids.has(chunk.id)).toBe(false)
        ids.add(chunk.id)
      }
    }
  })
})

describe("顺带提及不算依据（只蹭到一个正文词 ⇒ 拒答）", () => {
  it("「推荐一部科幻电影」→ no-match（此前会引用正文里的「推荐使用 TypeScript」）", () => {
    const result = ask("推荐一部科幻电影")
    expect(result.refused).toBe(true)
    expect(result.refusal?.reason).toBe("no-match")
    expect(result.citations).toEqual([])
  })

  it("对照：单个词命中**标题**时仍然作答（「怎么安装 Effect？」）", () => {
    const result = ask("怎么安装 Effect？")
    expect(result.refused).toBe(false)
    expect(result.citations.some((item) => item.slug.includes("installation"))).toBe(true)
  })
})

describe("拒答也要给下一步（relatedPages 不是引用）", () => {
  it("弱相关命中存在时，no-match 会附上「最接近的页面」供人继续看", () => {
    // 「怎么用 Effect 处理大数据量」在站内没有直接依据，但会弱命中若干页面
    const result = ask("怎么用 Effect 处理大数据量？")
    if (result.refused) {
      expect(result.citations).toEqual([])
      const related = result.refusal?.relatedPages ?? []
      for (const page of related) {
        expect(page.url.startsWith("/docs/")).toBe(true)
        expect(page.slug.length).toBeGreaterThan(0)
      }
    } else {
      // 若语料变强后能作答，则必须带引用（不允许"无引用的答案"）
      expect(result.citations.length).toBeGreaterThan(0)
    }
  })

  it("完全无关的问题不得给出「最接近的页面」（不许硬凑）", () => {
    const result = ask("推荐一部科幻电影")
    expect(result.refused).toBe(true)
    expect(result.refusal?.relatedPages ?? []).toEqual([])
  })
})
