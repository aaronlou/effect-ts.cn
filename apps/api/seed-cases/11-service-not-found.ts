// 运行期找不到服务。
//
// 真实来源：库导出的"运行入口"为了给使用方一个简单签名，内部把 R 通道抹掉了。
// 使用方于是"类型上没问题"，直到运行时才发现少给了一个服务 ——
// 这正是「间接撞上 Effect」最典型的一幕：报错里有 Service not found，但代码里没有 Layer 字样。
import { Context, Effect, Layer } from "effect"

class Db extends Context.Tag("Db")<Db, { find: () => string }>() {}
class Cache extends Context.Tag("Cache")<Cache, { get: () => string }>() {}

/** 库导出：内部 as 掉了 R，因此使用方看不出自己还缺什么 */
export const runApp = <A, E>(effect: Effect.Effect<A, E, any>): Promise<A> =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>)

const handler = Effect.gen(function* () {
  const db = yield* Db
  const cache = yield* Cache
  return cache.get() + db.find()
})

// 使用方只提供了 Db，忘了 Cache
const app = Effect.provide(handler, Layer.succeed(Db, { find: () => "x" }))
runApp(app).catch((e) => { console.error(String(e)); process.exit(1) })
