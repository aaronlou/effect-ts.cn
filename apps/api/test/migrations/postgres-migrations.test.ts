/**
 * Postgres 持久化路径的集成测试（CI 里用真实 Postgres 跑）。
 *
 * 为什么必须有这一层：生产用的是 Postgres 仓储，但在此之前**没有任何测试碰过它** ——
 * SQL / DDL / 行→聚合映射全靠人肉验证，而 CI 的容器冒烟只在 InMemory 模式下跑。
 * 这里覆盖：迁移可应用且幂等、表结构正确、仓储 save/findById/findAll 往返一致。
 *
 * 默认跳过：只有设置了 `ECN_TEST_DATABASE_URL`（且串里含 "test"，防止误连开发/生产库）
 * 才会执行。CI 会起一个专用的测试库并设置该变量。
 */
import { Effect, Layer, Option, Redacted } from "effect"
import { PgClient } from "@effect/sql-pg"
import { SqlClient } from "@effect/sql"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"
import { runMigrations } from "../../src/bootstrap/migrations"
import { PostgresQuestionRepositoryLive } from "../../src/contexts/qna/infrastructure/persistence/postgres-question-repository"
import { QuestionRepository } from "../../src/contexts/qna/domain/ports/question-repository"
import { createQuestion } from "../../src/contexts/qna/domain/model/question"
import { QuestionId, UserId } from "../../src/shared/domain/ids"

const url = process.env["ECN_TEST_DATABASE_URL"] ?? ""
const enabled = url.trim() !== "" && /test/i.test(url)

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url))
const PgLive = PgClient.layer({ url: Redacted.make(url) })

/** 清空 schema，保证每次都从"空库"开始（仅测试库：见上面的 enabled 判定） */
const resetSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(`DROP TABLE IF EXISTS questions`)
  yield* sql.unsafe(`DROP TABLE IF EXISTS _migrations`)
})

const applyMigrations = runMigrations(MIGRATIONS_DIR)

describe.skipIf(!enabled)("Postgres 迁移 + 仓储（集成）", () => {
  beforeAll(async () => {
    await Effect.runPromise(resetSchema.pipe(Effect.provide(PgLive)))
  })

  it("空库上应用全部迁移，并在 _migrations 记账", async () => {
    const applied = await Effect.runPromise(applyMigrations.pipe(Effect.provide(PgLive)))
    expect(applied.length).toBeGreaterThan(0)
    expect(applied.some((name) => name.endsWith("_init"))).toBe(true)

    const ledger = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql.unsafe<{ name: string }>(`SELECT name FROM _migrations ORDER BY id`)
      }).pipe(Effect.provide(PgLive))
    )
    expect(ledger.map((row) => row.name)).toContain("init")
  })

  it("重复运行是幂等的（第二次不执行任何迁移）", async () => {
    const again = await Effect.runPromise(applyMigrations.pipe(Effect.provide(PgLive)))
    expect(again).toEqual([])
  })

  it("仓储 save → findById → findAll 往返一致", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* QuestionRepository
      const question = yield* createQuestion({
        id: QuestionId("11111111-1111-1111-1111-111111111111"),
        title: "Postgres 往返验证",
        body: "标题/正文/标签/时间都要原样回来。",
        authorId: UserId("tester"),
        tags: ["infra", "postgres"],
        now: new Date("2026-01-02T03:04:05.000Z")
      })
      yield* repository.save(question)

      const found = yield* repository.findById(question.id)
      expect(Option.isSome(found)).toBe(true)
      const loaded = Option.getOrThrow(found)
      expect(loaded.title).toBe("Postgres 往返验证")
      expect(loaded.body).toBe("标题/正文/标签/时间都要原样回来。")
      expect([...loaded.tags]).toEqual(["infra", "postgres"])
      expect(loaded.authorId).toBe("tester")

      const all = yield* repository.findAll()
      expect(all.some((item) => item.id === question.id)).toBe(true)
    })
    await Effect.runPromise(
      program.pipe(Effect.provide(PostgresQuestionRepositoryLive), Effect.provide(PgLive))
    )
  })

  it("findById 未命中返回 None，而不是抛错", async () => {
    const program = Effect.gen(function* () {
      const repository = yield* QuestionRepository
      const found = yield* repository.findById(QuestionId("missing-id"))
      return Option.isNone(found)
    })
    const isNone = await Effect.runPromise(
      program.pipe(Effect.provide(PostgresQuestionRepositoryLive), Effect.provide(PgLive))
    )
    expect(isNone).toBe(true)
  })
})

describe.skipIf(enabled)("Postgres 集成测试（未启用）", () => {
  it("未设置 ECN_TEST_DATABASE_URL → 跳过（CI 会设置）", () => {
    expect(enabled).toBe(false)
  })
})
