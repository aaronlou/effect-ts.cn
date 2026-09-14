/**
 * 观测台的**纯类型与纯判据**（无网络、无文件系统）。
 *
 * 为什么严格分家：候选池的每一条都会被写进论文式报告里当"事实"用。
 * 网络必须可替换、判据必须能被测试钉死 —— 这与生态榜采集器同一套取舍
 * （`packages/content/src/ecosystem.ts` 与 `ecosystem-collect.ts` 的分工）。
 */

/** 一次搜索命中的仓库（字段全部来自 GitHub 响应，不做推断） */
export interface Candidate {
  /** `owner/name`（GitHub 的 full_name） */
  readonly repo: string
  readonly owner: string
  readonly name: string
  readonly stars: number
  readonly forks: number
  /**
   * GitHub 的 `language` 字段。
   *
   * **已知不可信**：它按字节占比算，TS 项目常被判成 JS/JSON/Markdown。
   * 因此它只作为"参考口径"记录，另有一个由 manifest + 源码占比自判的口径。
   */
  readonly githubLanguage: string | null
  readonly description: string | null
  readonly topics: ReadonlyArray<string>
  readonly pushedAt: string
  readonly createdAt: string
  readonly archived: boolean
  readonly fork: boolean
  readonly license: string | null
  readonly openIssues: number
  /** 命中它的查询（可追溯：结论能一路回溯到具体 query） */
  readonly via: ReadonlyArray<string>
}

/** 一次搜索的账（可复现性要求：查询集、时间戳、结果数都要留痕） */
export interface SearchCall {
  readonly query: string
  readonly language: string
  readonly keyword: string
  /**
   * 本次查询**实际生效**的星数下限。
   *
   * 泛词（如裸词 `agent`）在 stars≥300 时超过 GitHub 的 1000 条上限，
   * 会被自动抬高到能枚举为止 —— 不记录这个数，读者会以为它覆盖了全部星段。
   */
  readonly effectiveMinStars: number
  readonly totalCount: number
  /** 本次实际取回并计入候选的条数 */
  readonly taken: number
  /** 命中数超过 1000 上限、且已经切到不能再切 ⇒ 这一段是**有意截断**的 */
  readonly truncated: boolean
  readonly fromCache: boolean
}

/** 去重的产物：留下的、被排除的、以及**需要人看的** */
export interface DedupeResult {
  readonly kept: ReadonlyArray<Candidate>
  /** 同一 `owner/name` 在多个 query 里重复出现 ⇒ 合并 via（不是丢弃） */
  readonly merged: number
  readonly droppedForks: ReadonlyArray<string>
  readonly droppedArchived: ReadonlyArray<string>
  /**
   * 归一化名字相同但 owner 不同的仓库组。
   *
   * **只标记、不自动丢**：`agent` 与 `agent-js` 可能是同一项目的两个组织，
   * 也可能是两个无关项目。机器标记、人决定 —— 与生态榜"机器出事实、人写判断"一致。
   * 误丢一条真实项目比多留一条更贵。
   */
  readonly possibleDuplicates: ReadonlyArray<ReadonlyArray<string>>
}

/**
 * 名字归一化：用于"疑似同一个项目"的标记。
 *
 * 规则刻意保守（只做小写化、去分隔符、去掉 `js`/`ts` 形态后缀），
 * 且**不允许把整个名字吃光** —— 初版把 `agent` 自己归成了空串，
 * 于是两个都叫 `agent` 的仓库反而不进"疑似重复"名单（测试逮到的）。
 */
export function normalizeRepoName(name: string): string {
  const base = name.toLowerCase().replace(/[._-]/g, "")
  const stripped = base.replace(/(js|ts)$/g, "")
  return stripped.length >= 2 ? stripped : base
}

/**
 * 去重。
 *
 * 规则与理由（对齐计划 §14，但把"默认丢弃"改成了"标记 + 保留"）：
 * - `fork` ⇒ 丢（GitHub 上 fork 的 star 数会误导规模统计）；
 * - `archived` ⇒ 丢出主集，但**单独留名单和 star 数**（计划说"除非有历史重要性"，那就让人能看见）；
 * - 同名不同 owner ⇒ 只标记。
 */
export function dedupe(candidates: ReadonlyArray<Candidate>): DedupeResult {
  const byRepo = new Map<string, Candidate>()
  let merged = 0

  for (const candidate of candidates) {
    const existing = byRepo.get(candidate.repo)
    if (existing === undefined) {
      byRepo.set(candidate.repo, candidate)
      continue
    }
    merged += 1
    // 同一仓库被多个 query 命中：合并 via，star 取较大值（并发快照下可能略有差异）
    byRepo.set(candidate.repo, {
      ...existing,
      stars: Math.max(existing.stars, candidate.stars),
      via: [...new Set([...existing.via, ...candidate.via])].sort()
    })
  }

  const droppedForks: Array<string> = []
  const droppedArchived: Array<string> = []
  const kept: Array<Candidate> = []

  for (const candidate of byRepo.values()) {
    if (candidate.fork) {
      droppedForks.push(candidate.repo)
      continue
    }
    if (candidate.archived) {
      droppedArchived.push(candidate.repo)
      continue
    }
    kept.push(candidate)
  }

  const groups = new Map<string, Array<string>>()
  for (const candidate of kept) {
    const key = normalizeRepoName(candidate.name)
    if (key === "") continue
    const list = groups.get(key) ?? []
    list.push(candidate.repo)
    groups.set(key, list)
  }
  const possibleDuplicates = [...groups.values()]
    .filter((list) => list.length > 1)
    .map((list) => [...list].sort())
    .sort((a, b) => a[0]!.localeCompare(b[0]!))

  return {
    kept: kept.sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo)),
    merged,
    droppedForks: droppedForks.sort(),
    droppedArchived: droppedArchived.sort(),
    possibleDuplicates
  }
}

/** 一个星段（`high` 缺省 = 无上界的顶段） */
export interface StarBand {
  readonly low: number
  /** 上界（不含）；缺省表示"及以上" */
  readonly high?: number
}

export const formatBand = (band: StarBand): string =>
  band.high === undefined ? `stars:>=${band.low}` : `stars:>=${band.low} stars:<${band.high}`

/**
 * 星段切片。
 *
 * 为什么必须有：GitHub 搜索**每条 query 最多返回 1000 条**（实测 page=11 直接 422）。
 * 今天的关键词 × 语言组合都远低于 1000（实测最大 491），但关键词表会扩、快照会逐月累积，
 * 所以闸门必须先建好 —— 而且要**显式记录被截断的切片**，让报告的"分母"是诚实的。
 *
 * 切法：低位段窄（300→600→900），高位段按 2 倍几何增长。
 * 星数分布是重尾的，等宽切片会让低位段挤爆、高位段空转。
 */
export function starBands(minStars: number, topStars = 2_000_000): ReadonlyArray<StarBand> {
  const bands: Array<StarBand> = []
  let low = minStars
  while (low < topStars) {
    const next = low < 1000 ? low + 300 : low * 2
    if (next >= topStars) {
      bands.push({ low })
      break
    }
    bands.push({ low, high: next })
    low = next
  }
  return bands
}

