/**
 * QnA 上下文 · 仓储端口（依赖倒置：domain 只认接口，不认 Postgres）
 */
import { Context, Effect, Option } from "effect"
import type { QuestionId } from "../../../../shared/domain/ids"
import type { Question } from "../model/question"

export interface QuestionRepository {
  readonly save: (question: Question) => Effect.Effect<void>
  readonly findById: (id: QuestionId) => Effect.Effect<Option.Option<Question>>
  readonly findAll: () => Effect.Effect<ReadonlyArray<Question>>
}

export const QuestionRepository =
  Context.GenericTag<QuestionRepository>("qna/QuestionRepository")
