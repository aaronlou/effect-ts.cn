// runPromise 时缺多个依赖
import { Context, Effect } from "effect"
export class Config extends Context.Tag("Config")<Config, { url: string }>() {}
export class Logger extends Context.Tag("Logger")<Logger, { log: (m: string) => void }>() {}
export class Db extends Context.Tag("Db")<Db, { find: () => Effect.Effect<string> }>() {}
const handler = Effect.gen(function* () {
  const db = yield* Db; const l = yield* Logger; const g = yield* Config
  l.log(g.url); return yield* db.find()
})
export const run = Effect.runPromise(handler)
