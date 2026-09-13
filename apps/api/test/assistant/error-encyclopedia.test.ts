/**
 * 报错百科：把 `/debug` 的一次性诊断沉淀成可累积的公开条目。
 *
 * 这里守的是**"收什么、不收什么"** —— 它决定这份库是资产还是垃圾场：
 * 收进没有特征的输入、或把拒答也收进去，几条之后它就没人看了。
 */
import { describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import { explainError } from "../../src/contexts/assistant/application/use-cases/explain-error"
import { ErrorEncyclopedia } from "../../src/contexts/assistant/application/ports/error-encyclopedia"
import { Glossary } from "../../src/contexts/assistant/application/ports/glossary"
import { Llm, type LlmService } from "../../src/contexts/assistant/application/ports/llm"
import { makeAnswerCacheLive } from "../../src/contexts/assistant/infrastructure/answer-cache-live"
import { InMemoryErrorEncyclopediaLive } from "../../src/contexts/assistant/infrastructure/error-encyclopedia-memory"
import { KnowledgeBaseLive } from "../../src/contexts/knowledge/infrastructure/knowledge-base-live"

const run = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>)

const GlossaryStub = Layer.succeed(Glossary, {
  forbidden: [],
  termCount: 0,
  lookup: () => undefined
} as never)

const ExtractiveStub = Layer.succeed(Llm, {
  enabled: false,
  model: "extractive"
} as unknown as LlmService)

/** 缓存容量够大，避免"第二次提问命中缓存"掩盖 hits 的真实行为 */
const env = Layer.mergeAll(
  KnowledgeBaseLive,
  ExtractiveStub,
  makeAnswerCacheLive({ capacity: 100, ttlMillis: 60_000 }),
  GlossaryStub,
  InMemoryErrorEncyclopediaLive
)

// 与 explain-error.test.ts 同源的文本：它能在站内检索到依据（否则会被拒答，
/// 而"拒答不沉淀"会让本文件其它断言失去意义）
const TYPE_ERROR =
  "TS2345: Argument of type 'Effect<number, never, never>' is not assignable to parameter of type 'number'. Did you mean to call Effect.runPromise?"
/**
 * 同一个问题的另一台机器版本：**只有**文件路径、行列号、堆栈帧不同。
 *
 * 刻意让报错正文逐字一致：这个用例要验证的是"签名把机器相关噪声归掉了"，
 * 不是"检索对措辞有多宽容" —— 后者是检索层自己的测试范围。
 */
const SAME_ON_ANOTHER_MACHINE = `src/other.ts(99,1): TS2345: Argument of type 'Effect<number, never, never>' is not assignable to parameter of type 'number'. Did you mean to call Effect.runPromise?
  at /Users/bob/proj/node_modules/effect/src/Effect.ts:5:1`

const diagnose = (errorText: string) => explainError({ errorText })

/**
 * 整个程序只 provide 一次。
 *
 * 踩过的坑：只给 `diagnose(...)` 提供层，外层 `Effect.gen` 里 `yield* ErrorEncyclopedia`
 * 就取不到服务（运行时才报 Service not found，类型被 `run` 的断言盖住了）。
 */
const program = <A, E>(effect: Effect.Effect<A, E, unknown>): Promise<A> =>
  run(effect.pipe(Effect.provide(env)) as Effect.Effect<A, E, never>)

describe("报错百科：沉淀规则", () => {
  it("成功的诊断会被记录，并带上错误码、类型名与引用", async () => {
    const result = await program(
      Effect.gen(function* () {
        yield* diagnose(TYPE_ERROR)
        const encyclopedia = yield* ErrorEncyclopedia
        return yield* encyclopedia.list()
      })
    )
    expect(result.length).toBe(1)
    expect(result[0]!.codes).toEqual(["TS2345"])
    expect(result[0]!.symbols).toContain("Effect")
    expect(result[0]!.hits).toBe(1)
    // 治理纪律：默认就是"机器生成、未经人审"，展示层不得省略这个事实
    expect(result[0]!.reviewed).toBe(false)
  })

  it("同一报错的不同措辞/不同机器 ⇒ 只沉淀成一条，且 hits 累加", async () => {
    const result = await program(
      Effect.gen(function* () {
        // 显式断言两次都没被拒答：拒答不沉淀，否则这个用例会因为"没记录"而失败，
        // 但你会误以为是签名算错了
        const first = yield* diagnose(TYPE_ERROR)
        const second = yield* diagnose(SAME_ON_ANOTHER_MACHINE)
        expect(first.refused).toBe(false)
        expect(second.refused).toBe(false)
        const encyclopedia = yield* ErrorEncyclopedia
        return { entries: yield* encyclopedia.list(), total: yield* encyclopedia.size }
      })
    )
    // 磁盘路径、行列号不同，但底层是同一个问题 —— 裂成两条就等于同一问题有两份答案
    expect(result.total).toBe(1)
    expect(result.entries[0]!.hits).toBe(2)
  })

  it("**拒答不进百科**：没有依据的报错收进去只会变成噪声", async () => {
    const total = await program(
      Effect.gen(function* () {
        // 先确认这条确实会被拒答
        const response = yield* diagnose("error TS9999: totally unrelated failure in some unknown lib")
        expect(response.refused).toBe(true)
        const encyclopedia = yield* ErrorEncyclopedia
        return yield* encyclopedia.size
      })
    )
    expect(total).toBe(0)
  })

  it("**特征不足的输入不进百科**：把「帮我看看」收进去，库很快就没人看了", async () => {
    const total = await program(
      Effect.gen(function* () {
        yield* diagnose("我这报错了帮我看看")
        yield* diagnose("Cannot read properties of undefined")
        const encyclopedia = yield* ErrorEncyclopedia
        return yield* encyclopedia.size
      })
    )
    expect(total).toBe(0)
  })

  it("记录失败绝不影响诊断本身（记录是副产品，不是主流程）", async () => {
    const FailingEncyclopedia = Layer.succeed(ErrorEncyclopedia, {
      record: () => Effect.die(new Error("数据库挂了")),
      list: () => Effect.succeed([]),
      get: () => Effect.succeed(undefined),
      size: Effect.succeed(0)
    } as never)

    const response = await run(
      explainError({ errorText: TYPE_ERROR }).pipe(
        Effect.provide(
          Layer.mergeAll(
            KnowledgeBaseLive,
            ExtractiveStub,
            makeAnswerCacheLive({ capacity: 10, ttlMillis: 60_000 }),
            GlossaryStub,
            FailingEncyclopedia
          )
        )
      )
    )
    expect(response.refused).toBe(false)
  })
})
