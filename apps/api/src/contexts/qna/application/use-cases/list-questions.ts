/**
 * QnA · 应用查询：ListQuestions
 */
import { Effect } from "effect"
import type { Question } from "../../domain/model/question"
import { QuestionRepository } from "../../domain/ports/question-repository"

export const listQuestions = (): Effect.Effect<
  ReadonlyArray<Question>,
  never,
  QuestionRepository
> =>
  Effect.gen(function* () {
    const repository = yield* QuestionRepository
    return yield* repository.findAll()
  })
