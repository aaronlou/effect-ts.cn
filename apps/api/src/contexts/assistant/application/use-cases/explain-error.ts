/**
 * Assistant 上下文 · 应用用例：ExplainError（报错解释 / S2）
 *
 * 与 AskQuestion 同构，只是"证据选择"不同：
 *   从报错里提取 API/类型/错误码 → 检索 → 引用/拒答 →（可选）模型诊断 → 术语门禁 → 缓存
 *
 * 关键取舍：
 * - 未配置模型时**只做定位**，答案文本明确说明"不是自动诊断"，避免给用户虚假的确定感；
 * - 配置模型后，诊断仍以检索到的证据为准（引用由检索构造，模型不能编造 API）；
 * - 拒答时给出可行动出口（到站内 /community 的微信群或开 Issue，或换用 ⌘I 提问）。
 */
import { Effect } from "effect"
import { errorSignature } from "@ecn/knowledge"
import type { ExplainRequestDto, ExplainResponseDto } from "@ecn/contracts"
import {
  ErrorEncyclopedia,
  type ErrorEncyclopediaService
} from "../ports/error-encyclopedia"
import { KnowledgeBase, type KnowledgeBaseService } from "../../../knowledge/domain/ports/knowledge-base"
import { AnswerCache, type AnswerCacheService } from "../ports/answer-cache"
import { Glossary, type GlossaryService } from "../ports/glossary"
import { Llm, type LlmService } from "../ports/llm"
import { containsForbiddenTerm } from "./ask-question"

/**
 * 缓存键。
 *
 * 两个曾经的 bug：
 * 1. `code` 只编码成 "code"/"nocode" —— 同一段报错配**不同代码片段**会命中同一条诊断，
 *    第二个用户看到的是按别人代码生成的结果（code 字段存在的意义就是让诊断更准）；
 * 2. `errorText` 被 `slice(0, 400)` 截断 —— 长报错在后半段才分叉时也会串味。
 *
 * 现在两段内容都完整参与 key（DTO 已把各自限制在 8000 字符内，容量 500 的缓存足够）。
 * 分隔符用 NUL 而不是 `|`：报错文本里本来就有 `|`（联合类型），用 `|` 拼接可被构造碰撞。
 */
export function explainCacheKey(request: ExplainRequestDto, model: string): string {
  const normalize = (value: string): string => value.trim().replace(/\s+/g, " ")
  const codePart = request.code === undefined ? "nocode" : `code:${normalize(request.code)}`
  return ["explain", model, normalize(request.errorText), codePart].join("\u0000")
}

export const explainError = (
  request: ExplainRequestDto
): Effect.Effect<
  ExplainResponseDto,
  never,
  KnowledgeBaseService | LlmService | AnswerCacheService | GlossaryService | ErrorEncyclopediaService
> =>
  Effect.gen(function* () {
    const knowledge = yield* KnowledgeBase
    const llm = yield* Llm
    const cache = yield* AnswerCache
    const glossary = yield* Glossary
    const encyclopedia = yield* ErrorEncyclopedia

    const key = explainCacheKey(request, llm.enabled ? llm.model : "extractive")

    /**
     * 沉淀到报错百科。
     *
     * 放在**缓存之外**是刻意的：缓存命中时也要计一次 hits —— 被问得越多说明越常见，
     * 而"哪些报错最值得先看"正是靠这个排序。
     *
     * 三条不该落库的情况：拒答（没有依据，收进去只是噪声）、特征不足（同理，
     * 判断在 `errorSignature().confident`）、以及记录本身失败（绝不能影响诊断结果 ——
     * 记录是副产品，不是主流程）。
     */
    const record = (response: ExplainResponseDto): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (response.refused) return
        const signature = errorSignature(request.errorText)
        if (!signature.confident) return
        yield* encyclopedia.record({
          signature: signature.id,
          codes: signature.codes,
          symbols: signature.symbols,
          errorText: request.errorText.slice(0, 2000),
          ...(request.code !== undefined ? { code: request.code.slice(0, 2000) } : {}),
          answer: response.answer,
          citations: response.citations,
          mode: response.mode
        })
      }).pipe(
        Effect.catchAllCause((cause) =>
          Effect.logWarning(`报错百科记录失败（不影响诊断）：${String(cause)}`)
        )
      )

    const response = yield* cache.getOrCompute(
      key,
      Effect.gen(function* () {
        const result = yield* knowledge.explain(request.errorText)

        if (result.refused) {
          return {
            identifiers: result.identifiers,
            mode: "extractive" as const,
            answer: "",
            citations: [],
            refused: true,
            ...(result.refusal !== undefined ? { refusal: result.refusal } : {}),
            disclaimer: result.disclaimer
          } satisfies ExplainResponseDto
        }

        let answer = result.answer
        let mode: "extractive" | "llm" = "extractive"

        if (llm.enabled) {
          const diagnosticQuestion =
            request.code !== undefined
              ? `${request.errorText}\n\n相关代码：\n${request.code}`
              : request.errorText
          const polished = yield* llm.composeAnswer({
            question: diagnosticQuestion,
            citations: result.citations,
            fallback: result.answer,
            forbiddenTerms: glossary.forbidden,
            intent: "diagnose"
          })
          if (polished !== undefined && polished.trim() !== "") {
            const violation = containsForbiddenTerm(polished, glossary.forbidden)
            if (violation === undefined) {
              answer = polished
              mode = "llm"
            } else {
              yield* Effect.logWarning(
                `诊断输出违反术语门禁（命中「${violation}」）→ 回退为检索定位`
              )
            }
          }
        }

        return {
          identifiers: result.identifiers,
          mode,
          answer,
          citations: result.citations,
          refused: false,
          disclaimer: result.disclaimer
        } satisfies ExplainResponseDto
      })
    )

    yield* record(response)
    return response
  })
