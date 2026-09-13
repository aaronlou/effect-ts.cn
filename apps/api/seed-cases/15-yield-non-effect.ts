// yield* 了一个不是 Effect 的东西：注册表的值类型写着 Effect，运行时却不是
import { Effect } from "effect"
const registry: Record<string, Effect.Effect<number>> = { compute: 42 as unknown as Effect.Effect<number> }
Effect.runPromise(Effect.gen(function* () { return yield* registry["compute"] })).catch((e) => { console.error(String(e)); process.exit(1) })
