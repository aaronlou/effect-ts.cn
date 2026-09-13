// Effect 超时
import { Duration, Effect } from "effect"
Effect.runPromise(Effect.timeout(Effect.never, Duration.millis(50))).catch((e) => { console.error(String(e)); process.exit(1) })
