import { Effect, Stream } from "effect"
const stream = Stream.make(1, 2, 3)
export const program = Effect.gen(function* () { const value = yield* stream; return value })
