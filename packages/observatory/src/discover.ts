/**
 * 候选发现：把查询集跑成一份**有界且可追溯**的候选池。
 *
 * 这一步产出的是计划里的 Q1/Q2/Q3（有多少 Agent 项目 / 语言分布 / TS 有多少），
 * 而它们的正确性完全取决于三件事，代码里逐条对应：
 *   1. **有界宇宙要写进产物**（`frame`）：报告必须能说清"分母是什么"，
 *      否则"Effect Agent 占比"这种比率毫无意义；
 *   2. **超过 1000 上限要显式记录**（`truncatedSlices`）：宁可说"这一段被截断了"，
 *      也不要让人以为它是全集；
 *   3. **每条候选都记 `via`**：任何数字都能回溯到具体 query。
 *
 * 取数流程（每一步都为了省配额）：
 *   1. 取第一页 —— 它同时给出 `total_count` 与最多 100 条结果，对绝大多数 query 一次调用就够；
 *   2. `total > 1000`（GitHub 硬上限）⇒ **抬高星数下限**，用几何台阶探测到能枚举为止，
 *      并把**该查询的实际生效下限**记进产物。
 *
 * 为什么不是"切星段后逐段取全"：实测这条思路会退化 —— 泛词（如裸词 `agent`）
 * 在每个窄段里都仍超 1000，二分到 `stars:393..425` 这种荒谬区间还是超上限，
 * 于是一次查询要发几百次调用、最后还是截断。抬高下限是**便宜、可解释、可复现**的那条路：
 * 代价是泛词只覆盖高星部分，而这个代价被逐条记录在 `effectiveMinStars` 里。
 *
 * 绝不"取前 1000 条"当成全集 —— 那是带排序偏置的样本，会污染分母。
 */
import { GitHubClient } from "./github.js"
import { dedupe, starBands, type Candidate, type DedupeResult, type SearchCall } from "./candidate.js"
import { buildQueries, buildSearchQuery, LANGUAGES, type Language, type QueryOptions, type QuerySpec } from "./queries.js"

/** 单条 query 最多取回的条数：GitHub 硬上限 1000（10 页 × 100） */
const SEARCH_RESULT_CAP = 1000
const PER_PAGE = 100
/** 抬高星数下限时最多试探几次（每次只是一次 1 条的轻量查询） */
const MAX_FLOOR_PROBES = 8

export interface DiscoveryFrame {
  readonly snapshotDate: string
  readonly minStars: number
  readonly pushedSince: string
  readonly languages: ReadonlyArray<string>
  readonly keywordCount: number
  readonly queryCount: number
  /** 有界宇宙的**一句话声明**：会原文出现在报告与文章里 */
  readonly statement: string
}

export interface DiscoveryResult {
  readonly frame: DiscoveryFrame
  readonly candidates: ReadonlyArray<Candidate>
  readonly dedupe: DedupeResult
  readonly calls: ReadonlyArray<SearchCall>
  readonly truncatedSlices: ReadonlyArray<string>
  /** 被抬高过星数下限的查询（泛词）：报告必须点名，否则读者会以为它们覆盖了全部星段 */
  readonly raisedFloors: ReadonlyArray<{ readonly query: string; readonly effectiveMinStars: number; readonly total: number }>
  readonly api: { readonly cacheHits: number; readonly networkCalls: number; readonly waits: number }
}

interface RawRepo {
  readonly full_name: string
  readonly name: string
  readonly owner: { readonly login: string }
  readonly stargazers_count: number
  readonly forks_count: number
  readonly language: string | null
  readonly description: string | null
  readonly topics?: ReadonlyArray<string>
  readonly pushed_at: string
  readonly created_at: string
  readonly archived: boolean
  readonly fork: boolean
  readonly license: { readonly spdx_id?: string | null } | null
  readonly open_issues_count: number
}

interface SearchResponse {
  readonly total_count: number
  readonly incomplete_results?: boolean
  readonly items?: ReadonlyArray<RawRepo>
}

const toCandidate = (repo: RawRepo, via: string): Candidate => ({
  repo: repo.full_name,
  owner: repo.owner.login,
  name: repo.name,
  stars: repo.stargazers_count,
  forks: repo.forks_count,
  githubLanguage: repo.language,
  description: repo.description,
  topics: repo.topics ?? [],
  pushedAt: repo.pushed_at,
  createdAt: repo.created_at,
  archived: repo.archived,
  fork: repo.fork,
  license: repo.license?.spdx_id ?? null,
  openIssues: repo.open_issues_count,
  via: [via]
})

export interface DiscoverOptions extends QueryOptions {
  readonly snapshotDate: string
  readonly languages?: ReadonlyArray<Language>
  /** 只跑前 N 条查询（试跑用；会如实记录在 frame 里） */
  readonly maxQueries?: number
  readonly client: GitHubClient
}

interface SliceResult {
  readonly candidates: ReadonlyArray<Candidate>
  readonly calls: ReadonlyArray<SearchCall>
  readonly raised: ReadonlyArray<{ readonly query: string; readonly effectiveMinStars: number; readonly total: number }>
}

/**
 * 取一条查询的全量结果（必要时切星段）。
 *
 * `via` 里带上星段标签，这样"某个仓库是怎么被发现的"可以一路回溯到具体切片。
 */
