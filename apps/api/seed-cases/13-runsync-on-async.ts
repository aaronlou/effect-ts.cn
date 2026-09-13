// 对异步 Effect 用了 runSync
import { Effect } from "effect"
Effect.runSync(Effect.promise(() => Promise.resolve(1)))
