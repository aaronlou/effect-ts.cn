/**
 * 诊断（记账用的那一份数据）必须与真实发生的事一致。
 *
 * 为什么要单独测：报表的价值全靠这些布尔与计数。**错一个字段，报表就会长期撒谎**，
 * 而且没人会发现 —— 例如 `expanded` 永远为 false，你会以为"扩展从没触发过"，
 * 于是去优化一个根本没在跑的环节。
 */
import { describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import { askQuestionWithUsage } from "../../src/contexts/assistant/application/use-cases/ask-question"
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

/** 「怎么让两件事同时跑？」是实测里纯词法检索查不到的白话（拒答） */
const COLLOQUIAL = "怎么让两件事同时跑？"

const extractive = (overrides: Partial<LlmService> = {}): LlmService => ({
  enabled: false,
  model: "extractive",
  composeAnswer: () => Effect.succeed(undefined),
  ...overrides
})

const layerWith = (llm: LlmService) =>
  Layer.mergeAll(KnowledgeBaseLive, Layer.succeed(Llm, llm), cacheLayer, GlossaryStub)

describe("AskDiagnostics：账目与事实一致", () => {
  it("正常作答：模式、引用数、可解引用数与响应完全对得上", async () => {
    const outcome = await run(
      askQuestionWithUsage({ question: "怎么安装 Effect？" }).pipe(Effect.provide(layerWith(extractive())))
    )
    expect(outcome.diagnostics.refused).toBe(false)
    expect(outcome.diagnostics.mode).toBe("extractive")
    expect(outcome.diagnostics.citations).toBe(outcome.response.citations.length)
    // 站内引用带锚点即有 /cite/<digest>.json ⇒ 全部可解引用
    expect(outcome.diagnostics.resolvableCitations).toBe(
      outcome.response.citations.filter((citation) => citation.citeUrl !== undefined).length
    )
    expect(outcome.diagnostics.resolvableCitations).toBeGreaterThan(0)
    // 无模型时这几件事都不会发生
    expect(outcome.diagnostics.rewritten).toBe(false)
    expect(outcome.diagnostics.expanded).toBe(false)
    expect(outcome.diagnostics.reranked).toBe(false)
    expect(outcome.diagnostics.scoped).toBe(false)
    expect(outcome.diagnostics.cacheHit).toBe(false)
  })

  it("拒答：不计引用，且如实带上拒答原因（no-match / untranslated 分开记）", async () => {
    const outcome = await run(
      askQuestionWithUsage({ question: "今天北京的天气怎么样？" }).pipe(Effect.provide(layerWith(extractive())))
    )
    expect(outcome.diagnostics.refused).toBe(true)
    expect(outcome.diagnostics.refusalReason).toBe("no-match")
    expect(outcome.diagnostics.citations).toBe(0)
    expect(outcome.diagnostics.resolvableCitations).toBe(0)
    // 拒答答案为空 —— 与引用不变量一致
    expect(outcome.response.citations).toEqual([])
  })

  it("第二次问同一句：cacheHit 为真（命中即零 token 的直接证据）", async () => {
    const layer = layerWith(extractive())
    const [first, second] = await run(
      Effect.gen(function* () {
        const a = yield* askQuestionWithUsage({ question: "怎么安装 Effect？" })
        const b = yield* askQuestionWithUsage({ question: "怎么安装 Effect？" })
        return [a, b] as const
      }).pipe(Effect.provide(layer))
    )
    expect(first.diagnostics.cacheHit).toBe(false)
    expect(second.diagnostics.cacheHit).toBe(true)
    // 命中缓存不能改变答案本身
    expect(second.response.answer).toBe(first.response.answer)
  })

  it("限定页面（问这一页）⇒ scoped 为真", async () => {
    const outcome = await run(
      askQuestionWithUsage({
        question: "怎么安装？",
        scope: "v4/getting-started/installation"
      }).pipe(Effect.provide(layerWith(extractive())))
    )
    expect(outcome.diagnostics.scoped).toBe(true)
  })

  it("扩展 / 重写 / 重排真的发生时，账目里也必须为真（否则报表会长期撒谎）", async () => {
    const outcome = await run(
      askQuestionWithUsage({
        question: "它怎么装？",
        history: [{ question: "Effect 是什么？", citations: [] }]
      }).pipe(
        Effect.provide(
          layerWith(
            extractive({
              enabled: true,
              model: "stub",
              rewriteQuery: () => Effect.succeed("怎么安装 Effect？"),
              expandQueries: () => Effect.succeed(["Fiber 并发"]),
              rerank: (input) => Effect.succeed(input.candidates.map((_, index) => index).reverse()),
              composeAnswer: () => Effect.succeed(undefined)
            })
          )
        )
      )
    )
    expect(outcome.diagnostics.rewritten).toBe(true)
    expect(outcome.diagnostics.reranked).toBe(true)
    // 重写后的查询能命中，所以**不该**触发扩展（省一次模型调用）
    expect(outcome.diagnostics.expanded).toBe(false)
  })

  it("白话问题 + 扩展：expanded 为真，且引用仍然全部可解引用", async () => {
    const outcome = await run(
      askQuestionWithUsage({ question: COLLOQUIAL }).pipe(
        Effect.provide(
          layerWith(
            extractive({
              enabled: true,
              model: "stub",
              expandQueries: () => Effect.succeed(["Fiber 并发", "Effect 同时执行两个任务"]),
              composeAnswer: () => Effect.succeed(undefined)
            })
          )
        )
      )
    )
    expect(outcome.diagnostics.expanded).toBe(true)
    expect(outcome.diagnostics.refused).toBe(false)
    expect(outcome.diagnostics.resolvableCitations).toBeGreaterThan(0)
    expect(outcome.diagnostics.resolvableCitations).toBe(outcome.diagnostics.citations)
  })
})
