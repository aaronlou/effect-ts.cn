// 未处理的失败，冒泡成 FiberFailure
import { Effect } from "effect"
Effect.runPromise(Effect.fail(new Error("upstream returned 500"))).catch((e) => { console.error(String(e)); process.exit(1) })
