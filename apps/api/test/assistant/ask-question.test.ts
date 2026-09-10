/**
 * Assistant 上下文测试：把 AI 层的**不变量**钉死。
 *
 * 这些用例是"AI 可信"的回归网：
 * - 拒答不会进入模型（不会产生"没有依据的流畅答案"）；
 * - 引用由检索构造，模型只做润色（换模型/换 prompt 不能改变引用）；
 * - 模型输出违反社区术语 ⇒ 回退 extractive；
 * - 相同问题第二次命中缓存（成本与延迟的关键）。
 */
import { describe, expect, it } from "vitest"
import { Effect, Layer, Redacted } from "effect"
import { FetchHttpClient } from "@effect/platform"
import type { Citation } from "@ecn/knowledge"
import {
  askQuestion,
  cacheKey,
  containsForbiddenTerm
} from "../../src/contexts/assistant/application/use-cases/ask-question"
import { AnswerCache } from "../../src/contexts/assistant/application/ports/answer-cache"
import { Glossary } from "../../src/contexts/assistant/application/ports/glossary"
import { Llm, type LlmService } from "../../src/contexts/assistant/application/ports/llm"
import { makeAnswerCacheLive } from "../../src/contexts/assistant/infrastructure/answer-cache-live"
import { KnowledgeBaseLive } from "../../src/contexts/knowledge/infrastructure/knowledge-base-live"
import { makeOpenAiCompatibleLlm } from "../../src/contexts/assistant/infrastructure/llm/openai-compatible-llm"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

const GlossaryStub = Layer.succeed(Glossary, {
  forbidden: ["纤维", "图层", "效果系统"],
  termCount: 3,
  source: "test"
})

const ExtractiveStub = Layer.succeed(Llm, {
  enabled: false,
  model: "extractive",
  composeAnswer: () => Effect.succeed(undefined)
} satisfies LlmService)

const cacheLayer = makeAnswerCacheLive({ capacity: 10, ttlMillis: 60_000 })

const run = <A, E>(effect: Effect.Effect<A, E, unknown>) =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>)

