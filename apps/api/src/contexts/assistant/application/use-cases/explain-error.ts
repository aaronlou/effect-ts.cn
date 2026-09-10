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
import type { ExplainRequestDto, ExplainResponseDto } from "@ecn/contracts"
import { KnowledgeBase, type KnowledgeBaseService } from "../../../knowledge/domain/ports/knowledge-base"
import { AnswerCache, type AnswerCacheService } from "../ports/answer-cache"
import { Glossary, type GlossaryService } from "../ports/glossary"
import { Llm, type LlmService } from "../ports/llm"
import { containsForbiddenTerm } from "./ask-question"

export function explainCacheKey(request: ExplainRequestDto, model: string): string {
  const normalized = request.errorText.trim().replace(/\s+/g, " ")
  return ["explain", model, normalized.slice(0, 400), request.code === undefined ? "nocode" : "code"].join("|")
}

export const explainError = (
  request: ExplainRequestDto
): Effect.Effect<
  ExplainResponseDto,
  never,
  KnowledgeBaseService | LlmService | AnswerCacheService | GlossaryService
> =>
  Effect.gen(function* () {
    const knowledge = yield* KnowledgeBase
    const llm = yield* Llm
    const cache = yield* AnswerCache
    const glossary = yield* Glossary

    const key = explainCacheKey(request, llm.enabled ? llm.model : "extractive")

    return yield* cache.getOrCompute(
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
  })
