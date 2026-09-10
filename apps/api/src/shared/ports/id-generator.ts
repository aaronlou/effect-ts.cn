/**
 * 端口（Port）：ID 生成器。
 * domain/application 层不依赖 node:crypto，只依赖此端口；
 * 生产用 NodeCrypto 实现（infrastructure），测试注入确定性实现。
 */
import { Context, Effect } from "effect"

export interface IdGenerator {
  readonly uuid: () => Effect.Effect<string>
}

export const IdGenerator = Context.GenericTag<IdGenerator>("shared/IdGenerator")
