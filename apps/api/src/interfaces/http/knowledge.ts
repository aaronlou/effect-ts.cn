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
import { Effect } from "effect"
import {
  AskResponseDto,
  ExplainResponseDto,
  KnowledgeStatsDto,
  RateLimitedError,
  type AskRequestDto,
  type ExplainRequestDto
} from "@ecn/contracts"
import { Api } from "./api"
import { clientKeyFrom } from "./client-address"
import { AppConfig } from "../../bootstrap/config"
import { askQuestion } from "../../contexts/assistant/application/use-cases/ask-question"
import { explainError } from "../../contexts/assistant/application/use-cases/explain-error"
import { AnswerCache, type AnswerCacheService } from "../../contexts/assistant/application/ports/answer-cache"
import { Glossary, type GlossaryService } from "../../contexts/assistant/application/ports/glossary"
import {
  ErrorEncyclopedia,
  type ErrorEncyclopediaService
} from "../../contexts/assistant/application/ports/error-encyclopedia"
import { NotFoundError } from "@ecn/contracts"
import { Llm, type LlmService } from "../../contexts/assistant/application/ports/llm"
import { RateLimiter } from "../../contexts/assistant/infrastructure/rate-limiter"
import { TokenBudget } from "../../contexts/assistant/infrastructure/llm/token-budget"
import { KnowledgeBase, type KnowledgeBaseService } from "../../contexts/knowledge/domain/ports/knowledge-base"

type AssistantDeps =
  | KnowledgeBaseService
  | LlmService
  | AnswerCacheService
  | GlossaryService
  | ErrorEncyclopediaService

export const KnowledgeGroupLive = HttpApiBuilder.group(Api, "knowledge", (handlers) =>
  Effect.gen(function* () {
    const limiter = yield* RateLimiter
    const budget = yield* TokenBudget
    const config = yield* AppConfig
    const askDailyLimitPerIp = config.askDailyLimitPerIp
    const clientKey = (request: HttpServerRequest.HttpServerRequest): string =>
      clientKeyFrom(request, { trustProxy: config.trustProxyHeaders })
    const knowledge = yield* KnowledgeBase
    const glossary = yield* Glossary
    const encyclopedia = yield* ErrorEncyclopedia
    const llm = yield* Llm
    const cache = yield* AnswerCache

    /** 把应用用例的依赖在构建期注入，使 handler 成为无依赖 effect */
    const wired = <A, E>(effect: Effect.Effect<A, E, AssistantDeps>): Effect.Effect<A, E> =>
      effect.pipe(
        Effect.provideService(KnowledgeBase, knowledge),
        Effect.provideService(Llm, llm),
        Effect.provideService(AnswerCache, cache),
        Effect.provideService(Glossary, glossary),
        Effect.provideService(ErrorEncyclopedia, encyclopedia)
      )

    const respond = (
      request: HttpServerRequest.HttpServerRequest,
      payload: AskRequestDto
    ): Effect.Effect<AskResponseDto, RateLimitedError> =>
      Effect.gen(function* () {
        const key = clientKey(request)
        const decision = yield* limiter.check(`ask:${key}`)
        if (!decision.allowed) {
          return yield* Effect.fail(
            new RateLimitedError({
              message: "提问太频繁了，请稍后再试（配额按分钟计）。",
              retryAfterSeconds: decision.retryAfterSeconds
            })
          )
        }
        // 日限流：分钟限流防突发，日限流防"细水长流把当天预算耗干"
        const daily = yield* limiter.checkDaily(`ask:${key}`, askDailyLimitPerIp)
        if (!daily.allowed) {
          return yield* Effect.fail(
            new RateLimitedError({
              message: "今天的提问次数已用完，明天再来（每日配额按来源计）。",
              retryAfterSeconds: daily.retryAfterSeconds
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
        const decision = yield* limiter.check(`explain:${clientKey(request)}`)
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
      .handle("errors", ({ urlParams }) =>
        Effect.gen(function* () {
          const [entries, total] = yield* Effect.all([encyclopedia.list({ limit: urlParams.limit ?? 50 }), encyclopedia.size])
          return { entries: [...entries], total }
        })
      )
      .handle("errorEntry", ({ path: { signature } }) =>
        Effect.gen(function* () {
          const entry = yield* encyclopedia.get(signature)
          if (entry === undefined) {
            return yield* Effect.fail(
              new NotFoundError({ message: `报错百科里没有这个条目：${signature}` })
            )
          }
          return entry
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
          const budgetStatus = yield* budget.status
          return {
            pages: stats.pages,
            chunks: stats.chunks,
            pendingPages: stats.pendingPages,
            citations: stats.citations,
            upstreamHead: stats.upstreamHead,
            glossaryTerms: glossary.termCount,
            errorEntries: yield* encyclopedia.size,
            llmEnabled: llm.enabled,
            ...(llm.enabled ? { llmModel: llm.model } : {}),
            // 今日 token 用量与硬止损状态：让运维**随时能看见**花了多少、还剩多少
            ...(llm.enabled
              ? {
                  llmBudget: {
                    used: budgetStatus.used,
                    limit: budgetStatus.limit,
                    // 不限额度时 remaining 是 Infinity，JSON 里没有意义 ⇒ 用 -1 表示"不限"
                    remaining: Number.isFinite(budgetStatus.remaining) ? budgetStatus.remaining : -1,
                    exhausted: budgetStatus.exhausted,
                    resetAt: new Date(budgetStatus.resetAt).toISOString()
                  }
                }
              : {}),
            generatedAt
          } satisfies KnowledgeStatsDto
        })
      )
  })
)
