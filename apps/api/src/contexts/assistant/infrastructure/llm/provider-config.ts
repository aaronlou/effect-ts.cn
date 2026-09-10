/**
 * Assistant 上下文 · infrastructure：模型提供方决策（纯函数，可单测）。
 *
 * 为什么把"选哪家模型"从 Layer 里抠出来：
 * - 这部分全是**配置判定**（谁提供 Key、用哪个 baseUrl、超时多少），最容易出错也最该被测；
 * - 抠出来之后没有 Effect/网络依赖，可以穷举各种 `.env` 组合做表驱动测试。
 *
 * 支持的形态：
 * 1. **零配置** ⇒ extractive（无模型，完全可溯源、零成本）—— 默认，本地/CI 无需 Key；
 * 2. `DEEPSEEK_API_KEY` ⇒ 自动按 DeepSeek 预设（`https://api.deepseek.com` + `deepseek-chat`）；
 * 3. `LLM_PROVIDER=deepseek` + `DEEPSEEK_API_KEY` ⇒ 同上（显式写法）；
 * 4. 任意 OpenAI 兼容服务：`LLM_BASE_URL` + `LLM_API_KEY`（+ `LLM_MODEL`）。
 *
 * 一条容易踩的坑：`.env` 里写了 `LLM_API_KEY=`（空值）时，`Config.option` 会给出 `Some("")`，
 * 于是我们会带着空 Bearer 去请求。这里统一把**空白值当作未设置**。
 */

export interface ProviderRequest {
  /** 形如 https://api.deepseek.com（不带尾斜杠；实际请求路径为 `${baseUrl}/chat/completions`） */
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly timeoutMs: number
}

export type ProviderDecision =
  | { readonly kind: "extractive"; readonly reason: string }
  | {
      readonly kind: "llm"
      /** 便于日志/UI 展示，永远不含 Key 本身 */
      readonly provider: string
      readonly config: ProviderRequest
    }

export interface ProviderEnv {
  readonly LLM_PROVIDER?: string | undefined
  readonly LLM_BASE_URL?: string | undefined
  readonly LLM_API_KEY?: string | undefined
  readonly LLM_MODEL?: string | undefined
  readonly LLM_TIMEOUT_MS?: string | undefined
  readonly DEEPSEEK_API_KEY?: string | undefined
  readonly DEEPSEEK_BASE_URL?: string | undefined
  readonly DEEPSEEK_MODEL?: string | undefined
}

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com"
export const DEEPSEEK_MODEL = "deepseek-chat"
/** 推理模型慢得多：给更大的默认超时，避免"用上就超时" */
export const DEEPSEEK_REASONER = "deepseek-reasoner"

const clean = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "")

export function decideProvider(env: ProviderEnv): ProviderDecision {
  const explicitBaseUrl = clean(env.LLM_BASE_URL)
  const explicitApiKey = clean(env.LLM_API_KEY)
  const deepseekApiKey = clean(env.DEEPSEEK_API_KEY)
  const providerHint = clean(env.LLM_PROVIDER)?.toLowerCase()
  const deepseekBaseUrl = clean(env.DEEPSEEK_BASE_URL) ?? DEEPSEEK_BASE_URL
  const deepseekModel = clean(env.DEEPSEEK_MODEL) ?? DEEPSEEK_MODEL

  const wantsDeepSeek =
    providerHint === "deepseek" || (providerHint === undefined && explicitApiKey === undefined && deepseekApiKey !== undefined)

  if (wantsDeepSeek) {
    if (deepseekApiKey === undefined && explicitApiKey === undefined) {
      return {
        kind: "extractive",
        reason: "LLM_PROVIDER=deepseek 但没有可用的 DEEPSEEK_API_KEY / LLM_API_KEY"
      }
    }
    const model = clean(env.LLM_MODEL) ?? deepseekModel
    return {
      kind: "llm",
      provider: "deepseek",
      config: {
        baseUrl: normalizeBaseUrl(explicitBaseUrl ?? deepseekBaseUrl),
        apiKey: explicitApiKey ?? (deepseekApiKey as string),
        model,
        timeoutMs: readTimeout(env, model.includes("reasoner") ? 120_000 : 30_000)
      }
    }
  }

  const apiKey = explicitApiKey ?? deepseekApiKey
  if (apiKey === undefined) {
    return {
      kind: "extractive",
      reason: "未配置 LLM_API_KEY / DEEPSEEK_API_KEY → 使用 extractive 模式（无模型、完全可溯源、零成本）"
    }
  }

  const inferredDeepSeek = explicitApiKey === undefined && deepseekApiKey !== undefined
  const model = clean(env.LLM_MODEL) ?? (inferredDeepSeek ? deepseekModel : "gpt-4o-mini")
  const baseUrl = explicitBaseUrl ?? (inferredDeepSeek ? deepseekBaseUrl : undefined)
  if (baseUrl === undefined) {
    return {
      kind: "extractive",
      reason: "配置了 LLM_API_KEY 但缺少 LLM_BASE_URL（任意 OpenAI 兼容服务都要显式给出地址）"
    }
  }

  return {
    kind: "llm",
    provider: inferredDeepSeek ? "deepseek" : "openai-compatible",
    config: {
      baseUrl: normalizeBaseUrl(baseUrl),
      apiKey,
      model,
      timeoutMs: readTimeout(env, model.includes("reasoner") ? 120_000 : 30_000)
    }
  }
}

function readTimeout(env: ProviderEnv, fallback: number): number {
  const raw = clean(env.LLM_TIMEOUT_MS)
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
