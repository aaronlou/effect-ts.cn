/**
 * QnA · 应用查询：GetQuestion（返回 Option；404 的呈现决策留给 interfaces 层）
 */
import { Effect, Option } from "effect"
import type { QuestionId } from "../../../../shared/domain/ids"
import type { Question } from "../../domain/model/question"
import { QuestionRepository } from "../../domain/ports/question-repository"

export const getQuestion = (
  id: QuestionId
): Effect.Effect<Option.Option<Question>, never, QuestionRepository> =>
  Effect.gen(function* () {
    const repository = yield* QuestionRepository
    return yield* repository.findById(id)
  })
