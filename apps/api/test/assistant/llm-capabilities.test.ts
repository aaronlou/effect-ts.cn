/**
 * 三项"检索辅助能力"的端到端测试（对本地假服务，不需要真实 Key）。
 *
 * 它们和润色共用同一条 chat 路径，但输出是**结构化用途**的（查询、编号），
 * 所以真正的风险不在 HTTP，而在解析：模型多写一句解释、漏一个编号、加个编号前缀，
 * 都可能把"辅助"变成"破坏"。这里把解析的边界钉死。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { Effect, Layer, Redacted } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { describe, expect, it } from "vitest"
import { Llm } from "../../src/contexts/assistant/application/ports/llm"
import {
  makeOpenAiCompatibleLlm,
  parseQueryLines,
  parseRerankOrder,
  parseSingleLine
} from "../../src/contexts/assistant/infrastructure/llm/openai-compatible-llm"
import { makeTokenBudgetLive } from "../../src/contexts/assistant/infrastructure/llm/token-budget"

const withFakeProvider = async (
  handler: (body: unknown) => string
): Promise<{ baseUrl: string; close: () => Promise<void>; requests: Array<unknown> }> => {
  const requests: Array<unknown> = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Array<Buffer> = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      let parsed: unknown = undefined
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      } catch {
        parsed = undefined
      }
      requests.push(parsed)
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ choices: [{ message: { content: handler(parsed) } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    requests
  }
}

const layerFor = (baseUrl: string) =>
  makeOpenAiCompatibleLlm({
    baseUrl,
    apiKey: Redacted.make("test-key"),
    model: "test-model",
    timeoutMs: 5000
  }).pipe(Layer.provide(Layer.mergeAll(FetchHttpClient.layer, makeTokenBudgetLive({ dailyLimit: 1_000_000 }))))

describe("解析：模型输出必须被驯服成可用结构", () => {
  it("单行改写：去掉编号/引号，跳过引导句，只取第一行有内容的", () => {
    expect(parseSingleLine("1. 怎么安装 Effect？")).toBe("怎么安装 Effect？")
    expect(parseSingleLine("「Effect.gen 怎么用？」")).toBe("Effect.gen 怎么用？")
    expect(parseSingleLine("改写如下：\n\n怎么安装 Effect？")).toBe("怎么安装 Effect？")
    expect(parseSingleLine("改写如下：")).toBeUndefined()
    expect(parseSingleLine("   ")).toBeUndefined()
    expect(parseSingleLine(undefined)).toBeUndefined()
    expect(parseSingleLine("x".repeat(300))).toBeUndefined()
  })

  it("多行扩展：去编号、去重、限量、丢超长行", () => {
    const parsed = parseQueryLines("1. Fiber 并发\n2. Effect 同时执行\n- Fiber 并发\n\n" + "很长的行".repeat(40))
    expect(parsed).toEqual(["Fiber 并发", "Effect 同时执行"])
    expect(parseQueryLines("")).toBeUndefined()
    expect(parseQueryLines(undefined)).toBeUndefined()
  })

  it("重排：永远返回完整排列（漏编号用原顺序补齐，不丢候选）", () => {
    expect(parseRerankOrder("2,1,3", 3)).toEqual([1, 0, 2])
    expect(parseRerankOrder("3", 3)).toEqual([2, 0, 1])
    expect(parseRerankOrder("2,2,9,-1", 3)).toEqual([1, 0, 2])
    expect(parseRerankOrder("没有编号", 3)).toBeUndefined()
    expect(parseRerankOrder("2,1,3", 0)).toBeUndefined()
  })
})

describe("三项能力走真实 HTTP 路径", () => {
  it("改写：请求里带上一轮聊过什么，且不含上一轮的模型正文", async () => {
    const fake = await withFakeProvider(() => "1. 怎么安装 Effect？")
    try {
      const rewritten = await Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* Llm
          return yield* llm.rewriteQuery!({
            question: "它怎么装？",
            history: [
              {
                question: "Effect 是什么？",
                citations: [{ slug: "v4/getting-started/why-effect", title: "为什么选择 Effect？", anchor: "intro" }]
              }
            ]
          })
        }).pipe(Effect.provide(layerFor(fake.baseUrl)))
      )
      expect(rewritten).toBe("怎么安装 Effect？")
      const body = fake.requests[0] as { messages: ReadonlyArray<{ role: string; content: string }> }
      const user = body.messages[1]?.content ?? ""
      expect(user).toContain("Effect 是什么？")
      expect(user).toContain("why-effect")
      expect(user).toContain("它怎么装？")
    } finally {
      await fake.close()
    }
  })

  it("扩展：把白话问题换成多条术语化查询", async () => {
    const fake = await withFakeProvider(() => "Fiber 并发\n同时执行两个 Effect")
    try {
      const queries = await Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* Llm
          return yield* llm.expandQueries!({ question: "怎么让两件事同时跑？", history: [] })
        }).pipe(Effect.provide(layerFor(fake.baseUrl)))
      )
      expect(queries).toEqual(["Fiber 并发", "同时执行两个 Effect"])
    } finally {
      await fake.close()
    }
  })

  it("重排：候选带编号送进去，回来的是下标顺序", async () => {
    const fake = await withFakeProvider(() => "2,1")
    try {
      const order = await Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* Llm
          return yield* llm.rerank!({
            question: "Layer 怎么做依赖注入？",
            candidates: [
              { title: "管理 Layer", anchor: "intro", text: "先说别的" },
              { title: "注入测试依赖", text: "这才是答案" }
            ]
          })
        }).pipe(Effect.provide(layerFor(fake.baseUrl)))
      )
      expect(order).toEqual([1, 0])
      const body = fake.requests[0] as { messages: ReadonlyArray<{ role: string; content: string }> }
      expect(body.messages[1]?.content).toContain("1. 《管理 Layer》")
      expect(body.messages[1]?.content).toContain("2. 《注入测试依赖》")
    } finally {
      await fake.close()
    }
  })

  it("服务返回垃圾内容 ⇒ 三项能力都返回 undefined（调用方各自回退，绝不抛出）", async () => {
    const fake = await withFakeProvider(() => "")
    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* Llm
          const rewritten = yield* llm.rewriteQuery!({ question: "q", history: [] })
          const expanded = yield* llm.expandQueries!({ question: "q", history: [] })
          const order = yield* llm.rerank!({
            question: "q",
            candidates: [{ title: "t", text: "x" }]
          })
          return { rewritten, expanded, order }
        }).pipe(Effect.provide(layerFor(fake.baseUrl)))
      )
      expect(result.rewritten).toBeUndefined()
      expect(result.expanded).toBeUndefined()
      expect(result.order).toBeUndefined()
    } finally {
      await fake.close()
    }
  })
})
