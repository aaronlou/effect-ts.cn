/**
 * interfaces/http · knowledge 组（AI 知识层对外接口）
 *
 *   POST /api/knowledge/ask    提问（JSON）
 *   GET  /api/knowledge/ask?q= 提问（便于 curl / Agent）
 *   GET  /api/knowledge/stats  语料与模式统计
 *
 * 两点实现要点：
 * - 限流在 HTTP 边界完成（需要请求上下文），业务不变量留在 application 层；
 * - HttpApi 的 handler 必须是"无依赖 effect"，因此在 group 构建期就把
 *   服务实例 provide 进 handler（见 wired），而 group 的 Layer 依赖仍由 bootstrap 满足。
 */
import { HttpApiBuilder, HttpServerRequest } from "@effect/platform"
import { Effect, Option } from "effect"
import {
  AskResponseDto,
  ExplainResponseDto,
  KnowledgeStatsDto,
  RateLimitedError,
  type AskRequestDto,
  type ExplainRequestDto
} from "@ecn/contracts"
import { Api } from "./api"
import { askQuestion } from "../../contexts/assistant/application/use-cases/ask-question"
import { explainError } from "../../contexts/assistant/application/use-cases/explain-error"
import { AnswerCache, type AnswerCacheService } from "../../contexts/assistant/application/ports/answer-cache"
import { Glossary, type GlossaryService } from "../../contexts/assistant/application/ports/glossary"
import { Llm, type LlmService } from "../../contexts/assistant/application/ports/llm"
import { RateLimiter } from "../../contexts/assistant/infrastructure/rate-limiter"
import { KnowledgeBase, type KnowledgeBaseService } from "../../contexts/knowledge/domain/ports/knowledge-base"

const callerKey = (request: HttpServerRequest.HttpServerRequest): string => {
  const forwarded = request.headers["x-forwarded-for"]
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() ?? "unknown"
  }
  return Option.getOrElse(request.remoteAddress, () => "unknown")
}

type AssistantDeps = KnowledgeBaseService | LlmService | AnswerCacheService | GlossaryService

export const KnowledgeGroupLive = HttpApiBuilder.group(Api, "knowledge", (handlers) =>
  Effect.gen(function* () {
    const limiter = yield* RateLimiter
    const knowledge = yield* KnowledgeBase
    const glossary = yield* Glossary
    const llm = yield* Llm
    const cache = yield* AnswerCache

    /** 把应用用例的依赖在构建期注入，使 handler 成为无依赖 effect */
    const wired = <A, E>(effect: Effect.Effect<A, E, AssistantDeps>): Effect.Effect<A, E> =>
      effect.pipe(
        Effect.provideService(KnowledgeBase, knowledge),
        Effect.provideService(Llm, llm),
        Effect.provideService(AnswerCache, cache),
        Effect.provideService(Glossary, glossary)
      )

    const respond = (
      request: HttpServerRequest.HttpServerRequest,
      payload: AskRequestDto
    ): Effect.Effect<AskResponseDto, RateLimitedError> =>
      Effect.gen(function* () {
        const decision = yield* limiter.check(`ask:${callerKey(request)}`)
        if (!decision.allowed) {
          return yield* Effect.fail(
            new RateLimitedError({
              message: "提问太频繁了，请稍后再试（配额按分钟计）。",
              retryAfterSeconds: decision.retryAfterSeconds
            })
          )
        }
        return yield* wired(askQuestion(payload))
      })

    const respondExplain = (
      request: HttpServerRequest.HttpServerRequest,
      payload: ExplainRequestDto
    ): Effect.Effect<ExplainResponseDto, RateLimitedError> =>
      Effect.gen(function* () {
        const decision = yield* limiter.check(`explain:${callerKey(request)}`)
        if (!decision.allowed) {
          return yield* Effect.fail(
            new RateLimitedError({
              message: "请求太频繁了，请稍后再试。",
              retryAfterSeconds: decision.retryAfterSeconds
            })
          )
        }
        return yield* wired(explainError(payload))
      })

    return handlers
      .handle("explain", ({ payload }) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          return yield* respondExplain(request, payload)
        })
      )
      .handle("ask", ({ payload }) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          return yield* respond(request, payload)
        })
      )
      .handle("askGet", ({ urlParams }) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          return yield* respond(request, { question: urlParams.q })
        })
      )
      .handle("stats", () =>
        Effect.gen(function* () {
          const stats = yield* knowledge.stats()
          const generatedAt = yield* knowledge.generatedAt()
          return {
            pages: stats.pages,
            chunks: stats.chunks,
            pendingPages: stats.pendingPages,
            upstreamHead: stats.upstreamHead,
            glossaryTerms: glossary.termCount,
            llmEnabled: llm.enabled,
            ...(llm.enabled ? { llmModel: llm.model } : {}),
            generatedAt
          } satisfies KnowledgeStatsDto
        })
      )
  })
)
