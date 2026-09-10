/**
 * `pnpm llm:check` —— 用真实模型跑一次端到端问答/报错诊断。
 *
 * 为什么要有这条命令：
 * 模型接错的表现通常不是"崩"，而是"AI 突然变笨/开始胡说"，很难发现。
 * 这里把整条链路跑一遍并打印**决策结果**（用了哪家、哪个模型、超时多少），
 * 让人/Agent 在 10 秒内确认配置生效，且三条不变量仍然成立：
 *   1. 引用只来自检索（模型不产生链接）；
 *   2. 拒答不进入模型（没有依据时不编答案）；
 *   3. 模型输出必须过术语门禁，否则回退 extractive。
 *
 * 用法：
 *   cp .env.example .env   # 填入 DEEPSEEK_API_KEY=sk-...
 *   pnpm --filter @ecn/api llm:check
 *   pnpm --filter @ecn/api llm:check "Layer 怎么做依赖注入？"
 */
import { describeLoadedEnv, loadedEnvFiles } from "../src/bootstrap/load-env"
import { Effect, Layer, Redacted } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { askQuestion } from "../src/contexts/assistant/application/use-cases/ask-question"
import { explainError } from "../src/contexts/assistant/application/use-cases/explain-error"
import { KnowledgeBaseLive } from "../src/contexts/knowledge/infrastructure/knowledge-base-live"
import { makeAnswerCacheLive } from "../src/contexts/assistant/infrastructure/answer-cache-live"
import { GlossaryLive } from "../src/contexts/assistant/infrastructure/glossary-live"
import { makeOpenAiCompatibleLlm } from "../src/contexts/assistant/infrastructure/llm/openai-compatible-llm"
import { ExtractiveLlmLive } from "../src/contexts/assistant/infrastructure/llm/extractive-llm"
import { decideProvider, type ProviderEnv } from "../src/contexts/assistant/infrastructure/llm/provider-config"

const env: ProviderEnv = {
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL
}

const decision = decideProvider(env)

console.log(`── 配置来源 ─────────────────────────────`)
console.log(`已加载：${describeLoadedEnv()}`)
if (loadedEnvFiles.length === 0) {
  console.log("提示：未找到 .env 文件 —— 只用命令行环境变量（仍可正常工作）")
}
console.log("")
console.log("── 模型配置 ─────────────────────────────")
if (decision.kind === "extractive") {
  console.log(`模式：extractive（无模型）`)
  console.log(`原因：${decision.reason}`)
  console.log("")
  console.log("要启用模型：cp .env.example .env 并填入 DEEPSEEK_API_KEY=sk-...（或 LLM_BASE_URL + LLM_API_KEY）")
} else {
  console.log(`模式：模型润色（${decision.provider}）`)
  console.log(`模型：${decision.config.model}`)
  console.log(`地址：${decision.config.baseUrl}`)
  console.log(`超时：${decision.config.timeoutMs}ms`)
  console.log(`Key ：已配置（${decision.config.apiKey.length} 字符，不显示内容）`)
}
console.log("")

const llmLayer =
  decision.kind === "llm"
    ? makeOpenAiCompatibleLlm({
        baseUrl: decision.config.baseUrl,
        apiKey: Redacted.make(decision.config.apiKey),
        model: decision.config.model,
        timeoutMs: decision.config.timeoutMs
      })
    : ExtractiveLlmLive

const ServicesLive = Layer.mergeAll(
  KnowledgeBaseLive,
  makeAnswerCacheLive({ capacity: 50, ttlMillis: 1_000 }),
  GlossaryLive,
  Layer.provide(llmLayer, FetchHttpClient.layer)
)

const questions = process.argv.slice(2).filter((argument) => !argument.startsWith("-"))
const first = questions[0] ?? "Layer 怎么做依赖注入？"

const report = (title: string, body: string): void => {
  console.log(`── ${title} ─────────────────────────────`)
  console.log(body)
  console.log("")
}

const program = Effect.gen(function* () {
  const answer = yield* askQuestion({ question: first })
  if (answer.refused) {
    report(
      `提问：${first}`,
      `拒答（${answer.refusal?.reason ?? "unknown"}）：${answer.refusal?.message ?? ""}\n` +
        `（拒答不会进入模型 —— 这是"宁可说不知道"的不变量）`
    )
  } else {
    const citations = answer.citations
      .map((citation, index) => {
        const anchor = citation.anchor !== undefined ? `#${citation.anchor}` : ""
        return `  ${index + 1}. 《${citation.title}》 ${citation.url}${anchor}（基线 ${citation.commit?.slice(0, 7) ?? "未标注"}）`
      })
      .join("\n")
    report(
      `提问：${first}`,
      [`模式：${answer.mode}`, "", answer.answer, "", "引用（只来自检索，模型无法伪造）：", citations].join("\n")
    )
  }

  const explained = yield* explainError({
    errorText:
      "TS2345: Argument of type 'Layer.Layer<Database, never, never>' is not assignable to parameter of type 'Layer.Layer<never, never, never>'"
  })
  report(
    "报错诊断（intent=diagnose）",
    [
      `模式：${explained.mode}`,
      `提取到的标识符：${explained.identifiers.join(", ") || "（无）"}`,
      "",
      explained.refused ? `拒答：${explained.refusal?.message ?? ""}` : explained.answer,
      "",
      `引用：${explained.citations.map((citation) => citation.slug).join(", ") || "（无）"}`
    ].join("\n")
  )

  const second = questions[1]
  if (second !== undefined) {
    const extra = yield* askQuestion({ question: second })
    report(
      `提问：${second}`,
      extra.refused
        ? `拒答（${extra.refusal?.reason ?? "unknown"}）`
        : `模式：${extra.mode}\n${extra.answer}`
    )
  }
})

await Effect.runPromise(
  program.pipe(
    Effect.provide(ServicesLive),
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        console.error("链路执行失败：", String(cause))
        process.exitCode = 1
      })
    )
  )
)
