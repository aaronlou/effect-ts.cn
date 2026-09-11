/**
 * 限流 key 的来源必须是**不可伪造**的调用方地址。
 *
 * 回归背景：旧实现取 `X-Forwarded-For` 的**第一个**值，而我们的 nginx 用
 * `$proxy_add_x_forwarded_for` 会把客户端自带的 XFF 追加在最前面 ——
 * 于是 `X-Forwarded-For: <随机>` 每次请求都能拿到新桶，限流完全失效
 * （实测：固定 XFF 第 6 次 429，轮换 XFF 连续 8 次全 200）。
 */
import { Option } from "effect"
import { describe, expect, it } from "vitest"
import { clientKeyFrom } from "../../src/interfaces/http/client-address"

/** remoteAddress 传 null 表示"没有对端地址"（显式 undefined 会触发默认值） */
const request = (
  headers: Record<string, string | ReadonlyArray<string> | undefined>,
  remoteAddress: string | null = "127.0.0.1"
) => ({
  headers,
  remoteAddress:
    remoteAddress === null ? Option.none<string>() : Option.some(remoteAddress)
})

describe("clientKeyFrom", () => {
  it("优先用 X-Real-IP（由我们的反代覆盖写入，客户端无法伪造）", () => {
    expect(
      clientKeyFrom(request({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" }))
    ).toBe("203.0.113.7")
  })

  it("没有 X-Real-IP 时取 XFF 的**最后一跳**，绝不取第一跳（第一跳是客户端可控的）", () => {
    expect(clientKeyFrom(request({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("10.0.0.1")
  })

  it("攻击者伪造的第一跳不会影响 key（同一真实来源 → 同一 key → 仍会被限流）", () => {
    const a = clientKeyFrom(request({ "x-forwarded-for": "6.6.6.6, 198.51.100.9" }))
    const b = clientKeyFrom(request({ "x-forwarded-for": "7.7.7.7, 198.51.100.9" }))
    expect(a).toBe(b)
  })

  it("trustProxy=false 时忽略所有代理头，只用 TCP 对端地址", () => {
    expect(
      clientKeyFrom(
        request({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" }),
        { trustProxy: false }
      )
    ).toBe("127.0.0.1")
  })

  it("没有任何头时退回 remoteAddress；连它也没有则是 unknown（稳定值，不会每次新桶）", () => {
    expect(clientKeyFrom(request({}))).toBe("127.0.0.1")
    expect(clientKeyFrom(request({}, null))).toBe("unknown")
  })

  it("空串 / 纯空格的头视为不存在", () => {
    expect(clientKeyFrom(request({ "x-real-ip": "   ", "x-forwarded-for": "" }))).toBe("127.0.0.1")
  })

  it("数组形式的头取第一个元素（Node 对重复头的表示）", () => {
    expect(clientKeyFrom(request({ "x-real-ip": ["198.51.100.3", "198.51.100.4"] }))).toBe(
      "198.51.100.3"
    )
  })
})
