/**
 * bootstrap · SQL 迁移执行器
 *
 * 为什么手写这个小执行器，而不是用 `@effect/sql` 自带的 Migrator：
 * - 它自带的 FileSystem loader 只识别 `NNNN_name.(ts|js)` **模块**（运行时 `import()`），
 *   不支持仓库计划的 `.sql` 文件，也不递归子目录（见 `@effect/sql/Migrator/FileSystem`）；
 * - 迁移用 SQL 写，评审时能直接看到 DDL，不必先读懂一段 Effect 程序。
 *
 * 行为约定（与 migrations/README.md 一致）：
 * - 递归收集 `**\/*.sql`，按文件名数字前缀升序；
 * - 编号重复 → 直接报错（宁可启动失败，也不乱序执行）；
 * - `_migrations` 表记账（id / name / applied_at）；
 * - 每个迁移在**一个事务**里执行，失败即回滚并中止启动。
 */
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { Data, Effect } from "effect"
import { SqlClient } from "@effect/sql"

export class MigrationError extends Data.TaggedError("MigrationError")<{
  readonly reason: "read" | "duplicate-id" | "apply"
  readonly message: string
  readonly file?: string
}> {}

export interface MigrationFile {
  readonly id: number
  readonly name: string
  /** 绝对路径 */
  readonly file: string
}

const FILE_PATTERN = /^(\d+)_([A-Za-z0-9._-]+)\.sql$/
export const MIGRATIONS_TABLE = "_migrations"

const readFailure = (cause: unknown, file?: string): MigrationError =>
  new MigrationError({ reason: "read", message: String(cause), ...(file === undefined ? {} : { file }) })

/**
 * SqlError 的 `message` 往往只有一句 "Failed to execute statement"，
 * 真正有用的（syntax error / relation does not exist…）在 `cause` 里。
 * 迁移失败是启动失败，报错必须一眼能定位，所以把两层都带上。
 */
const describeCause = (cause: unknown): string => {
  if (cause === null || typeof cause !== "object") return String(cause)
  const outer = (cause as { message?: unknown }).message
  const inner = (cause as { cause?: unknown }).cause
  const innerMessage =
    inner instanceof Error ? inner.message : inner === undefined ? undefined : String(inner)
  return [outer, innerMessage].filter((part) => typeof part === "string" && part.length > 0).join(" ← ") ||
    String(cause)
}

/** 递归收集迁移文件并按数字前缀排序 */
export const collectMigrations = (
  dir: string
): Effect.Effect<ReadonlyArray<MigrationFile>, MigrationError> =>
  Effect.gen(function* () {
    const walk = (current: string): Effect.Effect<ReadonlyArray<string>, MigrationError> =>
      Effect.gen(function* () {
        const entries = yield* Effect.tryPromise({
          try: () => readdir(current, { withFileTypes: true }),
          catch: (cause) => readFailure(cause, current)
        })
        const found: Array<string> = []
        for (const entry of entries) {
          const full = path.join(current, entry.name)
          if (entry.isDirectory()) found.push(...(yield* walk(full)))
          else if (FILE_PATTERN.test(entry.name)) found.push(full)
        }
        return found
      })

    const names = yield* walk(dir)
    const parsed = names.map((file) => {
      const match = FILE_PATTERN.exec(path.basename(file)) as RegExpExecArray
      return { id: Number(match[1]), name: match[2] as string, file }
    })
    parsed.sort((left, right) => left.id - right.id)
    for (let index = 1; index < parsed.length; index += 1) {
      const previous = parsed[index - 1] as MigrationFile
      const current = parsed[index] as MigrationFile
      if (current.id === previous.id) {
        return yield* new MigrationError({
          reason: "duplicate-id",
          message: `迁移编号重复：${current.id}（${path.basename(previous.file)} 与 ${path.basename(current.file)}）`,
          file: current.file
        })
      }
    }
    return parsed
  })

/**
 * 应用尚未执行过的迁移，返回本次实际执行的迁移名（已是最新则为空数组）。
 */
export const runMigrations = (
  dir: string,
  table: string = MIGRATIONS_TABLE
): Effect.Effect<ReadonlyArray<string>, MigrationError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const files = yield* collectMigrations(dir)

    yield* sql
      .unsafe(
        `CREATE TABLE IF NOT EXISTS ${table} (
           id         integer PRIMARY KEY,
           name       text NOT NULL,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new MigrationError({ reason: "apply", message: `无法创建迁移记账表：${describeCause(cause)}` })
        )
      )

    const appliedRows = yield* sql.unsafe<{ id: number }>(`SELECT id FROM ${table}`).pipe(
      Effect.mapError(
        (cause) =>
          new MigrationError({ reason: "apply", message: `无法读取迁移记账表：${describeCause(cause)}` })
      )
    )
    const applied = new Set(appliedRows.map((row) => row.id))

    const ran: Array<string> = []
    for (const migration of files) {
      if (applied.has(migration.id)) continue
      const content = yield* Effect.tryPromise({
        try: () => readFile(migration.file, "utf8"),
        catch: (cause) => readFailure(cause, migration.file)
      })
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql.unsafe(content)
            yield* sql.unsafe(`INSERT INTO ${table} (id, name) VALUES ($1, $2)`, [
              migration.id,
              migration.name
            ])
          })
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new MigrationError({
                reason: "apply",
                message: `迁移失败：${path.basename(migration.file)} —— ${describeCause(cause)}`,
                file: migration.file
              })
          )
        )
      ran.push(`${migration.id}_${migration.name}`)
    }
    return ran
  })
