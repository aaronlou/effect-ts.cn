/**
 * infrastructure · 报错百科（Postgres）。
 *
 * 表结构归 `apps/api/migrations/assistant/0002_error_entries.sql` 所有，这里只读写。
 *
 * 两个实现细节值得留意：
 * - **upsert 用 `hits = error_entries.hits + 1`**，不是先读后写：并发提问同一报错时，
 *   先读后写会丢计数（两个请求都读到 3，都写 4）。计数是排序依据，丢多了列表就失真。
 * - **引用以 JSON 文本存**：我们从不按引用内部字段查询，没必要承受 jsonb 的绑定差异；
 *   解析失败时回退成空数组，不让一条脏数据把整个列表打挂。
 */
import { Effect, Layer } from "effect"
import { SqlClient } from "@effect/sql"
import type { Citation } from "@ecn/knowledge"
import {
  ErrorEncyclopedia,
  type ErrorEncyclopediaEntry,
  type ErrorEncyclopediaService
} from "../application/ports/error-encyclopedia"

interface ErrorEntryRow {
  readonly signature: string
  readonly codes: ReadonlyArray<string> | null
  readonly symbols: ReadonlyArray<string> | null
  readonly error_text: string
  readonly code: string | null
  readonly answer: string
  readonly citations: string
  readonly mode: string
  readonly hits: number
  readonly first_seen: Date
  readonly last_seen: Date
  readonly reviewed: boolean
}

const LIST_ANSWER_LIMIT = 240

const parseCitations = (raw: string): ReadonlyArray<Citation> => {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ReadonlyArray<Citation>) : []
  } catch {
    return []
  }
}

const rowToEntry = (row: ErrorEntryRow): ErrorEncyclopediaEntry => ({
  signature: row.signature,
  codes: row.codes ?? [],
  symbols: row.symbols ?? [],
  errorText: row.error_text,
  ...(row.code === null ? {} : { code: row.code }),
  answer: row.answer,
  citations: parseCitations(row.citations),
  mode: row.mode === "llm" ? "llm" : "extractive",
  hits: row.hits,
  firstSeen: row.first_seen.toISOString(),
  lastSeen: row.last_seen.toISOString(),
  reviewed: row.reviewed
})

export const PostgresErrorEncyclopediaLive: Layer.Layer<
  ErrorEncyclopediaService,
  never,
  SqlClient.SqlClient
> = Layer.effect(
  ErrorEncyclopedia,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    return ErrorEncyclopedia.of({
      record: (input) =>
        sql`
          INSERT INTO error_entries
            (signature, codes, symbols, error_text, code, answer, citations, mode, hits, first_seen, last_seen, reviewed)
          VALUES
            (${input.signature}, ${input.codes}, ${input.symbols}, ${input.errorText},
             ${input.code ?? null}, ${input.answer}, ${JSON.stringify(input.citations)}, ${input.mode},
             1, now(), now(), false)
          ON CONFLICT (signature) DO UPDATE SET
            hits       = error_entries.hits + 1,
            answer     = EXCLUDED.answer,
            citations  = EXCLUDED.citations,
            mode       = EXCLUDED.mode,
            code       = COALESCE(EXCLUDED.code, error_entries.code),
            last_seen  = now()
        `.pipe(Effect.orDie),
      list: (options) =>
        Effect.gen(function* () {
          const limit = options?.limit ?? 50
          const rows = yield* sql<ErrorEntryRow>`
            SELECT signature, codes, symbols, error_text, code,
                   left(answer, ${LIST_ANSWER_LIMIT}) AS answer,
                   citations, mode, hits, first_seen, last_seen, reviewed
            FROM error_entries
            ORDER BY hits DESC, last_seen DESC
            LIMIT ${limit}
          `.pipe(Effect.orDie)
          return rows.map(rowToEntry)
        }),
      get: (signature) =>
        Effect.gen(function* () {
          const rows = yield* sql<ErrorEntryRow>`
            SELECT signature, codes, symbols, error_text, code, answer,
                   citations, mode, hits, first_seen, last_seen, reviewed
            FROM error_entries
            WHERE signature = ${signature}
            LIMIT 1
          `.pipe(Effect.orDie)
          const row = rows[0]
          return row === undefined ? undefined : rowToEntry(row)
        }),
      size: Effect.gen(function* () {
        const rows = yield* sql<{ count: string }>`SELECT count(*)::text AS count FROM error_entries`.pipe(
          Effect.orDie
        )
        return Number(rows[0]?.count ?? "0")
      })
    })
  })
)
