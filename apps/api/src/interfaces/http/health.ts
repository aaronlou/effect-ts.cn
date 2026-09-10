/**
 * interfaces/http · health 组实现
 * 前端首页的“后端由 Effect 驱动”状态即来自这里（见 site 的 ApiHealth island）。
 */
import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import type { HealthInfo } from "@ecn/contracts"
import { AppConfig } from "../../bootstrap/config"
import { Api } from "./api"

export const SystemGroupLive = HttpApiBuilder.group(Api, "system", (handlers) =>
  handlers.handle("health", () =>
    Effect.gen(function* () {
      const config = yield* AppConfig
      const info: HealthInfo = {
        status: "ok",
        service: "ecn-api",
        version: config.version,
        timestamp: new Date()
      }
      return info
    })
  )
)
