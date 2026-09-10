/**
 * infrastructure · InMemory QuestionRepository
 * 开发/测试默认实现（无 DB 也能跑通全栈），通过 Layer 一键切换。
 */
import { Effect, HashMap, Layer, Ref } from "effect"
import type { QuestionId } from "../../../../shared/domain/ids"
import type { Question } from "../../domain/model/question"
import { QuestionRepository } from "../../domain/ports/question-repository"

export const InMemoryQuestionRepositoryLive = Layer.scoped(
  QuestionRepository,
  Effect.gen(function* () {
    const store = yield* Ref.make(HashMap.empty<QuestionId, Question>())

    return QuestionRepository.of({
      save: (question) =>
        Ref.update(store, (map) => HashMap.set(map, question.id, question)),
      findById: (id) =>
        Ref.get(store).pipe(Effect.map((map) => HashMap.get(map, id))),
      findAll: () =>
        Ref.get(store).pipe(Effect.map((map) => Array.from(HashMap.values(map))))
    })
  })
)
