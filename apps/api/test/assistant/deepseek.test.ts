/**
 * DeepSeek 接入的针对性测试（仍然不需要真实 Key：对本地假服务验证）。
 *
 * 关注三件容易出错、又不容易被发现的事：
 * 1. `DEEPSEEK_API_KEY` 一条配置就能跑（默认地址 + 默认模型）；
 * 2. 推理模型 `deepseek-reasoner` 的响应里多一个 `reasoning_content`，不能因此解析失败；
 * 3. 请求体不发送 reasoner 不支持的采样参数。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { Effect, Layer, Redacted } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { describe, expect, it } from "vitest"
import type { Citation } from "@ecn/knowledge"
import { Llm } from "../../src/contexts/assistant/application/ports/llm"
import { makeOpenAiCompatibleLlm } from "../../src/contexts/assistant/infrastructure/llm/openai-compatible-llm"
import { decideProvider } from "../../src/contexts/assistant/infrastructure/llm/provider-config"

const withFakeDeepSeek = async (
  payload: unknown
): Promise<{ baseUrl: string; close: () => Promise<void>; requests: Array<unknown>; paths: Array<string> }> => {
  const requests: Array<unknown> = []
  const paths: Array<string> = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Array<Buffer> = []
    paths.push(request.url ?? "")
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      try {
        requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        requests.push(undefined)
      }
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(payload))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    requests,
    paths
  }
}

const citation: Citation = {
  citationId: "ecn:v4/requirements-management/layers@a915662#注入测试依赖",
  citeUrl: "/cite/1a2b3c4d5e6f7a8b.json",
  slug: "v4/requirements-management/layers",
  version: "v4",
  title: "管理 Layer",
  url: "/docs/v4/requirements-management/layers/",
  officialUrl: "https://effect.website/docs/v4/requirements-management/layers",
  commit: "a915662cec65cf265322c033674046611392ba64",
  status: "reviewing",
  quote: "通过 Layer 组合服务，并在程序入口注入依赖。"
}

describe("DeepSeek：只给 Key 就能用（配置来自 decideProvider）", () => {
  it("DEEPSEEK_API_KEY 决定 baseUrl/model，并把请求发到 /chat/completions", async () => {
    const fake = await withFakeDeepSeek({ choices: [{ message: { content: "用 Layer 注入依赖。" } }] })
    try {
      const decision = decideProvider({
        DEEPSEEK_API_KEY: "sk-deepseek-test",
        DEEPSEEK_BASE_URL: fake.baseUrl
      })
      expect(decision.kind).toBe("llm")
      if (decision.kind !== "llm") return

      const layer = makeOpenAiCompatibleLlm({
        baseUrl: decision.config.baseUrl,
        apiKey: Redacted.make(decision.config.apiKey),
        model: decision.config.model,
        timeoutMs: 5000
      }).pipe(Layer.provide(FetchHttpClient.layer))

      const answer = await Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* Llm
          expect(llm.model).toBe("deepseek-chat")
          return yield* llm.composeAnswer({
            question: "Layer 怎么做依赖注入？",
            citations: [citation],
            fallback: "兜底",
            forbiddenTerms: ["图层"]
          })
        }).pipe(Effect.provide(layer))
      )

      expect(answer).toBe("用 Layer 注入依赖。")
      expect(fake.paths[0]).toBe("/chat/completions")
      const body = fake.requests[0] as { model: string; temperature?: number }
      expect(body.model).toBe("deepseek-chat")
      expect(body.temperature).toBe(0.2)
    } finally {
      await fake.close()
    }
  })

  it("deepseek-reasoner：既不发 temperature，也能解析带 reasoning_content 的响应", async () => {
    const fake = await withFakeDeepSeek({
      choices: [
        {
          message: {
            reasoning_content: "先看证据 1：Layer 组合服务……",
            content: "报错的原因是 Layer 的输出类型不匹配。"
          }
        }
      ]
    })
    try {
      const decision = decideProvider({ DEEPSEEK_API_KEY: "sk-x", LLM_MODEL: "deepseek-reasoner", DEEPSEEK_BASE_URL: fake.baseUrl })
      expect(decision.kind).toBe("llm")
      if (decision.kind !== "llm") return

      const layer = makeOpenAiCompatibleLlm({
        baseUrl: decision.config.baseUrl,
        apiKey: Redacted.make(decision.config.apiKey),
        model: decision.config.model,
        timeoutMs: 5000
      }).pipe(Layer.provide(FetchHttpClient.layer))

      const answer = await Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* Llm
          return yield* llm.composeAnswer({
            question: "为什么 Layer 类型不匹配？",
            citations: [citation],
            fallback: "兜底",
            forbiddenTerms: [],
            intent: "diagnose"
          })
        }).pipe(Effect.provide(layer))
      )

      expect(answer).toBe("报错的原因是 Layer 的输出类型不匹配。")
      const body = fake.requests[0] as { temperature?: number; model: string }
      expect(body.model).toBe("deepseek-reasoner")
      expect(body.temperature).toBeUndefined()
    } finally {
      await fake.close()
    }
  })

  it("服务返回错误结构（例如限流页）⇒ 视为不可用并回退，而不是抛给用户", async () => {
    const fake = await withFakeDeepSeek({ error: { message: "rate limited" } })
    try {
      const layer = makeOpenAiCompatibleLlm({
        baseUrl: fake.baseUrl,
        apiKey: Redacted.make("sk-x"),
        model: "deepseek-chat",
        timeoutMs: 5000
      }).pipe(Layer.provide(FetchHttpClient.layer))

      const answer = await Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* Llm
          return yield* llm.composeAnswer({
            question: "怎么安装？",
            citations: [citation],
            fallback: "兜底",
            forbiddenTerms: []
          })
        }).pipe(Effect.provide(layer))
      )

      expect(answer).toBeUndefined()
    } finally {
      await fake.close()
    }
  })
})
