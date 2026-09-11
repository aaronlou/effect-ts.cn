/**
 * interfaces/http · 调用方地址解析（限流的 key 来源）
 *
 * ⚠️ 安全前提：只有当 API **只能**通过我们自己的反向代理访问时，代理头才可信。
 * 生产编排满足这一点：api 服务不发布任何宿主端口，只有 web(nginx) 绑在回环上
 * （见 infra/docker-compose.prod.yml），而 nginx 用
 * `proxy_set_header X-Real-IP $remote_addr` **覆盖**（不是追加）客户端自带的同名头，
 * 所以 X-Real-IP 是可信的。
 *
 * 为什么不取 `X-Forwarded-For` 的**第一个**值（旧实现）：
 * nginx 用的是 `$proxy_add_x_forwarded_for`，它把客户端自带的 XFF 原样保留并
 * **追加在最前面**，于是 `X-Forwarded-For: <随机值>` 每次请求都会拿到一个新桶，
 * 限流形同虚设（实测：固定 XFF 第 6 次就 429，轮换 XFF 连续 8 次全部 200）。
 * 由可信代理追加的**最后一个**值才是真实客户端地址。
 *
 * `TRUST_PROXY_HEADERS=false` 时完全忽略代理头，只用 TCP 对端地址 ——
 * 适用于把 API 直接暴露到公网（没有反代）的部署方式。
 */
import { Option } from "effect"

export interface ClientAddressSource {
  readonly headers: Record<string, string | ReadonlyArray<string> | undefined>
  readonly remoteAddress: Option.Option<string>
}

export interface ClientAddressOptions {
  readonly trustProxy: boolean
}

const headerValue = (
  headers: Record<string, string | ReadonlyArray<string> | undefined>,
  name: string
): string | undefined => {
  const raw = headers[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

/** 解析用于限流的调用方 key（null 之外的稳定字符串） */
export const clientKeyFrom = (
  request: ClientAddressSource,
  options: ClientAddressOptions = { trustProxy: true }
): string => {
  if (options.trustProxy) {
    // 我们的反代覆盖写入的头，优先级最高
    const realIp = headerValue(request.headers, "x-real-ip")
    if (realIp !== undefined) return realIp

    // 退路：取可信代理追加的最后一跳，绝不取第一跳（那是客户端可控的）
    const forwarded = headerValue(request.headers, "x-forwarded-for")
    if (forwarded !== undefined) {
      const hops = forwarded
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
      const last = hops[hops.length - 1]
      if (last !== undefined) return last
    }
  }
  return Option.getOrElse(request.remoteAddress, () => "unknown")
}