describe("AskQuestion 不变量", () => {
  it("有依据：返回引用，模式为 extractive", async () => {
    const result = await run(
      askQuestion({ question: "怎么安装 Effect？" }).pipe(
        Effect.provide(Layer.mergeAll(KnowledgeBaseLive, ExtractiveStub, cacheLayer, GlossaryStub))
      )
    )
    expect(result.refused).toBe(false)
    expect(result.mode).toBe("extractive")
    expect(result.citations.length).toBeGreaterThan(0)
    expect(result.citations[0]?.slug).toContain("getting-started")
    expect(result.disclaimer.length).toBeGreaterThan(0)
  })

  it("无依据：拒答，且不产生引用与答案正文", async () => {
    const result = await run(
      askQuestion({ question: "今天北京的天气怎么样？" }).pipe(
        Effect.provide(Layer.mergeAll(KnowledgeBaseLive, ExtractiveStub, cacheLayer, GlossaryStub))
      )
    )
    expect(result.refused).toBe(true)
    expect(result.citations).toEqual([])
    expect(result.answer).toBe("")
    expect(result.refusal?.reason).toBe("no-match")
  })

  it("中文尚未翻译：拒答并给出英文原文建议", async () => {
    const result = await run(
      askQuestion({ question: "Layer 是怎么做依赖注入的？" }).pipe(
        Effect.provide(Layer.mergeAll(KnowledgeBaseLive, ExtractiveStub, cacheLayer, GlossaryStub))
      )
    )
    if (result.refused) {
      expect(result.refusal?.reason).toBe("untranslated")
      expect(result.refusal?.suggestions?.length).toBeGreaterThan(0)
      expect(result.refusal?.suggestions?.[0]?.officialUrl).toContain("effect.website")
    } else {
      expect(result.citations.length).toBeGreaterThan(0)
    }
  })

  it("拒答时不调用模型（不会出现'没有依据的流畅答案'）", async () => {
    let called = 0
    const spy = Layer.succeed(Llm, {
      enabled: true,
      model: "spy",
      composeAnswer: () => {
        called += 1
        return Effect.succeed("凭空生成的答案")
      }
    } satisfies LlmService)

    const result = await run(
      askQuestion({ question: "今天北京的天气怎么样？" }).pipe(
        Effect.provide(Layer.mergeAll(KnowledgeBaseLive, spy, cacheLayer, GlossaryStub))
      )
    )
    expect(result.refused).toBe(true)
    expect(called).toBe(0)
  })

  it("模型润色：answer 换成模型文本，但引用仍来自检索", async () => {
    const polished = "根据文档，「Effect 类型」用三个类型参数分别描述成功、错误与依赖。"
    const stub = Layer.succeed(Llm, {
      enabled: true,
      model: "stub-model",
      composeAnswer: () => Effect.succeed(polished)
    } satisfies LlmService)

    const result = await run(
      askQuestion({ question: "Effect 类型上的三个类型参数分别是什么？" }).pipe(
        Effect.provide(Layer.mergeAll(KnowledgeBaseLive, stub, cacheLayer, GlossaryStub))
      )
    )
    expect(result.mode).toBe("llm")
    expect(result.answer).toBe(polished)
    expect(result.citations.length).toBeGreaterThan(0)
    for (const citation of result.citations) {
      expect(citation.url.startsWith("/docs/")).toBe(true)
      expect(citation.quote.length).toBeGreaterThan(0)
    }
  })

  it("模型输出违反术语 ⇒ 回退 extractive", async () => {
    const stub = Layer.succeed(Llm, {
      enabled: true,
      model: "rule-breaker",
      composeAnswer: () => Effect.succeed("这里的图层概念用于组织依赖。") // 「图层」是禁用译法
    } satisfies LlmService)

    const result = await run(
      askQuestion({ question: "怎么安装 Effect？" }).pipe(
        Effect.provide(Layer.mergeAll(KnowledgeBaseLive, stub, cacheLayer, GlossaryStub))
      )
    )
    expect(result.mode).toBe("extractive")
    expect(result.answer).not.toContain("图层")
    expect(result.answer.length).toBeGreaterThan(0)
  })

  it("相同问题命中缓存：模型只被调用一次", async () => {
    let calls = 0
    const stub = Layer.succeed(Llm, {
      enabled: true,
      model: "counting",
      composeAnswer: () => {
        calls += 1
        return Effect.succeed(`第 ${calls} 次生成的回答`)
      }
    } satisfies LlmService)

    // 注意：必须在同一个 runtime 内连续提问（缓存是进程内服务；
    // 这也正是线上形态：Layer 在启动时构建一次，跨请求共享缓存）
    const layer = Layer.mergeAll(KnowledgeBaseLive, stub, cacheLayer, GlossaryStub)
    const [first, second] = await run(
      Effect.gen(function* () {
        const a = yield* askQuestion({ question: "怎么安装 Effect？" })
        const b = yield* askQuestion({ question: "怎么安装 Effect？" })
        return [a, b] as const
      }).pipe(Effect.provide(layer))
    )
    expect(calls).toBe(1)
    expect(second.answer).toBe(first.answer)
    expect(second.mode).toBe("llm")
  })

  it("缓存 key 归一化：空白差异不产生新条目", () => {
    const a = cacheKey({ question: "怎么  安装 Effect？" }, "m")
    const b = cacheKey({ question: "  怎么 安装 effect？ " }, "m")
    expect(a).toBe(b)
  })

  it("术语门禁函数本身可用", () => {
    expect(containsForbiddenTerm("这里讲图层", ["图层"])).toBe("图层")
    expect(containsForbiddenTerm("这里讲 Layer", ["图层"])).toBeUndefined()
  })
})

/** 起一个假的 OpenAI 兼容服务，验证 provider 的请求/响应/失败处理 */
const withFakeProvider = async (
  handler: (body: unknown) => { status: number; payload: unknown }
): Promise<{ baseUrl: string; close: () => Promise<void>; requests: Array<unknown> }> => {
  const requests: Array<unknown> = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Array<Buffer> = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      let parsed: unknown = undefined
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = raw
      }
      requests.push(parsed)
      const { status, payload } = handler(parsed)
      response.writeHead(status, { "content-type": "application/json" })
      response.end(JSON.stringify(payload))
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

