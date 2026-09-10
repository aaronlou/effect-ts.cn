/**
 * Assistant 上下文 · infrastructure：OpenAI 兼容的答案润色层。
 *
 * 设计取向：
 * - 只做"润色"：证据由检索层给出，模型不允许引入新事实、不允许输出链接；
 * - 任何失败（超时/网络/解析/限流）⇒ 返回 undefined，调用方回退 extractive；
 * - 输出仍要过术语门禁（在应用用例里做）；
 * - 未配置 `LLM_BASE_URL` + `LLM_API_KEY` 时自动选择 extractive，因此**本地与 CI 无需 Key**。
 *
 * 之所以没有直接用 @effect/ai：当前 stable 线（effect 3.x）里它仍是实验包，
 * 而我们只需要一个 chat completions 调用；用 @effect/platform 的 HttpClient + Schema
 * 已经能拿到类型化错误、超时、重试与可 mock 的 Layer（见 apps/api/test）。
 * 迁移到 @effect/ai / Effect v4 时，本文件是唯一需要替换的地方。
 */
import { Config, ConfigError, Effect, Layer, Option, Redacted, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "@effect/platform"
import type { Citation } from "@ecn/knowledge"
import { Llm, type LlmService } from "../../application/ports/llm"
import { ExtractiveLlmLive } from "./extractive-llm"

const ChatCompletion = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({ content: Schema.NullOr(Schema.String) })
    })
  )
})

const SYSTEM_PROMPT = `你是 Effect（TypeScript 的 effect system）中文社区文档助手。规则：
1. 只能依据"证据"改写答案，不得引入证据之外的事实、版本号或 API。
2. 不得输出任何 URL 或链接（引用由系统附加）。
3. API 名、类型名、库名保留英文（如 Effect.gen、Effect.Effect、Layer、Fiber、Schema、Stream）。
4. 使用中文，术语必须符合社区共识；不要使用生造译名。
5. 证据不足时，直接说明"根据现有中文译文无法确定"，不要猜测。
6. 输出 1~4 句连贯中文，可用短列表；不要输出 Markdown 标题或表格。`

const DIAGNOSE_SYSTEM_PROMPT = `你是 Effect（TypeScript 的 effect system）中文社区的报错诊断助手。规则：
1. 只能依据"证据"（站内中文文档片段）解释报错，不得引入证据之外的 API 或行为。
2. 不得输出任何 URL 或链接（引用由系统附加）。
3. 用中文给出：最可能的原因 + 修复方向，最多 3 句；API 名保留英文。
4. 如果证据不足以判断，直接说"根据现有文档无法确定"，并指出需要补充的信息（如最小复现代码）。
5. 不要使用生造译名（如把 Layer 译成"图层"）。`

function buildUserPrompt(input: {
  readonly question: string
  readonly citations: ReadonlyArray<Citation>
  readonly forbiddenTerms: ReadonlyArray<string>
}): string {
  const evidence = input.citations
    .map((citation, index) => {
      const section = citation.anchor !== undefined ? `#${citation.anchor}` : ""
      return `【证据 ${index + 1}】《${citation.title}》(${citation.slug}${section}，基线 ${citation.commit?.slice(0, 7) ?? "未标注"})\n${citation.quote}`
    })
    .join("\n\n")
  const forbidden =
    input.forbiddenTerms.length > 0 ? `\n\n禁止出现的译法：${input.forbiddenTerms.join("、")}` : ""
  return `问题：${input.question}\n\n证据：\n${evidence}${forbidden}`
}

export interface ProviderConfig {
  readonly baseUrl: string
  readonly apiKey: Redacted.Redacted
  readonly model: string
  readonly timeoutMs?: number
}

export function makeOpenAiCompatibleLlm(
  config: ProviderConfig
): Layer.Layer<LlmService, never, HttpClient.HttpClient> {
  const timeoutMs = config.timeoutMs ?? 20_000

  return Layer.effect(
    Llm,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient

      const service: LlmService = {
        enabled: true,
        model: config.model,
        composeAnswer: (input) =>
          Effect.gen(function* () {
            const request = HttpClientRequest.post(`${config.baseUrl}/chat/completions`).pipe(
              HttpClientRequest.setHeader("authorization", `Bearer ${Redacted.value(config.apiKey)}`),
              HttpClientRequest.bodyUnsafeJson({
                model: config.model,
                temperature: 0.2,
                max_tokens: 700,
                messages: [
                  {
                    role: "system",
                    content: input.intent === "diagnose" ? DIAGNOSE_SYSTEM_PROMPT : SYSTEM_PROMPT
                  },
                  {
                    role: "user",
                    content: buildUserPrompt({
                      question: input.question,
                      citations: input.citations,
                      forbiddenTerms: input.forbiddenTerms
                    })
                  }
                ]
              })
            )

            const response = yield* client.execute(request).pipe(
              Effect.timeout(`${timeoutMs} millis`),
              Effect.retry(
                Schedule.exponential("300 millis").pipe(Schedule.compose(Schedule.recurs(2)))
              )
            )
            const json = yield* response.json
            const decoded = yield* Schema.decodeUnknown(ChatCompletion)(json)
            const content = decoded.choices[0]?.message.content
            return content === null || content === undefined || content.trim() === ""
              ? undefined
              : content.trim()
          }).pipe(
            // 失败即回退：不把"模型不可用"变成"问答不可用"
            Effect.catchAllCause((cause) =>
              Effect.logWarning(`LLM 调用失败，回退 extractive：${String(cause)}`).pipe(
                Effect.as(undefined)
              )
            )
          )
      }

      yield* Effect.logInfo(`已启用模型润色：${config.model} @ ${config.baseUrl}`)
      return service
    })
  )
}

/** 按配置自选：有 Key 用模型润色，没有则 extractive（默认，零 Key 可跑） */
export const LlmLive: Layer.Layer<LlmService, ConfigError.ConfigError, HttpClient.HttpClient> = Layer.unwrapEffect(
  Effect.gen(function* () {
    const baseUrl = yield* Config.option(Config.string("LLM_BASE_URL"))
    const apiKey = yield* Config.option(Config.redacted("LLM_API_KEY"))
    const model = yield* Config.string("LLM_MODEL").pipe(Config.withDefault("gpt-4o-mini"))
    const timeoutMs = yield* Config.number("LLM_TIMEOUT_MS").pipe(Config.withDefault(20_000))

    if (Option.isNone(baseUrl) || Option.isNone(apiKey)) {
      yield* Effect.logInfo(
        "未配置 LLM_BASE_URL / LLM_API_KEY → 使用 extractive 模式（无模型、完全可溯源、零成本）"
      )
      return ExtractiveLlmLive
    }

    return makeOpenAiCompatibleLlm({
      baseUrl: baseUrl.value,
      apiKey: apiKey.value,
      model,
      timeoutMs
    })
  })
)
