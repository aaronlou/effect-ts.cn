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

const SCHEMA_ERROR =
  "Type 'Schema.Schema<string, string, never>' is not assignable to type 'Schema.Schema<number, number, never>'"

describe("ExplainError", () => {
  it("extractive：给出定位与引用，并明确不是诊断结论", async () => {
    const result = await run(explainError({ errorText: TYPE_ERROR }).pipe(Effect.provide(env(ExtractiveStub))))
    expect(result.refused).toBe(false)
    expect(result.mode).toBe("extractive")
    expect(result.identifiers.length).toBeGreaterThan(0)
    expect(result.citations.length).toBeGreaterThan(0)
    expect(result.disclaimer).toContain("不是自动诊断结论")
  })

  it("Schema 主题已翻译：应给出中文引用（不再判为未翻译）", async () => {
    const result = await run(explainError({ errorText: SCHEMA_ERROR }).pipe(Effect.provide(env(ExtractiveStub))))
    expect(result.refused).toBe(false)
    // 断言"定位到了 Schema 章节"而不是"必须是 v4"：v3/v4 都是完整译文，
    // 版本偏好只是排序微调（v4 有 1.15 倍加成），不该由测试把版本绑死。
    expect(result.citations.some((item) => item.slug.includes("/schema/"))).toBe(true)
  })

  it("站内没有依据的报错：拒答并给出行动出口", async () => {
    // 站点 234 页已全部译完，"未翻译"这条路径由 packages/knowledge 的合成 pending 测试覆盖；
    // 这里验证另一条：既没有可定位的小节，也不该硬答。
    const result = await run(
      explainError({ errorText: "WebGL: context lost while rendering the plasma shader" }).pipe(
        Effect.provide(env(ExtractiveStub))
      )
    )
    expect(result.refused).toBe(true)
    expect(result.citations).toEqual([])
    expect(result.refusal?.reason).toBe("no-match")
  })

  it("已翻译主题（Layer）：给出中文引用，不得再判为未翻译", async () => {
    const result = await run(explainError({ errorText: LAYER_ERROR }).pipe(Effect.provide(env(ExtractiveStub))))
    expect(result.refused).toBe(false)
    expect(result.citations.some((item) => item.slug.includes("requirements-management/layers"))).toBe(true)
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

  // 回归：code 曾经只编码成 "code"/"nocode"，同一报错配不同代码会命中同一条诊断。
  it("不同代码片段必须产生不同的缓存 key（不能把别人的诊断发给用户）", () => {
    const a = explainCacheKey({ errorText: TYPE_ERROR, code: "const x = 1" }, "m")
    const b = explainCacheKey({ errorText: TYPE_ERROR, code: "const y: string = 2" }, "m")
    expect(a).not.toBe(b)
    // 相同代码仍然命中同一条
    expect(a).toBe(explainCacheKey({ errorText: TYPE_ERROR, code: "const x = 1" }, "m"))
  })

  it("「没给代码」与「给了空代码」不是同一个 key", () => {
    expect(explainCacheKey({ errorText: TYPE_ERROR }, "m")).not.toBe(
      explainCacheKey({ errorText: TYPE_ERROR, code: "" }, "m")
    )
  })

  it("长报错在后半段分叉时不应串味（不再截断到 400 字符）", () => {
    const head = "x".repeat(400)
    const a = explainCacheKey({ errorText: `${head}AAAA` }, "m")
    const b = explainCacheKey({ errorText: `${head}BBBB` }, "m")
    expect(a).not.toBe(b)
  })

  it("分隔符不可被内容构造碰撞（报错里本来就有 `|`）", () => {
    // 旧实现用 "|" 拼接：这两组输入会拼出同一个字符串
    const a = explainCacheKey({ errorText: "a|b", code: "c" }, "m")
    const b = explainCacheKey({ errorText: "a", code: "b|c" }, "m")
    expect(a).not.toBe(b)
  })
})
