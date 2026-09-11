/**
 * 多路检索融合：把"原查询"与若干"术语化改写查询"的结果并成一路。
 *
 * 为什么需要（实测动机）：BM25F-lite 是**词法**检索 —— 术语对得上就查得到，
 * 换成白话就查不到。实测「怎么让两件事同时跑？」在 234 篇全量中文语料上**拒答**，
 * 而文档里明明有《Fiber》《基础并发》。让模型把白话改写成 2–4 条"文档会用的说法"，
 * 各自检索一遍再融合，是零新基础设施就能补上的一刀。
 *
 * 为什么用 RRF（Reciprocal Rank Fusion）而不是加权求和：
 * - 不同查询的 BM25 分数**不可比**（查询长度、命中词数都不同），但名次可比；
 * - RRF 只有一个参数 k，无需调参、无训练、确定性 —— 与本站"可复现"的口径一致。
 *
 * 一个必须小心的细节：融合后的 `score` **保留各路里最强的 BM25 分**，
 * 而不是 RRF 分（~0.016）。因为 `composeAnswer` 的"够不够强"门禁（`minScore`）
 * 是按 BM25 刻度定的，换成 RRF 分会让所有命中都被判成"弱"⇒ 全站拒答。
 */
import type { SearchHit } from "./bm25.js"

/** RRF 的平滑常数：60 是原论文的默认值，越小越偏向各路头部 */
export const RRF_K = 60

/**
 * 切片身份：`CorpusChunk.id`（形如 `<slug>#<页面内序号>`），构建期写入、稳定唯一。
 *
 * 注意**不能**用 citeDigest 当身份：它由 `(slug, anchor)` 决定，同一小节被切成的多片共享同一个
 * digest，用它去重会把同小节的不同片段误并成一条。
 */
export function chunkKeyOf(hit: SearchHit): string {
  return hit.chunk.id
}

export interface FuseOptions {
  readonly k?: number
}

/**
 * 融合多路检索结果。
 *
 * - 排序：RRF 分降序 → 最强 BM25 分降序 → 首次出现顺序（保证**完全确定性**）；
 * - `score`：该切片在各路里出现过的最大 BM25 分（见文件头说明）；
 * - 只做去重与排序，**不丢弃**任何一路的命中（丢弃会制造"模型说没有、其实有"的假拒答）。
 */
export function fuseHits(
  lists: ReadonlyArray<ReadonlyArray<SearchHit>>,
  options: FuseOptions = {}
): ReadonlyArray<SearchHit> {
  const k = options.k ?? RRF_K
  const fused = new Map<
    string,
    { hit: SearchHit; rrf: number; best: number; firstSeen: number }
  >()
  let seen = 0

  for (const list of lists) {
    list.forEach((hit, rank) => {
      const key = chunkKeyOf(hit)
      const contribution = 1 / (k + rank + 1)
      const existing = fused.get(key)
      if (existing === undefined) {
        fused.set(key, { hit, rrf: contribution, best: hit.score, firstSeen: seen })
        seen += 1
        return
      }
      existing.rrf += contribution
      if (hit.score > existing.best) existing.best = hit.score
    })
  }

  return [...fused.values()]
    .sort((left, right) => right.rrf - left.rrf || right.best - left.best || left.firstSeen - right.firstSeen)
    .map((entry) => ({ ...entry.hit, score: entry.best }))
}

/**
 * 按给定顺序重排**前 window 个**候选，其余保持原样追加。
 *
 * 用途：模型重排。刻意只允许"换顺序"，不允许增删 ——
 * 引用集合因此仍完全由检索决定，模型拿不到"凭空塞一条引用"的能力。
 */
export function applyOrder(
  hits: ReadonlyArray<SearchHit>,
  order: ReadonlyArray<number>,
  window: number
): ReadonlyArray<SearchHit> {
  const head = hits.slice(0, window)
  const rest = hits.slice(window)
  const picked = order
    .filter((index) => Number.isInteger(index) && index >= 0 && index < head.length)
    .filter((index, position, list) => list.indexOf(index) === position)
    .map((index) => head[index])
    .filter((hit): hit is SearchHit => hit !== undefined)
  const missing = head.filter((hit) => !picked.includes(hit))
  return [...picked, ...missing, ...rest]
}
