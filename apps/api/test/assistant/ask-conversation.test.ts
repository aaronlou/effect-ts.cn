/**
 * 多轮对话 + 检索升级的不变量（仍然零 Key：模型能力用 stub 注入）。
 *
 * 这一层要钉死的事：
 * 1. **零 Key 完全退化**：没有任何模型能力时，行为与单轮 extractive 一模一样；
 * 2. 模型能碰的只有"查询"与"候选顺序"，碰不到"引用"；
 * 3. 每一步模型能力失败/缺失 ⇒ 只是这一步不做，问答照常；
 * 4. 缓存键含 history —— 追问与首问即便字面相同也不共用条目。
 */
import { describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import {
  askQuestion,
  cacheKey,
  historyFingerprint
} from "../../src/contexts/assistant/application/use-cases/ask-question"
import { AnswerCache } from "../../src/contexts/assistant/application/ports/answer-cache"
import { Glossary } from "../../src/contexts/assistant/application/ports/glossary"
import { Llm, type LlmService } from "../../src/contexts/assistant/application/ports/llm"
import { makeAnswerCacheLive } from "../../src/contexts/assistant/infrastructure/answer-cache-live"
import { KnowledgeBaseLive } from "../../src/contexts/knowledge/infrastructure/knowledge-base-live"

const GlossaryStub = Layer.succeed(Glossary, {
  forbidden: ["纤维", "图层", "效果系统"],
  termCount: 3,
  source: "test"
})

const cacheLayer = makeAnswerCacheLive({ capacity: 50, ttlMillis: 60_000 })

const run = <A, E>(effect: Effect.Effect<A, E, unknown>) =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>)

const layerWith = (llm: LlmService) => Layer.mergeAll(KnowledgeBaseLive, Layer.succeed(Llm, llm), cacheLayer, GlossaryStub)

/** 「怎么让两件事同时跑？」是实测里 BM25 查不到的白话（拒答），用来验证"扩展查询"这一刀 */
const COLLOQUIAL = "怎么让两件事同时跑？"

describe("零 Key：整条链退化成单轮 extractive", () => {
  it("没有任何模型能力时，既有问答行为不变（且不会去调用不存在的能力）", async () => {
    let composeCalls = 0
    const stub: LlmService = {
      enabled: false,
      model: "extractive",
      composeAnswer: () => {
        composeCalls += 1
        return Effect.succeed(undefined)
      }
    }
    const result = await run(
      askQuestion({ question: "怎么安装 Effect？", history: [{ question: "Effect 是什么", citations: [] }] }).pipe(
        Effect.provide(layerWith(stub))
      )
    )
    expect(result.refused).toBe(false)
    expect(result.mode).toBe("extractive")
    expect(result.citations.length).toBeGreaterThan(0)
    expect(result.resolvedQuestion).toBeUndefined()
    expect(result.expandedQueries).toBeUndefined()
    // enabled=false ⇒ 连润色都不进
    expect(composeCalls).toBe(0)
  })

  it("零 Key 下白话问题仍然拒答（不假装找到了）", async () => {
    const stub: LlmService = { enabled: false, model: "extractive", composeAnswer: () => Effect.succeed(undefined) }
    const result = await run(askQuestion({ question: COLLOQUIAL }).pipe(Effect.provide(layerWith(stub))))
    expect(result.refused).toBe(true)
    expect(result.citations).toEqual([])
  })
})