const citation: Citation = {
  slug: "v4/getting-started/installation",
  version: "v4",
  title: "安装",
  url: "/docs/v4/getting-started/installation/",
  officialUrl: "https://effect.website/docs/v4/getting-started/installation",
  commit: "191459486e0882d4c1b0440850393f1a49c0f1af",
  status: "reviewing",
  quote: "使用 npm 安装 effect。"
}

describe("OpenAI 兼容 provider（无需真实 Key：对假服务验证）", () => {
  it("成功：解析 choices[0].message.content，并把证据放进 prompt", async () => {
    const fake = await withFakeProvider(() => ({
      status: 200,
      payload: { choices: [{ message: { content: "用 npm 安装 effect 即可。" } }] }
    }))
    try {
      const layer = makeOpenAiCompatibleLlm({
        baseUrl: fake.baseUrl,
        apiKey: Redacted.make("test-key"),
        model: "test-model",
        timeoutMs: 5000
      }).pipe(Layer.provide(FetchHttpClient.layer))

      const answer = await Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* Llm
          expect(llm.enabled).toBe(true)
          return yield* llm.composeAnswer({
            question: "怎么安装？",
            citations: [citation],
            fallback: "兜底文本",
            forbiddenTerms: ["图层"]
          })
        }).pipe(Effect.provide(layer))
      )

      expect(answer).toBe("用 npm 安装 effect 即可。")
      const body = fake.requests[0] as {
        model: string
        messages: ReadonlyArray<{ role: string; content: string }>
      }
      expect(body.model).toBe("test-model")
      expect(body.messages[0]?.role).toBe("system")
      expect(body.messages[1]?.content).toContain("证据 1")
      expect(body.messages[1]?.content).toContain("图层")
    } finally {
      await fake.close()
    }
  })

  it("服务报错：返回 undefined（调用方回退 extractive），而不是让问答失败", async () => {
    const fake = await withFakeProvider(() => ({ status: 500, payload: { error: "boom" } }))
    try {
      const layer = makeOpenAiCompatibleLlm({
        baseUrl: fake.baseUrl,
        apiKey: Redacted.make("test-key"),
        model: "test-model",
        timeoutMs: 2000
      }).pipe(Layer.provide(FetchHttpClient.layer))

      const answer = await Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* Llm
          return yield* llm.composeAnswer({
            question: "怎么安装？",
            citations: [citation],
            fallback: "兜底文本",
            forbiddenTerms: []
          })
        }).pipe(Effect.provide(layer))
      )
      expect(answer).toBeUndefined()
    } finally {
      await fake.close()
    }
  })

  it("响应缺字段：视为不可用，返回 undefined", async () => {
    const fake = await withFakeProvider(() => ({ status: 200, payload: { choices: [] } }))
    try {
      const layer = makeOpenAiCompatibleLlm({
        baseUrl: fake.baseUrl,
        apiKey: Redacted.make("test-key"),
        model: "test-model",
        timeoutMs: 2000
      }).pipe(Layer.provide(FetchHttpClient.layer))

      const answer = await Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* Llm
          return yield* llm.composeAnswer({
            question: "怎么安装？",
            citations: [citation],
            fallback: "兜底文本",
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

/** AnswerCache 的端口形态校验（防止实现漂移） */
describe("AnswerCache 端口", () => {
  it("getOrCompute 只执行一次计算", async () => {
    let computed = 0
    const layer = makeAnswerCacheLive({ capacity: 2, ttlMillis: 1000 })
    const value = await Effect.runPromise(
      Effect.gen(function* () {
        const cache = yield* AnswerCache
        const first = yield* cache.getOrCompute(
          "k",
          Effect.sync(() => {
            computed += 1
            return "v"
          })
        )
        const second = yield* cache.getOrCompute(
          "k",
          Effect.sync(() => {
            computed += 1
            return "v"
          })
        )
        return [first, second]
      }).pipe(Effect.provide(layer))
    )
    expect(value).toEqual(["v", "v"])
    expect(computed).toBe(1)
  })
})
