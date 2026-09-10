/**
 * QnA · 应用用例（写）：AskQuestion
 * 编排：取 ID → 领域工厂校验 → 仓储保存 → 发布领域事件。
 * 一个用例 = 一个事务边界（Phase 2 接入 @effect/sql withTransaction）。
 *
 * 时间由调用方注入（now），保证用例在测试里完全确定。
 */
import { Effect } from "effect"
import { QuestionId, UserId } from "../../../../shared/domain/ids"
import type { Question } from "../../domain/model/question"
import { createQuestion } from "../../domain/model/question"
import type { QuestionPostedEvent } from "../../domain/events"
import { InvalidQuestionError } from "../../domain/errors"
import { QuestionRepository } from "../../domain/ports/question-repository"
import { IdGenerator } from "../../../../shared/ports/id-generator"
import { EventPublisher } from "../../../../shared/events"

export interface AskQuestionInput {
  readonly title: string
  readonly body: string
  readonly tags: ReadonlyArray<string>
  readonly authorId: UserId
  readonly now: Date
}

export const askQuestion = (
  input: AskQuestionInput
): Effect.Effect<
  Question,
  InvalidQuestionError,
  QuestionRepository | IdGenerator | EventPublisher
> =>
  Effect.gen(function* () {
    const repository = yield* QuestionRepository
    const ids = yield* IdGenerator
    const events = yield* EventPublisher

    const id = QuestionId(yield* ids.uuid())
    const question = yield* createQuestion({
      ...input,
      id
    })

    yield* repository.save(question)
    const posted: QuestionPostedEvent = { _tag: "QuestionPosted", question }
    yield* events.publish(posted)

    return question
  })
