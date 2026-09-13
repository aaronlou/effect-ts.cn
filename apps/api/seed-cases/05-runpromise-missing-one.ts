// runPromise 时缺一个依赖
import { Context, Effect } from "effect"
export class Clock extends Context.Tag("Clock")<Clock, { now: () => number }>() {}
const program = Effect.gen(function* () { const c = yield* Clock; return c.now() })
export const run = Effect.runPromise(program)
