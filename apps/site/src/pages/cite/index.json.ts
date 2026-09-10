/**
 * 引用索引（构建期静态产物）：`GET /cite/index.json`
 *
 * 用途：让 Agent 能**发现**本站所有可引用的证据，而不必先提问。
 * 只列轻量元信息；正文与指纹在各自的 `/cite/<digest>.json` 里。
 */
import type { APIRoute } from "astro"
import { CITE_SCHEMA_VERSION, buildCitationRecords, corpus } from "@ecn/knowledge"

const records = buildCitationRecords(corpus)

export const GET: APIRoute = ({ site }) => {
  const base = (site ?? new URL("https://effect-ts.cn/")).href.replace(/\/$/, "")
  const body = {
    schemaVersion: CITE_SCHEMA_VERSION,
    base,
    generatedAt: corpus.generatedAt,
    /** 语料上游基线（站点侧的语料快照） */
    corpusUpstreamHead: corpus.stats.upstreamHead,
    count: records.length,
    staleCount: records.filter((record) => record.stale).length,
    usage: {
      verifyQuote: "record.chunkText.includes(quote)",
      detectDrift: "record.upstreamCommit !== 引用时的基线 ⇒ 译文已更新，结论可能过时",
      retrieveSource: "record.upstreamRawUrl 是该基线下的官方原文"
    },
    citations: records.map((record) => ({
      citationId: record.citationId,
      digest: record.digest,
      citeUrl: record.citeUrl,
      slug: record.slug,
      anchor: record.anchor,
      title: record.title,
      deepLink: record.deepLink,
      stale: record.stale
    }))
  }
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: { "content-type": "application/json; charset=utf-8" }
  })
}
