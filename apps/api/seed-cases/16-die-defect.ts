// Effect.die：非预期错误（defect）
import { Effect } from "effect"
Effect.runPromise(Effect.die(new Error("invariant violated: total mismatch"))).catch((e) => { console.error(String(e)); process.exit(1) })
