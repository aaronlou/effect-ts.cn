// 声明的成功类型与实际不符
import { Effect } from "effect"
const program = Effect.gen(function* () { return yield* Effect.succeed("done") })
export const wrong: Effect.Effect<number, never, never> = program
