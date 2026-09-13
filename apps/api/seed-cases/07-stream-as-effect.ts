// 把 Stream 当 Effect 用
import { Effect, Stream } from "effect"
export const program = Effect.gen(function* () { return yield* Stream.make(1, 2, 3) })