describe("多轮：指代消解（把追问改写成独立查询）", () => {
  it("带 history 的追问先改写再检索，并把 resolvedQuestion 回传", async () => {
    const seen: Array<ReadonlyArray<{ question: string }>> = []
    const stub: LlmService = {
      enabled: true,
      model: "stub",
      rewriteQuery: (input) => {
        seen.push(input.history)
        return Effect.succeed("怎么安装 Effect？")
      },
      composeAnswer: () => Effect.succeed(undefined)
    }
    const result = await run(
      askQuestion({
        question: "它怎么装？",
        history: [
          {
            question: "Effect 是什么？",
            citations: [{ slug: "v4/getting-started/why-effect", title: "为什么选择 Effect？", anchor: "intro" }]
          }
        ]
      }).pipe(Effect.provide(layerWith(stub)))
    )
    expect(seen.length).toBe(1)
    expect(seen[0]?.[0]?.question).toBe("Effect 是什么？")
    expect(result.resolvedQuestion).toBe("怎么安装 Effect？")
    expect(result.refused).toBe(false)
    expect(result.citations.length).toBeGreaterThan(0)
  })

  it("改写失败（undefined）⇒ 退回原问题，不报错、不产生 resolvedQuestion", async () => {
    const stub: LlmService = {
      enabled: true,
      model: "stub",
      rewriteQuery: () => Effect.succeed(undefined),
      composeAnswer: () => Effect.succeed(undefined)
    }
    const result = await run(
      askQuestion({
        question: "怎么安装 Effect？",
        history: [{ question: "上文", citations: [] }]
      }).pipe(Effect.provide(layerWith(stub)))
    )
    expect(result.resolvedQuestion).toBeUndefined()
    expect(result.refused).toBe(false)
  })

  it("没有 history 时不调用改写（省一次模型往返）", async () => {
    let rewriteCalls = 0
    const stub: LlmService = {
      enabled: true,
      model: "stub",
      rewriteQuery: () => {
        rewriteCalls += 1
        return Effect.succeed("不该被调用")
      },
      composeAnswer: () => Effect.succeed(undefined)
    }
    await run(askQuestion({ question: "怎么安装 Effect？" }).pipe(Effect.provide(layerWith(stub))))
    expect(rewriteCalls).toBe(0)
  })
})

describe("检索升级：术语化扩展 + RRF 融合", () => {
  it("白话问题：无扩展时拒答，扩展后作答，并回传用过的查询", async () => {
    const withoutExpansion = await run(
      askQuestion({ question: COLLOQUIAL }).pipe(
        Effect.provide(
          layerWith({ enabled: true, model: "stub", composeAnswer: () => Effect.succeed(undefined) })
        )
      )
    )
    expect(withoutExpansion.refused).toBe(true)

    const withExpansion = await run(
      askQuestion({ question: COLLOQUIAL }).pipe(
        Effect.provide(
          layerWith({
            enabled: true,
            model: "stub",
            expandQueries: () => Effect.succeed(["Fiber 并发", "Effect 同时执行两个任务"]),
            composeAnswer: () => Effect.succeed(undefined)
          })
        )
      )
    )
    expect(withExpansion.refused).toBe(false)
    expect(withExpansion.citations.length).toBeGreaterThan(0)
    expect(withExpansion.expandedQueries).toEqual(["Fiber 并发", "Effect 同时执行两个任务"])
    // 引用仍然来自检索（站内页面），不是模型编的
    for (const citation of withExpansion.citations) {
      expect(citation.url.startsWith("/docs/")).toBe(true)
      expect(citation.quote.length).toBeGreaterThan(0)
    }
  })

  it("扩展查询并不能把没有的内容变出来：仍无依据 ⇒ 拒答，且不进合成模型", async () => {
    let composeCalls = 0
    const result = await run(
      askQuestion({ question: "今天北京的天气怎么样？" }).pipe(
        Effect.provide(
          layerWith({
            enabled: true,
            model: "stub",
            expandQueries: () => Effect.succeed(["天气 北京 气温"]),
            composeAnswer: () => {
              composeCalls += 1
              return Effect.succeed("今天晴，25 度。")
            }
          })
        )
      )
    )
    expect(result.refused).toBe(true)
    expect(result.answer).toBe("")
    expect(composeCalls).toBe(0)
  })

  it("检索已经够强时不调用扩展（省 token）", async () => {
    let expandCalls = 0
    const result = await run(
      askQuestion({ question: "怎么安装 Effect？" }).pipe(
        Effect.provide(
          layerWith({
            enabled: true,
            model: "stub",
            expandQueries: () => {
              expandCalls += 1
              return Effect.succeed(["不该被调用"])
            },
            composeAnswer: () => Effect.succeed(undefined)
          })
        )
      )
    )
    expect(result.refused).toBe(false)
    expect(expandCalls).toBe(0)
  })
})

