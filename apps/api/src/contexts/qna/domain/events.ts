/**
 * QnA 上下文 · 领域事件
 */
import type { Question } from "./model/question"

export interface QuestionPostedEvent {
  readonly _tag: "QuestionPosted"
  readonly question: Question
}

export type QnaDomainEvent = QuestionPostedEvent
