import { Effect } from "effect"
export const program = Effect.gen(function* () {
  const value = Effect.succeed(1)
  return value + 1
})
