/**
 * Assistant 上下文 · infrastructure：OpenAI 兼容的答案润色层。
 *
 * 设计取向：
 * - 只做"润色"：证据由检索层给出，模型不允许引入新事实、不允许输出链接；
 * - 任何失败（超时/网络/解析/限流）⇒ 返回 undefined，调用方回退 extractive；
 * - 输出仍要过术语门禁（在应用用例里做）；
 * - 未配置任何 Key 时自动选择 extractive，因此**本地与 CI 无需 Key**；
 * - 支持 DeepSeek 预设（`DEEPSEEK_API_KEY` 或 `LLM_PROVIDER=deepseek`），
 *   也支持任意 OpenAI 兼容服务（`LLM_BASE_URL` + `LLM_API_KEY`）—— 选择逻辑见 provider-config.ts。
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
import { decideProvider } from "./provider-config"

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
            // DeepSeek 的推理模型（deepseek-reasoner）不接受 temperature —— 传了会被忽略，
            // 但显式省略更诚实：不要发我们自己也知道无效的参数。
            const sampling = config.model.includes("reasoner") ? {} : { temperature: 0.2 }
            const request = HttpClientRequest.post(`${config.baseUrl}/chat/completions`).pipe(
              HttpClientRequest.setHeader("authorization", `Bearer ${Redacted.value(config.apiKey)}`),
              HttpClientRequest.bodyUnsafeJson({
                model: config.model,
                ...sampling,
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

/**
 * 按配置自选：有 Key 用模型润色（DeepSeek 或任意 OpenAI 兼容服务），没有则 extractive。
 *
 * 决策逻辑抽到 `provider-config.ts`（纯函数、可穷举测试），这里只负责读环境变量与装配。
 */
export const LlmLive: Layer.Layer<LlmService, ConfigError.ConfigError, HttpClient.HttpClient> = Layer.unwrapEffect(
  Effect.gen(function* () {
    const raw = {
      LLM_PROVIDER: yield* readOption("LLM_PROVIDER"),
      LLM_BASE_URL: yield* readOption("LLM_BASE_URL"),
      LLM_API_KEY: yield* readOption("LLM_API_KEY"),
      LLM_MODEL: yield* readOption("LLM_MODEL"),
      LLM_TIMEOUT_MS: yield* readOption("LLM_TIMEOUT_MS"),
      DEEPSEEK_API_KEY: yield* readOption("DEEPSEEK_API_KEY"),
      DEEPSEEK_BASE_URL: yield* readOption("DEEPSEEK_BASE_URL"),
      DEEPSEEK_MODEL: yield* readOption("DEEPSEEK_MODEL")
    }
    const decision = decideProvider(raw)

    if (decision.kind === "extractive") {
      yield* Effect.logInfo(`模型未启用：${decision.reason}`)
      return ExtractiveLlmLive
    }

    yield* Effect.logInfo(
      `已启用模型润色：${decision.provider} · ${decision.config.model} @ ${decision.config.baseUrl}（超时 ${decision.config.timeoutMs}ms）`
    )
    return makeOpenAiCompatibleLlm({
      baseUrl: decision.config.baseUrl,
      apiKey: Redacted.make(decision.config.apiKey),
      model: decision.config.model,
      timeoutMs: decision.config.timeoutMs
    })
  })
)

/** 读一个可缺失的字符串配置（空白值按"未设置"处理，见 provider-config.ts 的说明） */
const readOption = (name: string): Effect.Effect<string | undefined, ConfigError.ConfigError> =>
  Config.option(Config.string(name)).pipe(Effect.map(Option.getOrUndefined))