describe("重排：只换顺序，不增删候选", () => {
  it("模型给的顺序生效，且引用仍全部来自站内检索", async () => {
    const question = "Layer 怎么做依赖注入？"
    const baseline = await run(
      askQuestion({ question, maxCitations: 3 }).pipe(
        Effect.provide(
          layerWith({ enabled: true, model: "stub", composeAnswer: () => Effect.succeed(undefined) })
        )
      )
    )
    expect(baseline.citations.length).toBeGreaterThan(1)

    const reversed = await run(
      askQuestion({ question, maxCitations: 3 }).pipe(
        Effect.provide(
          layerWith({
            enabled: true,
            model: "stub",
            // 把候选整体倒过来：应当只改变顺序
            rerank: (input) => Effect.succeed(input.candidates.map((_, index) => index).reverse()),
            composeAnswer: () => Effect.succeed(undefined)
          })
        )
      )
    )
    // 顺序确实变了（候选池比引用位多，倒序会把原本第 4、5 名提上来）
    expect(reversed.citations[0]?.citationId).not.toBe(baseline.citations[0]?.citationId)
    // 但引用仍然只能来自检索：站内地址 + 逐字原文
    for (const citation of reversed.citations) {
      expect(citation.url.startsWith("/docs/")).toBe(true)
      expect(citation.quote.length).toBeGreaterThan(0)
    }
  })

  /**
   * 回归（写这条测试时真的踩到了）：模型候选里**没有版本信息**，
   * 一旦"先重排、再去重"，同一次检索的引用就会在 v4 / v3 之间漂移。
   * 因此 assistant 层必须先去重（定下版本代表）再重排。
   */
  it("重排不会把引用从 v4 换成同一篇文档的 v3", async () => {
    const question = "Layer 怎么做依赖注入？"
    const reversed = await run(
      askQuestion({ question, maxCitations: 3 }).pipe(
        Effect.provide(
          layerWith({
            enabled: true,
            model: "stub",
            rerank: (input) => Effect.succeed(input.candidates.map((_, index) => index).reverse()),
            composeAnswer: () => Effect.succeed(undefined)
          })
        )
      )
    )
    for (const citation of reversed.citations) {
      expect(citation.version, `重排把引用带到了旧版本：${citation.slug}`).toBe("v4")
    }
  })

  it("重排失败（undefined）⇒ 保持检索顺序", async () => {
    const question = "Layer 怎么做依赖注入？"
    const baseline = await run(
      askQuestion({ question }).pipe(
        Effect.provide(
          layerWith({ enabled: true, model: "stub", composeAnswer: () => Effect.succeed(undefined) })
        )
      )
    )
    const withBrokenRerank = await run(
      askQuestion({ question }).pipe(
        Effect.provide(
          layerWith({
            enabled: true,
            model: "stub",
            rerank: () => Effect.succeed(undefined),
            composeAnswer: () => Effect.succeed(undefined)
          })
        )
      )
    )
    expect(withBrokenRerank.citations.map((c) => c.citationId)).toEqual(
      baseline.citations.map((c) => c.citationId)
    )
  })
})

describe("缓存键含 history", () => {
  it("同样的问题 + 不同历史 ⇒ 不同键（追问不会命中首问的缓存）", () => {
    const first = cacheKey({ question: "它呢？" }, "m")
    const withHistory = cacheKey(
      { question: "它呢？", history: [{ question: "Effect 是什么？", citations: [{ slug: "a", title: "A" }] }] },
      "m"
    )
    expect(first).not.toBe(withHistory)
  })

  it("同一段历史（空白与大小写差异）归一化后同键", () => {
    const a = cacheKey(
      { question: "它呢？", history: [{ question: "Effect  是什么？", citations: [{ slug: "a", title: "A" }] }] },
      "m"
    )
    const b = cacheKey(
      { question: "它呢？", history: [{ question: " effect 是什么？ ", citations: [{ slug: "a", title: "A" }] }] },
      "m"
    )
    expect(a).toBe(b)
  })

  it("历史摘要与引用一起参与指纹（引用变了 ⇒ 认作不同上下文）", () => {
    const one = historyFingerprint([{ question: "q", citations: [{ slug: "a", title: "A" }] }])
    const two = historyFingerprint([{ question: "q", citations: [{ slug: "b", title: "B" }] }])
    expect(one).not.toBe(two)
    expect(historyFingerprint([])).toBe("no-history")
  })
})
