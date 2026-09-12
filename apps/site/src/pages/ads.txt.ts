/**
 * ads.txt（AdSense 要求放在站点根目录，用于声明"谁有权卖本站的广告位"）。
 *
 * 为什么用**生成**而不是静态文件：`ads.txt` 里写错发布商 ID 比没有这个文件更糟
 * （买方会据此拒绝出价）。所以只在真正配置了 AdSense 时才写入内容。
 *
 * 未配置时这里返回**空 body**：Astro 是静态产出，会把响应体落成文件，
 * 所以线上表现为 `200 + 0 字节`（而不是 404）。空 `ads.txt` 在语义上等价于
 * "未声明任何授权卖方"，是合法且诚实的信号 —— 关键是**绝不放占位 ID**。
 */
import type { APIRoute } from "astro"
import { MONETIZATION } from "../data/monetization"

export const GET: APIRoute = () => {
  const client = MONETIZATION.ads.client.trim()
  if (!MONETIZATION.ads.enabled || client === "") {
    // 空文件即可：静态产出会丢掉状态码，别指望这里能表达 404
    return new Response("", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } })
  }
  // `ca-pub-XXXX` → `pub-XXXX`；f08c47fec0942fa0 是 Google 的认证机构 ID（官方固定值）
  const publisher = client.replace(/^ca-/, "")
  const body = `google.com, ${publisher}, DIRECT, f08c47fec0942fa0\n`
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" }
  })
}
