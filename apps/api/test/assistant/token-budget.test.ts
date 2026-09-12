import { describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import {
  TokenBudget,
  type TokenBudgetService,
  advanceBudget,
  alignBudget,
  isExhausted,
  makeTokenBudgetLive,
  utcDayStart
} from "../../src/contexts/assistant/infrastructure/llm/token-budget"

const withBudget = <A, E>(limit: number, effect: Effect.Effect<A, E, TokenBudgetService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(makeTokenBudgetLive({ dailyLimit: limit }))))

describe("每日 token 预算：这道闸的目的是「超预算那一刻就停止花钱」", () => {
  it("起初未用尽，记账后如实反映", async () => {
    const result = await withBudget(
      1000,
      Effect.gen(function* () {
        const budget = yield* TokenBudget
        const before = yield* budget.status
        yield* budget.spend(300)
        const after = yield* budget.status
        return { before, after }
      })
    )
    expect(result.before.used).toBe(0)
    expect(result.before.exhausted).toBe(false)
    expect(result.after.used).toBe(300)
    expect(result.after.remaining).toBe(700)
    expect(result.after.exhausted).toBe(false)
  })

  it("达到上限即 exhausted，且 canSpend 变 false（调用方据此短路）", async () => {
    const result = await withBudget(
      500,
      Effect.gen(function* () {
        const budget = yield* TokenBudget
        yield* budget.spend(499)
        const almost = yield* budget.canSpend
        yield* budget.spend(1)
        const atLimit = yield* budget.canSpend
        const status = yield* budget.status
        return { almost, atLimit, status }
      })
    )
    expect(result.almost).toBe(true)
    expect(result.atLimit).toBe(false)
    expect(result.status.exhausted).toBe(true)
    expect(result.status.remaining).toBe(0)
  })

  it("超支也照记（不能因为「超了就不记」而让用量失真）", async () => {
    const status = await withBudget(
      100,
      Effect.gen(function* () {
        const budget = yield* TokenBudget
        yield* budget.spend(150)
        return yield* budget.status
      })
    )
    expect(status.used).toBe(150)
    expect(status.exhausted).toBe(true)
    expect(status.remaining).toBe(0)
  })

  it("limit <= 0 表示不限（本地开发与 CI 用）", async () => {
    const result = await withBudget(
      0,
      Effect.gen(function* () {
        const budget = yield* TokenBudget
        yield* budget.spend(999_999)
        return { canSpend: yield* budget.canSpend, status: yield* budget.status }
      })
    )
    expect(result.canSpend).toBe(true)
    expect(result.status.exhausted).toBe(false)
  })

  it("非法用量（负数 / NaN / Infinity）被忽略，不污染账本", async () => {
    const status = await withBudget(
      1000,
      Effect.gen(function* () {
        const budget = yield* TokenBudget
        yield* budget.spend(-5)
        yield* budget.spend(Number.NaN)
        yield* budget.spend(Number.POSITIVE_INFINITY)
        yield* budget.spend(10)
        return yield* budget.status
      })
    )
    expect(status.used).toBe(10)
  })

  it("跨 UTC 日自动清零（重置点必须可预期，运维要知道几点恢复）", async () => {
    const dayOne = Date.UTC(2026, 0, 2, 23, 59, 0)
    const dayTwo = Date.UTC(2026, 0, 3, 0, 1, 0)
    let state = { used: 0, dayStart: 0 }
    state = advanceBudget(state, dayOne, 900)
    expect(state.used).toBe(900)
    // 同一天内继续累加
    state = advanceBudget(state, dayOne + 1000, 100)
    expect(state.used).toBe(1000)
    // 跨过 UTC 零点：从头开始
    state = advanceBudget(state, dayTwo, 50)
    expect(state.used).toBe(50)
    // 读取时也要对齐（没有新写入的情况下，跨日后读到的应是 0）
    expect(alignBudget({ used: 1000, dayStart: utcDayStart(dayOne) }, dayTwo).used).toBe(0)
  })
})

describe("预算的纯函数部分", () => {
  it("utcDayStart 对齐到 UTC 零点", () => {
    expect(utcDayStart(Date.UTC(2026, 8, 12, 13, 45, 30))).toBe(Date.UTC(2026, 8, 12, 0, 0, 0))
  })
  it("isExhausted：limit=0 永远不算用尽", () => {
    expect(isExhausted(10 ** 12, 0)).toBe(false)
    expect(isExhausted(99, 100)).toBe(false)
    expect(isExhausted(100, 100)).toBe(true)
  })
})
