/**
 * 报错模式表：**运行期报错**的确定性映射。
 *
 * 背景：`/debug` 原本靠"从报错里提 API 名 → 检索"。这对编译期类型报错有效，
 * 对运行期报错几乎失效 —— 后者的信号在语义里，不在 API 名上。
 * 实测：`Service not found: B` 的 extractIdentifiers 是**空数组** → 直接拒答。
 * 而这恰恰是 Effect 最经典、最常被搜的运行期错误。
 *
 * 下面这些报错文本**都是从真实运行结果里抄来的**，不是我编的。
 */
import { describe, expect, it } from "vitest"
import { ERROR_PATTERNS, chunksForPattern, matchErrorPattern } from "../src/error-patterns.js"
import type { CorpusPage } from "../src/types.js"

/** 真实运行期报错（原样抄自 `npx tsx` 的输出，只把绝对路径换成了占位符） */
const REAL = {
  serviceNotFound: `(FiberFailure) Error: Service not found: B (defined at <anonymous> (/x/src/a.ts:3:32))
    at /x/node_modules/effect/src/internal/fiberRuntime.ts:1112:36
    at FiberRuntime.Sync (/x/node_modules/effect/src/internal/fiberRuntime.ts:1161:19)`,
  asyncFiber: `[AsyncFiberException: Fiber #0 cannot be resolved synchronously. This is caused by using runSync on an effect that performs async work]`,
  timeout: `(FiberFailure) TimeoutException: Operation timed out after '50ms'`,
  yieldNotEffect: `(FiberFailure) TypeError: number 42 is not iterable (cannot read property Symbol(Symbol.iterator))`,
  fiberFailureOnly: `(FiberFailure) TypeError: Cannot read properties of undefined (reading 'value')`
} as const

describe("报错模式表", () => {
  it("接住最经典的运行期错误：Service not found", () => {
    expect(matchErrorPattern(REAL.serviceNotFound)?.id).toBe("service-not-found")
  })

  it("接住 AsyncFiberException / TimeoutException / yield 非 Effect", () => {
    expect(matchErrorPattern(REAL.asyncFiber)?.id).toBe("async-fiber")
    expect(matchErrorPattern(REAL.timeout)?.id).toBe("timeout")
    expect(matchErrorPattern(REAL.yieldNotEffect)?.id).toBe("yield-not-effect")
  })

  /**
   * 这条守的是**数组顺序**：`Service not found` 的报错里同时含 `FiberFailure`，
   * 如果宽泛的 fiber-failure 排在前面，它会被错误地映射到《两类错误》而不是《管理 Layer》——
   * 而后者才是答案。顺序不是风格问题，是正确性问题。
   */
  it("更具体的模式优先：Service not found 不能被 FiberFailure 抢走", () => {
    const matched = matchErrorPattern(REAL.serviceNotFound)
    expect(matched?.id).not.toBe("fiber-failure")
    expect(matched?.slugs[0]).toBe("v4/requirements-management/layers")
  })

  it("只有 FiberFailure、没有更具体特征时，落到宽泛兜底（回答「这是什么」）", () => {
    expect(matchErrorPattern(REAL.fiberFailureOnly)?.id).toBe("fiber-failure")
  })

  it("无关文本不匹配任何模式（不硬凑）", () => {
    for (const text of [
      "Something went wrong while processing your request, please retry later.",
      "TypeError: Cannot read properties of undefined",
      "ECONNREFUSED 127.0.0.1:5432",
      ""
    ]) {
      expect(matchErrorPattern(text), `「${text}」不该命中`).toBeUndefined()
    }
  })

  it("每个模式的目标页都指向 v4（主线），且 slug 形态合法", () => {
    for (const pattern of ERROR_PATTERNS) {
      expect(pattern.slugs.length).toBeGreaterThan(0)
      for (const slug of pattern.slugs) expect(slug).toMatch(/^v4\//)
    }
  })

  it("按 slug 取切片：存在的页取前几片，不存在的页跳过而不是报错", () => {
    const page = (slug: string): CorpusPage =>
      ({ slug, chunks: [{ text: "a" }, { text: "b" }, { text: "c" }] }) as unknown as CorpusPage
    const pages = [page("v4/requirements-management/layers")]
    const pattern = ERROR_PATTERNS.find((p) => p.id === "service-not-found")!
    const chunks = chunksForPattern(pages, pattern, { maxPerPage: 2 })
    // 只给了 1 页（另两页不在语料里）→ 取 2 片，不该抛错
    expect(chunks.length).toBe(2)
    expect(chunks.every((c) => c.page.slug === "v4/requirements-management/layers")).toBe(true)
  })
})
