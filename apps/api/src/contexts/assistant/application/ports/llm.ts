/**
 * Assistant 上下文 · 端口：答案润色模型（LLM）
 *
 * 设计上的关键约束（见 docs/ai-native.md）：
 * - **引用不归模型管**：模型只负责把"检索到的证据"写成连贯中文；
 *   citations 由检索层构造，因此模型无法伪造链接；
 * - 模型失败/超时/违反术语 ⇒ 一律回退到 extractive（宁可朴素，不可胡说）；
 * - 未配置模型时，`enabled: false`，系统仍完整可用（零 Key 可跑）。
 */
import { Context, Effect } from "effect"
import type { Citation } from "@ecn/knowledge"

export interface LlmService {
  readonly enabled: boolean
  readonly model: string
  /**
   * 用检索到的引用把答案写成连贯中文。
   * 返回 `undefined` 表示"不采用模型输出"（调用方回退 extractive）。
   */
  readonly composeAnswer: (input: {
    readonly question: string
    readonly citations: ReadonlyArray<Citation>
    /** 已由检索层组装好的兜底文本（模型只做润色，不做事实来源） */
    readonly fallback: string
    /** 术语黑名单：模型输出必须遵守 */
    readonly forbiddenTerms: ReadonlyArray<string>
    /**
     * 意图：`answer` 润色文档问答；`diagnose` 针对报错给出诊断。
     * 两者证据来源相同（检索结果），只是提示词不同 —— 因此引用始终可溯源。
     */
    readonly intent?: "answer" | "diagnose"
  }) => Effect.Effect<string | undefined>
}

export const Llm = Context.GenericTag<LlmService>("assistant/Llm")
