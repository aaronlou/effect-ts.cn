/**
 * interfaces/http · questions 组实现（anti-corruption 层）
 *
 * 职责：
 * - 从 HTTP 请求取上下文（Phase 0 用 X-User-Id 头模拟，真实身份来自 IdentityContext）；
 * - 调用 application 层用例；
 * - 领域/应用错误 → wire 错误（contracts）映射；
 * - 聚合 → DTO 映射（领域对象不出边界）。
 */
import { HttpApiBuilder, HttpServerRequest } from "@effect/platform"
import { Effect, Option } from "effect"
import type { QnaQuestionListDto, QuestionDto } from "@ecn/contracts"
import { BadRequestError, NotFoundError } from "@ecn/contracts"
import { QuestionId, UserId } from "../../shared/domain/ids"
import type { Question } from "../../contexts/qna/domain/model/question"
import { askQuestion } from "../../contexts/qna/application/use-cases/ask-question"
import { getQuestion } from "../../contexts/qna/application/use-cases/get-question"
import { listQuestions } from "../../contexts/qna/application/use-cases/list-questions"
import { Api } from "./api"

/** 聚合 → wire DTO */
const questionToDto = (question: Question): QuestionDto => ({
  id: question.id,
  title: question.title,
  body: question.body,
  authorId: question.authorId,
  tags: question.tags,
  answerCount: question.answerCount,
  createdAt: question.createdAt
})

export const QuestionsGroupLive = HttpApiBuilder.group(Api, "questions", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle("ask", ({ payload }) =>
        Effect.gen(function* () {
          // TODO(IdentityContext)：Phase 2 改为从会话/令牌解析真实用户，
          // 此处仅为骨架演示可插拔的身份来源。
          const request = yield* HttpServerRequest.HttpServerRequest
          const header = request.headers["x-user-id"]
          const raw = Array.isArray(header) ? header[0] : header
          const authorId = UserId(raw ?? "anonymous")

          const question = yield* askQuestion({
            title: payload.title,
            body: payload.body,
            tags: payload.tags,
            authorId,
            now: new Date()
          }).pipe(
            Effect.mapError((error) => new BadRequestError({ message: error.message }))
          )
          return questionToDto(question)
        })
      )
      .handle("getById", ({ path: { id } }) =>
        Effect.gen(function* () {
          const maybe = yield* getQuestion(QuestionId(id))
          if (Option.isNone(maybe)) {
            return yield* Effect.fail(
              new NotFoundError({ message: `问题不存在：${id}` })
            )
          }
          return questionToDto(maybe.value)
        })
      )
      .handle("list", () =>
        Effect.gen(function* () {
          const items = yield* listQuestions()
          const dto: QnaQuestionListDto = {
            items: items.map(questionToDto),
            total: items.length
          }
          return dto
        })
      )
  })
)
