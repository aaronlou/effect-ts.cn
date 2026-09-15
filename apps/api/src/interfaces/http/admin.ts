/**
 * interfaces/http · admin 组（**站主专用**）
 *
 *   GET /api/admin/traffic?hours=24   访问报表
 *
 * ── 访问控制 ────────────────────────────────────────────────────────────
 * `Authorization: Bearer <ADMIN_TOKEN>`。三条刻意的选择：
 *
 * 1. **未配置 ADMIN_TOKEN 时接口直接 401，而不是"没配就不校验"**。
 *    默认关闭 > 默认开放 —— 一个"忘了配就等于公开"的管理接口是最典型的翻车方式。
 * 2. **定长比较**（`timingSafeEqual`）。用 `===` 比较口令会在第一个不同字符处提前返回，
 *    理论上可逐字节爆破；这类接口值得多写三行。
 * 3. **失败信息不区分"没带 token"与"token 不对"**，都回同一句话。
 *
 * 报表本身不含原始 IP（只有哈希前缀），所以即使泄露也不会暴露访客身份。
 */
import { HttpApiBuilder, HttpServerRequest } from "@effect/platform"
import { Effect } from "effect"
import { timingSafeEqual } from "node:crypto"
import { InternalServerError, UnauthorizedError, type TrafficReportDto } from "@ecn/contracts"
import { Api } from "./api"
import { AppConfig } from "../../bootstrap/config"
import { TrafficReporter } from "../../contexts/traffic/application/use-cases/build-traffic-report"

const DEFAULT_HOURS = 24
const MAX_HOURS = 24 * 30

/** 定长比较；长度不同时直接 false，不泄露到哪一位为止是一致的 */
export const tokenMatches = (provided: string, expected: string): boolean => {
  const a = Buffer.from(provided, "utf8")
  const b = Buffer.from(expected, "utf8")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const AdminGroupLive = HttpApiBuilder.group(Api, "admin", (handlers) =>
  Effect.gen(function* () {
    const config = yield* AppConfig
    const reporter = yield* TrafficReporter

    const denied = Effect.fail(
      new UnauthorizedError({ message: "需要管理员口令（Authorization: Bearer <token>）" })
    )

    return handlers.handle("traffic", ({ urlParams }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (config.adminToken === "") return yield* denied

        const header = request.headers["authorization"] ?? ""
        const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : ""
        if (!tokenMatches(provided, config.adminToken)) return yield* denied

        const requested = urlParams.hours ?? DEFAULT_HOURS
        const hours = Math.min(Math.max(Math.trunc(requested), 1), MAX_HOURS)

        // domain 错误不直接外泄：在这里映射成 wire 层的错误（anti-corruption）。
        // 「日志读不到」在报表上是**必须让人看见**的：它和"这段时间没人来"是完全相反的结论，
        // 所以回 500 并带上原因，而不是悄悄返回一份空报表。
        const report = yield* reporter.get(hours).pipe(
          Effect.catchTag("TrafficLogUnavailable", (error) =>
            Effect.fail(new InternalServerError({ message: error.message }))
          )
        )
        // domain 的 TrafficReport 与契约结构一致，直接作为 DTO 返回（由 Schema 负责序列化）
        return report satisfies TrafficReportDto
      })
    )
  })
)
