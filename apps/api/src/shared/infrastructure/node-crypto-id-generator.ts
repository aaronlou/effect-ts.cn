import { randomUUID } from "node:crypto"
import { Effect, Layer } from "effect"
import { IdGenerator } from "../ports/id-generator"

/** infrastructure 适配：基于 node:crypto 的真实 UUID 生成 */
export const NodeCryptoIdGenerator = Layer.succeed(IdGenerator, {
  uuid: () => Effect.sync(() => randomUUID())
})
