/**
 * 模型提供方决策的表驱动测试。
 *
 * 为什么值得单独测：`.env` 是最容易配错、也最难发现的地方 ——
 * 空值、只给一半、只想用 DeepSeek、想接本地 Ollama……组合很多，
 * 而错了的表现是"AI 变笨了"而不是"崩了"，很难在用户侧发现。
 */
import { describe, expect, it } from "vitest"
import { decideProvider, DEEPSEEK_BASE_URL } from "../../src/contexts/assistant/infrastructure/llm/provider-config"

describe("零配置 ⇒ extractive（本地与 CI 无需 Key）", () => {
  it("什么都没有时用 extractive", () => {
    const decision = decideProvider({})
    expect(decision.kind).toBe("extractive")
  })

  it("空字符串（.env 里写了 = 但没填）同样视为未设置", () => {
    const decision = decideProvider({ LLM_API_KEY: "   ", DEEPSEEK_API_KEY: "", LLM_BASE_URL: "" })
    expect(decision.kind).toBe("extractive")
  })

  it("只给 Key 不给地址（非 DeepSeek）⇒ 拒绝启用，而不是发到错误的地方", () => {
    const decision = decideProvider({ LLM_API_KEY: "sk-x" })
    expect(decision.kind).toBe("extractive")
  })
})

describe("DeepSeek 预设", () => {
  it("只给 DEEPSEEK_API_KEY ⇒ 自动用 DeepSeek 官方地址与 deepseek-chat", () => {
    const decision = decideProvider({ DEEPSEEK_API_KEY: "sk-deepseek" })
    expect(decision.kind).toBe("llm")
    if (decision.kind !== "llm") return
    expect(decision.provider).toBe("deepseek")
    expect(decision.config.baseUrl).toBe(DEEPSEEK_BASE_URL)
    expect(decision.config.model).toBe("deepseek-chat")
  })

  it("LLM_PROVIDER=deepseek + DEEPSEEK_API_KEY 等价", () => {
    const decision = decideProvider({ LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "sk-deepseek" })
    expect(decision.kind === "llm" && decision.provider === "deepseek").toBe(true)
  })

  it("deepseek-reasoner 自动给更长的超时（推理模型慢）", () => {
    const decision = decideProvider({ DEEPSEEK_API_KEY: "sk-deepseek", LLM_MODEL: "deepseek-reasoner" })
    expect(decision.kind === "llm" && decision.config.timeoutMs >= 60_000).toBe(true)
  })

  it("显式配置优先于预设（可用于代理 / 自建网关）", () => {
    const decision = decideProvider({
      DEEPSEEK_API_KEY: "sk-deepseek",
      LLM_BASE_URL: "https://gateway.internal/v1/",
      LLM_MODEL: "deepseek-chat-v3"
    })
    expect(decision.kind).toBe("llm")
    if (decision.kind !== "llm") return
    expect(decision.config.baseUrl).toBe("https://gateway.internal/v1")
    expect(decision.config.model).toBe("deepseek-chat-v3")
  })

  it("LLM_PROVIDER=deepseek 但没有 Key ⇒ extractive 并说明原因", () => {
    const decision = decideProvider({ LLM_PROVIDER: "deepseek" })
    expect(decision.kind).toBe("extractive")
    if (decision.kind === "extractive") expect(decision.reason).toContain("DEEPSEEK_API_KEY")
  })
})

describe("任意 OpenAI 兼容服务", () => {
  it("LLM_BASE_URL + LLM_API_KEY 生效，超时可覆盖", () => {
    const decision = decideProvider({
      LLM_BASE_URL: "http://127.0.0.1:11434/v1",
      LLM_API_KEY: "ollama",
      LLM_MODEL: "qwen2.5",
      LLM_TIMEOUT_MS: "5000"
    })
    expect(decision.kind).toBe("llm")
    if (decision.kind !== "llm") return
    expect(decision.provider).toBe("openai-compatible")
    expect(decision.config.baseUrl).toBe("http://127.0.0.1:11434/v1")
    expect(decision.config.timeoutMs).toBe(5000)
  })

  it("超时值非法时回落到默认，而不是 NaN 传给 Effect.timeout", () => {
    const decision = decideProvider({ LLM_BASE_URL: "http://x/v1", LLM_API_KEY: "k", LLM_TIMEOUT_MS: "abc" })
    expect(decision.kind === "llm" && Number.isFinite(decision.config.timeoutMs)).toBe(true)
  })
})
