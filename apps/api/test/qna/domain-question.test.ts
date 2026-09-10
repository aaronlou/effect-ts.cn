/**
 * 测试金字塔第 1 层：domain 单元测试（纯领域，无 I/O）
 */
import { describe, expect, it } from "vitest"
import { Effect, Either } from "effect"
import { AnswerId, QuestionId, UserId } from "../../src/shared/domain/ids"
import {
  Question,
  createQuestion
} from "../../src/contexts/qna/domain/model/question"

const validInput = {
  id: QuestionId("q-1"),
  title: "  Effect 的 Layer 怎么用？ ",
  body: "看文档没看懂",
  authorId: UserId("u-1"),
  tags: ["Effect", "layer", "  Layer ", "  "],
  now: new Date("2026-01-01T00:00:00Z")
}

describe("createQuestion（领域不变量）", () => {
  it("标题与正文 trim，标签去重且小写归一", () => {
    const q = Effect.runSync(createQuestion(validInput))
    expect(q.title).toBe("Effect 的 Layer 怎么用？")
    expect(q.tags).toEqual(["effect", "layer"])
  })

  it("空标题 → InvalidQuestionError", () => {
    const result = Effect.runSync(
      Effect.either(createQuestion({ ...validInput, title: "   " }))
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("InvalidQuestionError")
    }
  })

  it("超过 5 个标签时静默截断到 5 个", () => {
    const q = Effect.runSync(
      createQuestion({
        ...validInput,
        tags: ["a", "b", "c", "d", "e", "f", "g"]
      })
    )
    expect(q.tags).toHaveLength(5)
  })
})

describe("Question.addAnswer（聚合行为）", () => {
  it("追加回答并更新 answerCount；空内容被拒绝", () => {
    const q = Effect.runSync(createQuestion(validInput))
    const withAnswer = Effect.runSync(
      q.addAnswer({
        id: AnswerId("a-1"),
        authorId: UserId("u-2"),
        body: "  看这篇：effect.website/docs  ",
        now: new Date("2026-01-02T00:00:00Z")
      })
    )
    expect(withAnswer).toBeInstanceOf(Question)
    expect(withAnswer.answerCount).toBe(1)
    expect(withAnswer.answers[0]?.body).toBe("看这篇：effect.website/docs")

    const rejected = Effect.runSync(
      Effect.either(q.addAnswer({ id: AnswerId("a-2"), authorId: UserId("u-2"), body: "  ", now: new Date() }))
    )
    expect(Either.isLeft(rejected)).toBe(true)
  })
})
