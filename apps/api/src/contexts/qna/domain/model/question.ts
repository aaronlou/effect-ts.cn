/**
 * QnA 上下文 · 聚合根 Question（含成员实体 Answer）与创建工厂。
 *
 * 设计取舍（见 PLAN.md §5.3）：
 * - Answer 归属于 Question 聚合：采纳回答需要修改 Question.acceptedAnswerId，
 *   同聚合内保证「采纳」的唯一一致性，避免跨聚合事务。
 * - 回答/投票的“读多”场景走投影（CQRS 式读模型），不让聚合无限膨胀。
 */
import { Data, Effect } from "effect"
import { AnswerId, QuestionId, Tag, UserId } from "../../../../shared/domain/ids"
import { InvalidQuestionError } from "../errors"

export class Answer {
  constructor(
    readonly id: AnswerId,
    readonly authorId: UserId,
    readonly body: string,
    readonly createdAt: Date
  ) {}
}

export class Question {
  constructor(
    readonly id: QuestionId,
    readonly title: string,
    readonly body: string,
    readonly authorId: UserId,
    readonly tags: ReadonlyArray<Tag>,
    readonly createdAt: Date,
    readonly acceptedAnswerId: AnswerId | null = null,
    readonly answers: ReadonlyArray<Answer> = []
  ) {}

  get answerCount(): number {
    return this.answers.length
  }

  /**
   * 领域行为示例：追加回答。
   * Phase 2 将扩展：不能回答自己的问题、采纳约束、关闭问题等不变量。
   */
  addAnswer(input: {
    id: AnswerId
    authorId: UserId
    body: string
    now: Date
  }): Effect.Effect<Question, InvalidQuestionError> {
    const body = input.body.trim()
    if (body.length === 0) {
      return Effect.fail(new InvalidQuestionError({ message: "回答内容不能为空" }))
    }
    if (this.answers.length >= 500) {
      return Effect.fail(new InvalidQuestionError({ message: "单个问题的回答数已达上限" }))
    }
    const answer = new Answer(input.id, input.authorId, body, input.now)
    return Effect.succeed(
      new Question(
        this.id,
        this.title,
        this.body,
        this.authorId,
        this.tags,
        this.createdAt,
        this.acceptedAnswerId,
        [...this.answers, answer]
      )
    )
  }
}

/** 创建问题（纯函数 + Effect 表达失败，domain 不 throw） */
export const createQuestion = (input: {
  id: QuestionId
  title: string
  body: string
  authorId: UserId
  tags: ReadonlyArray<string>
  now: Date
}): Effect.Effect<Question, InvalidQuestionError> =>
  Effect.suspend(() => {
    const title = input.title.trim()
    const body = input.body.trim()

    if (title.length === 0 || title.length > 200) {
      return Effect.fail(
        new InvalidQuestionError({ message: "标题不能为空且不超过 200 字符" })
      )
    }
    if (body.length === 0 || body.length > 20_000) {
      return Effect.fail(
        new InvalidQuestionError({ message: "内容不能为空且不超过 20000 字符" })
      )
    }

    // 标签值对象约束：trim、小写、去重、最多 5 个、单个 ≤ 30 字符
    // 纯空白标签静默忽略（UI 可能夹带空格，不值得打断用户）。
    const seen = new Set<string>()
    const tags: Array<Tag> = []
    for (const raw of input.tags) {
      const t = raw.trim().toLowerCase()
      if (t.length === 0) continue
      if (t.length > 30) {
        return Effect.fail(
          new InvalidQuestionError({ message: "标签需为 1–30 个字符" })
        )
      }
      if (!seen.has(t) && tags.length < 5) {
        seen.add(t)
        tags.push(Tag(t))
      }
    }

    return Effect.succeed(
      new Question(input.id, title, body, input.authorId, tags, input.now)
    )
  })
