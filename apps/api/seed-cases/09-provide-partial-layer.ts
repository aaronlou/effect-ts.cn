// 提供的 Layer 不满足全部依赖
import { Context, Effect, Layer } from "effect"
export class Cfg extends Context.Tag("Cfg")<Cfg, { url: string }>() {}
export class Repo extends Context.Tag("Repo")<Repo, { all: () => string[] }>() {}
const RepoLive = Layer.effect(Repo, Effect.map(Cfg, (c) => ({ all: () => [c.url] })))
export const run = Effect.runPromise(Effect.flatMap(Repo, (r) => Effect.succeed(r.all())))
export const layer = RepoLive
