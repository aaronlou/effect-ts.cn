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
import { Llm, type AskHistoryTurn, type LlmService } from "../../application/ports/llm"
import { ExtractiveLlmLive } from "./extractive-llm"
import { TokenBudget, type TokenBudgetService } from "./token-budget"
import { decideProvider } from "./provider-config"

const ChatCompletion = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({ content: Schema.NullOr(Schema.String) })
    })
  ),
  /**
   * token 用量。**可选**是刻意的：OpenAI 兼容服务不保证返回 usage，
   * 缺了也只是少记一笔账，不该让整次问答失败。
   */
  usage: Schema.optional(
    Schema.Struct({
      total_tokens: Schema.optional(Schema.Number),
      prompt_tokens: Schema.optional(Schema.Number),
      completion_tokens: Schema.optional(Schema.Number)
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

/**
 * 追问改写（指代消解）。只做"把追问补全成可独立检索的查询"这一件事：
 * - 不解释、不回答、不加标点结尾 —— 输出会被直接当作检索查询；
 * - 不允许引入历史里没有的主题（否则等于替用户扩大了问题）。
 */
const REWRITE_SYSTEM_PROMPT = `你在把一个"追问"改写成可以独立检索的查询。规则：
1. 结合上一轮在聊什么，把代词与省略补全（"它""这个""那 v3 呢"→ 具体名词）；
2. 保留英文 API 名与类型名（Effect.gen、Layer、Fiber、Schema、Stream、Effect.orDie 等）；
3. 只输出改写后的查询本身：一行、不超过 40 字、不要解释、不要编号、不要引号。
4. 如果追问本身已经完整，就原样输出。`

/**
 * 术语化扩展：本站的痛点是"白话查不到"（实测「怎么让两件事同时跑？」在全量语料上拒答），
 * 所以这里明确要求"换成文档会用的说法"，并要求覆盖不同角度以便 RRF 融合。
 */
const EXPAND_SYSTEM_PROMPT = `用户会用大白话问 Effect 的问题，而文档用的是术语。请把问题改写成 2~4 条更适合在 Effect 中文文档里检索的查询。规则：
1. 每条一行，不要编号、不要引号、不要解释，每条不超过 30 字；
2. 尽量使用文档会用到的说法：并发 / Fiber / Layer / 依赖注入 / Schema / Stream / 错误处理 / 资源管理 / Effect.gen 等；
3. 各条尽量覆盖不同角度（同义改写、换术语、补上可能的 API 名），不要重复；
4. 不要引入用户没问的主题；如果问题本身就是术语，可以直接保留原问题作为一条。`

const RERANK_SYSTEM_PROMPT = `下面有若干候选文档片段。请按"能否回答用户问题"的相关程度从高到低排序。规则：
1. 只输出编号，用逗号分隔，例如：2,1,3；
2. 必须包含所有编号，不要解释、不要输出其它文字。`

function buildUserPrompt(input: {
  readonly question: string
  readonly citations: ReadonlyArray<Citation>
  readonly forbiddenTerms: ReadonlyArray<string>
  readonly history?: ReadonlyArray<AskHistoryTurn>
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

/** 历史渲染成"刚聊过什么 + 引用了哪一页哪一节"（刻意不含上一轮的模型正文） */
function renderHistory(history: ReadonlyArray<AskHistoryTurn> | undefined): string {
  if (history === undefined || history.length === 0) return "（无，这是第一轮）"
  return history
    .map((turn, index) => {
      const where =
        turn.citations.length === 0
          ? "（无引用）"
          : turn.citations
              .map(
                (citation) =>
                  `《${citation.title}》(${citation.slug}${citation.anchor !== undefined ? `#${citation.anchor}` : ""})`
              )
              .join("、")
      return `${index + 1}. 问：${turn.question}\n   引用了：${where}`
    })
    .join("\n")
}

/**
 * 单行输出解析：取**第一条不是引导句**的行，去引号、限量。
 *
 * 为什么要跳过引导句：模型偶尔先写"改写如下："再另起一行给查询。
 * 那句引导语一旦被当成查询送去检索，必然查不到 —— 宁可跳过它用下一行。
 */
export function parseSingleLine(raw: string | undefined, maxLength = 200): string | undefined {
  if (raw === undefined) return undefined
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
  const first = lines.find((line) => !line.endsWith("：") && !line.endsWith(":"))
  if (first === undefined) return undefined
  const cleaned = first
    .replace(/^["'“”「『]+/, "")
    .replace(/["'“”」』]+$/, "")
    .replace(/^(\d+[.、)]|[-*•])\s*/, "")
    .trim()
  if (cleaned === "" || cleaned.length > maxLength) return undefined
  return cleaned
}

/** 多行解析（术语化扩展）：去掉编号与空行，去重、限量 */
export function parseQueryLines(
  raw: string | undefined,
  max = 4,
  maxLength = 120
): ReadonlyArray<string> | undefined {
  if (raw === undefined) return undefined
  const lines = raw
    .split("\n")
    .map((line) => line.replace(/^(\d+[.、)]|[-*•])\s*/, "").trim())
    .map((line) => line.replace(/^["'“”「『]+/, "").replace(/["'“”」』]+$/, "").trim())
    .filter((line) => line !== "" && line.length <= maxLength)
  const unique = [...new Set(lines)].slice(0, max)
  return unique.length === 0 ? undefined : unique
}

/**
 * 重排输出解析。
 *
 * 关键：返回的永远是**完整排列**（解析出的合法下标 + 原顺序补齐的剩余下标）。
 * 这样"模型漏了几个编号"不会导致候选被丢弃 —— 只会退化为部分重排。
 */
export function parseRerankOrder(
  raw: string | undefined,
  count: number
): ReadonlyArray<number> | undefined {
  if (raw === undefined || count <= 0) return undefined
  const matches = raw.match(/\d+/g)
  if (matches === null) return undefined
  const picked: Array<number> = []
  for (const match of matches) {
    const value = Number.parseInt(match, 10) - 1
    if (value >= 0 && value < count && !picked.includes(value)) picked.push(value)
  }
  if (picked.length === 0) return undefined
  for (let index = 0; index < count; index += 1) {
    if (!picked.includes(index)) picked.push(index)
  }
  return picked
}

export interface ProviderConfig {
  readonly baseUrl: string
  readonly apiKey: Redacted.Redacted
  readonly model: string
  readonly timeoutMs?: number
}

export function makeOpenAiCompatibleLlm(
  config: ProviderConfig
): Layer.Layer<LlmService, never, HttpClient.HttpClient | TokenBudgetService> {
  const timeoutMs = config.timeoutMs ?? 20_000

  return Layer.effect(
    Llm,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient

      /**
       * 一次 chat 调用：超时 + 指数退避重试 + 失败即 `undefined`。
       * 所有能力（润色 / 改写 / 扩展 / 重排）共用这一条路径，因此**任何一项失败都不会让问答失败**。
       */
      const chat = (
        system: string,
        user: string,
        maxTokens: number,
        label: string
      ): Effect.Effect<string | undefined> =>
        Effect.gen(function* () {
          // 预算硬止损：超了就直接不调，让上层自然回退 extractive。
          // 这是"宁可朴素，不可烧钱"的落点 —— 站点照常可用，只是不再有模型润色。
          const allowed = yield* budget.canSpend
          if (!allowed) {
            const status = yield* budget.status
            yield* Effect.logWarning(
              `LLM ${label} 跳过：今日 token 预算已用尽（${status.used}/${status.limit}），本次问答降级为检索合成`
            )
            return undefined
          }
          // DeepSeek 的推理模型（deepseek-reasoner）不接受 temperature —— 传了会被忽略，
          // 但显式省略更诚实：不要发我们自己也知道无效的参数。
          const sampling = config.model.includes("reasoner") ? {} : { temperature: 0.2 }
          const request = HttpClientRequest.post(`${config.baseUrl}/chat/completions`).pipe(
            HttpClientRequest.setHeader("authorization", `Bearer ${Redacted.value(config.apiKey)}`),
            HttpClientRequest.bodyUnsafeJson({
              model: config.model,
              ...sampling,
              max_tokens: maxTokens,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user }
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
          // 记账：提示 + 生成都算钱，所以用 total_tokens
          const spent = decoded.usage?.total_tokens ?? 0
          if (spent > 0) yield* budget.spend(spent)
          const content = decoded.choices[0]?.message.content
          return content === null || content === undefined || content.trim() === ""
            ? undefined
            : content.trim()
        }).pipe(
          // 失败即回退：不把"模型不可用"变成"问答不可用"
          Effect.catchAllCause((cause) =>
            Effect.logWarning(`LLM ${label} 失败，回退：${String(cause)}`).pipe(Effect.as(undefined))
          )
        )

      const budget = yield* TokenBudget

      const service: LlmService = {
        enabled: true,
        model: config.model,
        composeAnswer: (input) =>
          chat(
            input.intent === "diagnose" ? DIAGNOSE_SYSTEM_PROMPT : SYSTEM_PROMPT,
            buildUserPrompt({
              question: input.question,
              citations: input.citations,
              forbiddenTerms: input.forbiddenTerms
            }),
            700,
            "润色"
          ),
        rewriteQuery: (input) =>
          chat(
            REWRITE_SYSTEM_PROMPT,
            `刚聊过的内容：\n${renderHistory(input.history)}\n\n本轮追问：${input.question}\n\n改写后的查询：`,
            200,
            "追问改写"
          ).pipe(Effect.map((raw) => parseSingleLine(raw))),
        expandQueries: (input) =>
          chat(
            EXPAND_SYSTEM_PROMPT,
            `用户的问题：${input.question}\n\n检索查询（每条一行）：`,
            300,
            "术语化扩展"
          ).pipe(Effect.map((raw) => parseQueryLines(raw))),
        rerank: (input) =>
          chat(
            RERANK_SYSTEM_PROMPT,
            `问题：${input.question}\n\n候选：\n${input.candidates
              .map((candidate, index) => {
                const section = candidate.anchor !== undefined ? ` › ${candidate.anchor}` : ""
                return `${index + 1}. 《${candidate.title}》${section}\n${candidate.text}`
              })
              .join("\n\n")}\n\n相关度排序（编号用逗号分隔）：`,
            80,
            "候选重排"
          ).pipe(Effect.map((raw) => parseRerankOrder(raw, input.candidates.length)))
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
export const LlmLive: Layer.Layer<
  LlmService,
  ConfigError.ConfigError,
  HttpClient.HttpClient | TokenBudgetService
> = Layer.unwrapEffect(
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
