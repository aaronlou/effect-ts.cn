/**
 * QnA 上下文 · 领域错误（错误即领域词汇）
 */
import { Data } from "effect"
import type { QuestionId } from "../../../shared/domain/ids"

/** 违反问题/回答不变量（应由边界 Schema 预先挡住；此处是领域内最后防线） */
export class InvalidQuestionError extends Data.TaggedError("InvalidQuestionError")<{
  readonly message: string
}> {}

/** 问题不存在 */
export class QuestionNotFoundError extends Data.TaggedError("QuestionNotFoundError")<{
  readonly id: QuestionId
}> {}
