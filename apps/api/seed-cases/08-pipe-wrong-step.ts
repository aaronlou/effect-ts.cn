// pipe 中间某步类型不对
import { Effect, pipe } from "effect"
export const program = pipe(Effect.succeed("42"), Effect.map((s) => s + 1), Effect.flatMap((n) => Effect.succeed(n.toFixed(2))))
