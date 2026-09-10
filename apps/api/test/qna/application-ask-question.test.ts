/**
 * 测试金字塔第 2 层：application 用例测试
 * 用「内存仓储 + 确定性 ID + 事件捕获」的 Layer 替换真实依赖。
 */
import { describe, expect, it } from "vitest"
import { Effect, Layer, Option } from "effect"
import { askQuestion } from "../../src/contexts/qna/application/use-cases/ask-question"
import { listQuestions } from "../../src/contexts/qna/application/use-cases/list-questions"
import { QuestionRepository } from "../../src/contexts/qna/domain/ports/question-repository"
import { InMemoryQuestionRepositoryLive } from "../../src/contexts/qna/infrastructure/persistence/in-memory-question-repository"
import { EventPublisher } from "../../src/shared/events"
import { IdGenerator } from "../../src/shared/ports/id-generator"
import { UserId } from "../../src/shared/domain/ids"

/** 确定性 ID：应用层不依赖随机性 */
const testIdGenerator = Layer.succeed(IdGenerator, {
  uuid: () => Effect.succeed("00000000-0000-0000-0000-000000000001")
})

const publishedTags: string[] = []
const testEventPublisher = Layer.succeed(EventPublisher, {
  publish: (event) =>
    Effect.sync(() => {
      publishedTags.push(event._tag)
    })
})

const testEnv = Layer.mergeAll(
  InMemoryQuestionRepositoryLive,
  testIdGenerator,
  testEventPublisher
)

describe("AskQuestion 用例", () => {
  it("提问成功：保存进仓储并发布 QuestionPosted 事件", () => {
    const program = Effect.gen(function* () {
      const created = yield* askQuestion({
        title: "Effect Schema 与 Zod 的区别？",
        body: "想迁移到 Effect",
        tags: ["schema", "zod"],
        authorId: UserId("u-1"),
        now: new Date("2026-01-02T00:00:00Z")
      })
      const all = yield* listQuestions()
      return { created, all }
    })

    // 合法输入不应失败：错误通道用 orDie 折叠（防御性），保留领域失败在另一用例验证
    const { created, all } = Effect.runSync(
      Effect.orDie(Effect.provide(program, testEnv))
    )

    expect(created.id).toBe("00000000-0000-0000-0000-000000000001")
    expect(all).toHaveLength(1)
    expect(all[0]?.title).toBe("Effect Schema 与 Zod 的区别？")
    expect(publishedTags).toContain("QuestionPosted")
  })

  it("仓储端口可在测试中整体替换（体现依赖倒置）", () => {
    // 自定义仓储：永远返回空列表 —— 验证用例只依赖端口而非具体实现
    const emptyRepo = Layer.succeed(QuestionRepository, {
      save: () => Effect.void,
      findById: () => Effect.succeed(Option.none()),
      findAll: () => Effect.succeed([])
    })

    const program = Effect.gen(function* () {
      const all = yield* listQuestions()
      return all.length
    })

    const length = Effect.runSync(
      Effect.orDie(
        Effect.provide(
          program,
          Layer.mergeAll(emptyRepo, testIdGenerator, testEventPublisher)
        )
      )
    )
    expect(length).toBe(0)
  })
})
