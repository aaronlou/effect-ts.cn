/**
 * infrastructure · Postgres QuestionRepository（@effect/sql-pg）
 *
 * ⚠️ 迁移策略（Phase 0 说明）：
 * 此处为了“骨架开箱即跑”，在 Layer 构建时执行 CREATE TABLE IF NOT EXISTS。
 * Phase 1 将改为正式 migration 文件（apps/api/migrations/）+ CI 门禁，
 * 见 migrations/README.md。
 *
 * 该实现只有在 DATABASE_URL 被设置时才会被装配（见 bootstrap/main.ts）。
 *
 * 错误策略：SqlError 属基础设施异常（连接断开/约束冲突），
 * 本骨架用 Effect.orDie 将其提升为 defect 统一由运行时兜底；
 * Phase 1 将引入类型化持久化错误并映射为 HTTP 500/409。
 */
import { Effect, Layer, Option } from "effect"
import { SqlClient } from "@effect/sql"
import { QuestionId, Tag, UserId } from "../../../../shared/domain/ids"
import { Question } from "../../domain/model/question"
import { QuestionRepository } from "../../domain/ports/question-repository"

interface QuestionRow {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly author_id: string
  readonly tags: ReadonlyArray<string>
  readonly created_at: Date
}

/** 行 → 聚合（仓储适配器的职责：DB 形状 → 领域形状） */
const rowToQuestion = (row: QuestionRow): Question =>
  new Question(
    QuestionId(row.id),
    row.title,
    row.body,
    UserId(row.author_id),
    row.tags.map((t) => Tag(t)),
    row.created_at,
    // answers 暂不落库（Phase 2 引入 answers 表与迁移）：
    // 内存实现与 Postgres 实现的 answerCount 在此保持一致（均为 0）。
    null,
    []
  )

export const PostgresQuestionRepositoryLive = Layer.scoped(
  QuestionRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`CREATE TABLE IF NOT EXISTS questions (
      id         text PRIMARY KEY,
      title      text NOT NULL,
      body       text NOT NULL,
      author_id  text NOT NULL,
      tags       text[] NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    )`.pipe(Effect.orDie)

    return QuestionRepository.of({
      save: (question) =>
        sql`INSERT INTO questions (id, title, body, author_id, tags, created_at)
            VALUES (${question.id}, ${question.title}, ${question.body},
                    ${question.authorId}, ${question.tags}, ${question.createdAt})`.pipe(
          Effect.asVoid,
          Effect.orDie
        ),

      findById: (id) =>
        sql<QuestionRow>`SELECT id, title, body, author_id, tags, created_at
                          FROM questions WHERE id = ${id}`.pipe(
          Effect.map((rows) => {
            const first = rows[0]
            return first === undefined ? Option.none() : Option.some(rowToQuestion(first))
          }),
          Effect.orDie
        ),

      findAll: () =>
        sql<QuestionRow>`SELECT id, title, body, author_id, tags, created_at
                          FROM questions ORDER BY created_at DESC`.pipe(
          Effect.map((rows) => rows.map(rowToQuestion)),
          Effect.orDie
        )
    })
  })
)
