// 把 Effect 当普通值做运算（忘了它是惰性描述）
import { Effect } from "effect"
const program: Effect.Effect<number> = Effect.succeed(42)
export const doubled = program * 2
