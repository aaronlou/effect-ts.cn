/**
 * infrastructure · 报错百科（InMemory）。
 *
 * 为什么需要它：本地开发与 CI 没有 Postgres，但整条链路（记录 → 列表 → 详情）
 * 必须能跑通并被测试。与 QuestionRepository 的 InMemory/Postgres 双实现同一套思路：
 * 端口不变，按 DATABASE_URL 决定装配哪个。
 *
 * 刻意**不设容量上限**：一旦上限到了要淘汰条目，就出现了"哪些报错更值得留"的产品判断，
 * 那应该在有了真实数据之后再决定，而不是先拍一个数字。
 */
import { Effect, Layer, Ref } from "effect"
import {
  ErrorEncyclopedia,
  type ErrorEncyclopediaEntry,
  type ErrorEncyclopediaService,
  type RecordErrorInput
} from "../application/ports/error-encyclopedia"

/** 列表里返回的答案没必要很长（详情页才需要全文） */
const LIST_ANSWER_LIMIT = 240

export const InMemoryErrorEncyclopediaLive: Layer.Layer<ErrorEncyclopediaService> = Layer.effect(
  ErrorEncyclopedia,
  Effect.gen(function* () {
    const store = yield* Ref.make(new Map<string, ErrorEncyclopediaEntry>())

    return ErrorEncyclopedia.of({
      record: (input: RecordErrorInput) =>
        Effect.gen(function* () {
          const now = new Date().toISOString()
          yield* Ref.update(store, (current) => {
            const next = new Map(current)
            const previous = next.get(input.signature)
            next.set(input.signature, {
              signature: input.signature,
              codes: input.codes,
              symbols: input.symbols,
              errorText: input.errorText,
              ...(input.code !== undefined ? { code: input.code } : {}),
              answer: input.answer,
              citations: input.citations,
              mode: input.mode,
              hits: (previous?.hits ?? 0) + 1,
              firstSeen: previous?.firstSeen ?? now,
              lastSeen: now,
              reviewed: previous?.reviewed ?? false
            })
            return next
          })
        }),
      list: (options) =>
        Ref.get(store).pipe(
          Effect.map((current) =>
            [...current.values()]
              .sort((left, right) => right.hits - left.hits || right.lastSeen.localeCompare(left.lastSeen))
              .slice(0, options?.limit ?? 50)
              .map((entry) => ({ ...entry, answer: entry.answer.slice(0, LIST_ANSWER_LIMIT) }))
          )
        ),
      get: (signature) => Ref.get(store).pipe(Effect.map((current) => current.get(signature))),
      size: Ref.get(store).pipe(Effect.map((current) => current.size))
    })
  })
)