async function searchSlice(spec: QuerySpec, options: DiscoverOptions): Promise<SliceResult> {
  const candidates: Array<Candidate> = []
  const calls: Array<SearchCall> = []
  const raised: Array<{ query: string; effectiveMinStars: number; total: number }> = []

  /** 只取需要的字段再落缓存：仓库对象很大，100 条一页约 500KB（见 github.ts 的 trim 说明） */
  const trim = (body: unknown): unknown => {
    const response = body as SearchResponse
    return {
      total_count: response.total_count,
      items: (response.items ?? []).map((item) => ({
        full_name: item.full_name,
        name: item.name,
        owner: { login: item.owner?.login },
        stargazers_count: item.stargazers_count,
        forks_count: item.forks_count,
        language: item.language,
        description: item.description,
        topics: item.topics ?? [],
        pushed_at: item.pushed_at,
        created_at: item.created_at,
        archived: item.archived,
        fork: item.fork,
        license: item.license === null || item.license === undefined ? null : { spdx_id: item.license.spdx_id ?? null },
        open_issues_count: item.open_issues_count
      }))
    }
  }

  const searchPath = (query: string, page: number): string =>
    `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${PER_PAGE}&page=${page}`

  const countPath = (query: string): string =>
    `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=1`

  const viaTag = (minStars: number): string =>
    minStars === options.minStars
      ? `${spec.language}:${spec.keyword}`
      : `${spec.language}:${spec.keyword}:stars>=${minStars}`

  /** 探一次总数（轻量：per_page=1） */
  const probe = async (minStars: number): Promise<number> => {
    const query = buildSearchQuery(spec, { ...options, minStars })
    const response = await options.client.api<SearchResponse>(countPath(query), { trim })
    return response.body.total_count
  }

  /**
   * 抬高星数下限，直到这条查询可以被完整枚举。
   *
   * 台阶用 `starBands` 给的几何边界（600 → 900 → 1200 → …）：
   * 星数分布是重尾的，几何台阶通常 1–3 次探测就能落到 1000 以内。
   */
  const findFloor = async (): Promise<{ minStars: number; total: number } | undefined> => {
    // 跳过第一段（它的下限就是 minStars，而我们已经知道它超过上限）
    const floors = starBands(options.minStars).slice(1, 1 + MAX_FLOOR_PROBES)
    for (const band of floors) {
      const total = await probe(band.low)
      if (total <= SEARCH_RESULT_CAP) return { minStars: band.low, total }
    }
    return undefined
  }

  // 第一页：同时拿到 total_count 与最多 100 条
  const baseQuery = buildSearchQuery(spec, options)
  let minStars = options.minStars
  let firstPage = await options.client.api<SearchResponse>(searchPath(baseQuery, 1), { trim })
  let total = firstPage.body.total_count

  if (total > SEARCH_RESULT_CAP) {
    const floor = await findFloor()
    if (floor === undefined) {
      // 抬到顶还是超上限：如实记为截断（报告里把这一段标成"头部样本"）
      calls.push({
        query: baseQuery,
        language: spec.language,
        keyword: spec.keyword,
        effectiveMinStars: options.minStars,
        totalCount: total,
        taken: 0,
        truncated: true,
        fromCache: firstPage.fromCache
      })
      return { candidates, calls, raised }
    }
    minStars = floor.minStars
    raised.push({ query: buildSearchQuery(spec, { ...options, minStars }), effectiveMinStars: minStars, total: floor.total })
    firstPage = await options.client.api<SearchResponse>(searchPath(buildSearchQuery(spec, { ...options, minStars }), 1), { trim })
    total = firstPage.body.total_count
  }

  const query = buildSearchQuery(spec, { ...options, minStars })
  let taken = 0
  let fromCache = firstPage.fromCache
  let items = firstPage.body.items ?? []
  for (let page = 1; page <= SEARCH_RESULT_CAP / PER_PAGE; page += 1) {
    if (page > 1) {
      const response = await options.client.api<SearchResponse>(searchPath(query, page), { trim })
      items = response.body.items ?? []
    }
    for (const item of items) candidates.push(toCandidate(item, viaTag(minStars)))
    taken += items.length
    if (taken >= total || items.length < PER_PAGE || taken >= SEARCH_RESULT_CAP) break
  }

  calls.push({
    query,
    language: spec.language,
    keyword: spec.keyword,
    effectiveMinStars: minStars,
    totalCount: total,
    taken,
    truncated: false,
    fromCache
  })
  return { candidates, calls, raised }
}

export async function discover(options: DiscoverOptions): Promise<DiscoveryResult> {
  const languages = options.languages ?? LANGUAGES
  const allQueries = buildQueries(languages)
  const queries = options.maxQueries !== undefined ? allQueries.slice(0, options.maxQueries) : allQueries

  const candidates: Array<Candidate> = []
  const calls: Array<SearchCall> = []
  const raisedFloors: Array<{ query: string; effectiveMinStars: number; total: number }> = []

  for (const spec of queries) {
    const result = await searchSlice(spec, options)
    candidates.push(...result.candidates)
    calls.push(...result.calls)
    raisedFloors.push(...result.raised)
  }

  const dedupeResult = dedupe(candidates)
  const truncatedSlices = calls.filter((call) => call.truncated).map((call) => call.query)
  const keywordCount = new Set(queries.map((spec) => spec.keyword)).size

  return {
    frame: {
      snapshotDate: options.snapshotDate,
      minStars: options.minStars,
      pushedSince: options.pushedSince,
      languages: [...languages],
      keywordCount,
      queryCount: queries.length,
      statement:
        `GitHub 上 stars ≥ ${options.minStars} 且 ${options.pushedSince} 之后有 push 的公开仓库，` +
        `按 ${languages.length} 种语言 × ${keywordCount} 个 Agent 方向词` +
        `（命中 name/description/topics）检索、经去重后的候选池。` +
        `**这是有界宇宙，不是 GitHub 上全部 Agent 项目。**`
    },
    candidates: dedupeResult.kept,
    dedupe: dedupeResult,
    calls,
    truncatedSlices,
    raisedFloors,
    api: options.client.stats
  }
}

export { starBands }
