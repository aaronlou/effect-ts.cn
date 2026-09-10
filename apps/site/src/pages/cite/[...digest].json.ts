/**
 * 引用记录端点（构建期静态产物）：`GET /cite/<digest>.json`
 *
 * 存在的理由：让"引用"从**修辞**变成**可核验的证据**。
 * 消费方（Agent / 人 / 其他工具）拿到一条引用后，应当能只凭这个地址完成三件事：
 *
 * 1. 核验引用是不是原文的子串 —— `record.chunkText.includes(quote)`；
 * 2. 判断漂移 —— `record.upstreamCommit` 与引用时记录的基线是否一致；
 * 3. 回到源头 —— `record.upstreamRawUrl` 是**该基线**下的官方原文，可逐字核对译文。
 *
 * 地址只由 (slug, anchor) 决定（见 packages/content/src/citation.ts），
 * 因此**译文更新不会让旧引用 404**，只会让内容指纹与基线变化 —— 这正是漂移信号。
 */
import type { APIRoute, GetStaticPaths } from "astro"
import { buildCitationRecords, corpus } from "@ecn/knowledge"

const records = buildCitationRecords(corpus)
const byDigest = new Map(records.map((record) => [record.digest, record]))

export const getStaticPaths = (() =>
  records.map((record) => ({ params: { digest: record.digest } }))) satisfies GetStaticPaths

export const GET: APIRoute = ({ params }) => {
  const digest = params["digest"] ?? ""
  const record = byDigest.get(digest)
  if (record === undefined) {
    return new Response(JSON.stringify({ error: "unknown-citation", digest }, null, 2), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" }
    })
  }
  return new Response(`${JSON.stringify(record, null, 2)}\n`, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // 引用记录是内容寻址的：同一地址的内容只会在译文更新时变化
      "cache-control": "public, max-age=300"
    }
  })
}
