// 提供了 Layer，但里面没有这个 effect 真正需要的服务
import { Context, Effect, Layer } from "effect"
class A extends Context.Tag("A")<A, { a: string }>() {}
class B extends Context.Tag("B")<B, { b: string }>() {}
export const runApp = <T, E>(effect: Effect.Effect<T, E, any>): Promise<T> =>
  Effect.runPromise(effect as Effect.Effect<T, E, never>)
const handler = Effect.gen(function* () { const b = yield* B; return b.b })
runApp(Effect.provide(handler, Layer.succeed(A, { a: "x" }))).catch((e) => { console.error(String(e)); process.exit(1) })
