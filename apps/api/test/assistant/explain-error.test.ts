/**
 * ExplainError（报错解释）用例测试：
 * - extractive 路径只做定位，不臆测；
 * - 未翻译主题诚实拒答；
 * - 模型诊断走 diagnose 意图，且输出必须过术语门禁；
 * - 相同报错命中缓存（模型只调用一次）。
 */
import { describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import { explainError, explainCacheKey } from "../../src/contexts/assistant/application/use-cases/explain-error"
import { Glossary } from "../../src/contexts/assistant/application/ports/glossary"
import { Llm, type LlmService } from "../../src/contexts/assistant/application/ports/llm"
import { makeAnswerCacheLive } from "../../src/contexts/assistant/infrastructure/answer-cache-live"
import { KnowledgeBaseLive } from "../../src/contexts/knowledge/infrastructure/knowledge-base-live"

const GlossaryStub = Layer.succeed(Glossary, {
  forbidden: ["纤维", "图层", "效果系统"],
  termCount: 3,
  source: "test"
})

const cacheLayer = makeAnswerCacheLive({ capacity: 10, ttlMillis: 60_000 })

const ExtractiveStub = Layer.succeed(Llm, {
  enabled: false,
  model: "extractive",
  composeAnswer: () => Effect.succeed(undefined)
} satisfies LlmService)

const run = <A, E>(effect: Effect.Effect<A, E, unknown>) =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>)

const env = (llm: Layer.Layer<LlmService>) =>
  Layer.mergeAll(KnowledgeBaseLive, llm, cacheLayer, GlossaryStub)

const TYPE_ERROR =
  "TS2345: Argument of type 'Effect<number, never, never>' is not assignable to parameter of type 'number'. Did you mean to call Effect.runPromise?"

const LAYER_ERROR =
  "Type 'Layer.Layer<Database, never, never>' is not assignable to type 'Layer.Layer<never, never, never>'"

describe("ExplainError", () => {
  it("extractive：给出定位与引用，并明确不是诊断结论", async () => {
    const result = await run(explainError({ errorText: TYPE_ERROR }).pipe(Effect.provide(env(ExtractiveStub))))
    expect(result.refused).toBe(false)
    expect(result.mode).toBe("extractive")
    expect(result.identifiers.length).toBeGreaterThan(0)
    expect(result.citations.length).toBeGreaterThan(0)
    expect(result.disclaimer).toContain("不是自动诊断结论")
  })

  it("未翻译主题（Layer）：拒答并给出官方英文原文", async () => {
    const result = await run(explainError({ errorText: LAYER_ERROR }).pipe(Effect.provide(env(ExtractiveStub))))
    expect(result.refused).toBe(true)
    expect(result.citations).toEqual([])
    expect(result.refusal?.reason).toBe("untranslated")
    expect(result.refusal?.suggestions?.some((item) => item.slug.includes("requirements-management"))).toBe(true)
  })

  it("模型诊断：以 diagnose 意图调用，引用仍来自检索", async () => {
    let seenIntent: string | undefined = undefined
    const stub = Layer.succeed(Llm, {
      enabled: true,
      model: "stub",
      composeAnswer: (input) => {
        seenIntent = input.intent
        return Effect.succeed("这是类型不匹配：`Effect.runPromise` 返回 Promise，而你把它当成 number 用了。")
      }
    } satisfies LlmService)

    const result = await run(explainError({ errorText: TYPE_ERROR }).pipe(Effect.provide(env(stub))))
    expect(seenIntent).toBe("diagnose")
    expect(result.mode).toBe("llm")
    expect(result.answer).toContain("类型不匹配")
    expect(result.citations.length).toBeGreaterThan(0)
  })

  it("模型输出违反术语 ⇒ 回退为检索定位", async () => {
    const stub = Layer.succeed(Llm, {
      enabled: true,
      model: "rule-breaker",
      composeAnswer: () => Effect.succeed("这里的图层需要提供依赖。")
    } satisfies LlmService)

    const result = await run(explainError({ errorText: TYPE_ERROR }).pipe(Effect.provide(env(stub))))
    expect(result.mode).toBe("extractive")
    expect(result.answer).not.toContain("图层")
    expect(result.citations.length).toBeGreaterThan(0)
  })

  it("相同报错命中缓存：模型只调用一次", async () => {
    let calls = 0
    const stub = Layer.succeed(Llm, {
      enabled: true,
      model: "counting",
      composeAnswer: () => {
        calls += 1
        return Effect.succeed(`第 ${calls} 次诊断`)
      }
    } satisfies LlmService)

    const [first, second] = await run(
      Effect.gen(function* () {
        const a = yield* explainError({ errorText: TYPE_ERROR })
        const b = yield* explainError({ errorText: TYPE_ERROR })
        return [a, b] as const
      }).pipe(Effect.provide(env(stub)))
    )
    expect(calls).toBe(1)
    expect(second.answer).toBe(first.answer)
  })

  it("缓存 key 归一化：空白差异不产生新条目", () => {
    expect(explainCacheKey({ errorText: "a  b\n c" }, "m")).toBe(explainCacheKey({ errorText: "a b c" }, "m"))
    expect(explainCacheKey({ errorText: TYPE_ERROR }, "m")).not.toBe(
      explainCacheKey({ errorText: TYPE_ERROR }, "other-model")
    )
  })
})
