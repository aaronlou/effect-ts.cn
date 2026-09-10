/**
 * Assistant 上下文 · 应用用例：AskQuestion
 *
 * 固定流程（顺序即不变量）：
 *   检索 → 生成引用/拒答 → （可选）模型润色 → 术语门禁 → 缓存 → DTO
 *
 * 关键点：
 * - 拒答直接短路，**不会**进入模型（不给出"没有依据的流畅答案"）；
 * - 模型输出必须过术语门禁，不合规则回退 extractive；
 * - 缓存按 问题+范围+版本+模型 归一化，重复问题零成本。
 */
import { Effect } from "effect"
import type { AskRequestDto, AskResponseDto } from "@ecn/contracts"
import type { Citation } from "@ecn/knowledge"
import { KnowledgeBase, type KnowledgeBaseService } from "../../../knowledge/domain/ports/knowledge-base"
import { AnswerCache, type AnswerCacheService } from "../ports/answer-cache"
import { Glossary, type GlossaryService } from "../ports/glossary"
import { Llm, type LlmService } from "../ports/llm"

export function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ")
}

export function containsForbiddenTerm(text: string, forbidden: ReadonlyArray<string>): string | undefined {
  for (const term of forbidden) {
    if (term.length > 0 && text.includes(term)) return term
  }
  return undefined
}

export function cacheKey(request: AskRequestDto, model: string): string {
  return [
    model,
    request.version ?? "any",
    request.scope ?? "global",
    String(request.maxCitations ?? 3),
    normalizeQuestion(request.question)
  ].join("|")
}

export const askQuestion = (
  request: AskRequestDto
): Effect.Effect<
  AskResponseDto,
  never,
  KnowledgeBaseService | LlmService | AnswerCacheService | GlossaryService
> =>
  Effect.gen(function* () {
    const knowledge = yield* KnowledgeBase
    const llm = yield* Llm
    const cache = yield* AnswerCache
    const glossary = yield* Glossary

    const key = cacheKey(request, llm.enabled ? llm.model : "extractive")

    return yield* cache.getOrCompute(
      key,
      Effect.gen(function* () {
        const result = yield* knowledge.ask(request.question, {
          ...(request.scope !== undefined ? { scope: request.scope } : {}),
          ...(request.version !== undefined ? { version: request.version } : {}),
          ...(request.maxCitations !== undefined ? { maxCitations: request.maxCitations } : {})
        })

        if (result.refused) {
          return {
            question: result.question,
            mode: "extractive" as const,
            answer: "",
            citations: [],
            refused: true,
            ...(result.refusal !== undefined ? { refusal: result.refusal } : {}),
            stalePages: [],
            disclaimer: result.disclaimer
          } satisfies AskResponseDto
        }

        const citations: ReadonlyArray<Citation> = result.citations
        let answer = result.answer
        let mode: "extractive" | "llm" = "extractive"

        if (llm.enabled) {
          const polished = yield* llm.composeAnswer({
            question: request.question,
            citations,
            fallback: result.answer,
            forbiddenTerms: glossary.forbidden
          })
          if (polished !== undefined && polished.trim() !== "") {
            const violation = containsForbiddenTerm(polished, glossary.forbidden)
            if (violation === undefined) {
              answer = polished
              mode = "llm"
            } else {
              yield* Effect.logWarning(
                `模型输出违反术语门禁（命中「${violation}」）→ 回退 extractive`
              )
            }
          }
        }

        return {
          question: result.question,
          mode,
          answer,
          citations,
          refused: false,
          stalePages: result.stalePages,
          disclaimer: result.disclaimer
        } satisfies AskResponseDto
      })
    )
  })
