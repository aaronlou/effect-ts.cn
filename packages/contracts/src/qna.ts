/**
 * QnA（问答）上下文的 API 契约。
 *
 * 说明：wire 层 DTO 与领域模型刻意不同构 —— 领域对象不出模块边界，
 * 这里承载的是“用户看到的问答”的传输形态（anti-corruption）。
 */
import { Schema } from "effect"

/** 提问入参 */
export const AskQuestionDto = Schema.Struct({
  title: Schema.NonEmptyString.pipe(Schema.maxLength(200)),
  body: Schema.NonEmptyString.pipe(Schema.maxLength(20_000)),
  tags: Schema.Array(Schema.NonEmptyString.pipe(Schema.maxLength(30))).pipe(
    Schema.maxItems(5)
  )
})
export type AskQuestionDto = Schema.Schema.Type<typeof AskQuestionDto>

/** 单条问题（列表/详情出参） */
export const QuestionDto = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  authorId: Schema.String,
  tags: Schema.Array(Schema.String),
  answerCount: Schema.Number,
  createdAt: Schema.Date
})
export type QuestionDto = Schema.Schema.Type<typeof QuestionDto>

/** 问题列表出参 */
export const QnaQuestionListDto = Schema.Struct({
  items: Schema.Array(QuestionDto),
  total: Schema.Number
})
export type QnaQuestionListDto = Schema.Schema.Type<typeof QnaQuestionListDto>
