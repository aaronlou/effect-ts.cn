import { Effect } from "effect"
const program: Effect.Effect<number> = Effect.succeed(42)
export const doubled: number = program * 2
