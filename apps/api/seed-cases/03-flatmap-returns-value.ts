// flatMap 的回调必须返回 Effect（map 才返回普通值）
import { Effect } from "effect"
export const program = Effect.flatMap(Effect.succeed(1), (n) => n + 1)
