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

/**
 * 上一轮问答的"可定位摘要"（与契约 `AskHistoryTurnDto` 同形，assistant 层不依赖 DTO）。
 * 刻意不含上一轮的模型正文：历史只用于**改写查询**，不用于改写事实。
 */
export interface AskHistoryTurn {
  readonly question: string
  readonly citations: ReadonlyArray<{
    readonly slug: string
    readonly title: string
    readonly anchor?: string
  }>
}

/** 重排候选：只给"能定序"的最小信息 */
export interface RerankCandidate {
  readonly title: string
  readonly anchor?: string
  readonly text: string
}

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
    /** 已经发生过的多轮问答（仅用于行文连贯；事实仍只看 citations） */
    readonly history?: ReadonlyArray<AskHistoryTurn>
  }) => Effect.Effect<string | undefined>

  /**
   * 指代消解：把"它呢？""那 v3 呢？"改写成**可以独立检索**的查询。
   *
   * 可选能力：实现方可以选择不提供（缺失 ⇒ 直接用原问题检索，退化成单轮）。
   * 任何失败都必须返回 `undefined`，绝不能因此让问答失败。
   */
  readonly rewriteQuery?: (input: {
    readonly question: string
    readonly history: ReadonlyArray<AskHistoryTurn>
  }) => Effect.Effect<string | undefined>

  /**
   * 术语化扩展：把白话问题改写成 2–4 条"文档会用的说法"（如「两件事同时跑」→「Fiber 并发」），
   * 用于第一次检索偏弱时补召回；结果与原查询做 RRF 融合（只影响排序，不改变引用来源）。
   */
  readonly expandQueries?: (input: {
    readonly question: string
    readonly history: ReadonlyArray<AskHistoryTurn>
  }) => Effect.Effect<ReadonlyArray<string> | undefined>

  /**
   * 候选重排：给候选片段，返回**下标顺序**（0 基）。
   * 调用方只接受"换顺序"—— 增删候选、伪造引用在结构上就不可能。
   */
  readonly rerank?: (input: {
    readonly question: string
    readonly candidates: ReadonlyArray<RerankCandidate>
  }) => Effect.Effect<ReadonlyArray<number> | undefined>
}

export const Llm = Context.GenericTag<LlmService>("assistant/Llm")
