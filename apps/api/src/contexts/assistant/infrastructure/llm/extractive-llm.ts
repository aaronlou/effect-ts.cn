/**
 * Assistant 上下文 · infrastructure：extractive 模式（无模型）
 *
 * 这不是"降级补丁"，而是**默认形态**：零 Key、零成本、离线可用、完全可溯源。
 * 配置了模型时才会换成 OpenAiCompatible 实现（Layer 替换）。
 */
import { Effect, Layer } from "effect"
import { Llm } from "../../application/ports/llm"

export const ExtractiveLlmLive = Layer.succeed(Llm, {
  enabled: false,
  model: "extractive",
  composeAnswer: () => Effect.succeed(undefined)
})
