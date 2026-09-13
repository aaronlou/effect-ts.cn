import { Context, Effect, Layer } from "effect"
export class Database extends Context.Tag("Database")<Database, { readonly query: () => string }>() {}
export const needsDb = Effect.gen(function* () {
  const db = yield* Database
  return db.query()
})
export const run = Effect.runPromise(needsDb)
export const AppLayer = Layer.succeed(Database, { query: () => "ok" })
