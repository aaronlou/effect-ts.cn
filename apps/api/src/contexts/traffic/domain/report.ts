/**
 * Traffic 上下文 · domain：把访问事件聚合成报表。
 *
 * 纯函数：输入事件数组 + 时间窗，输出报表。不看时钟（`now` 由调用方传入）、
 * 不读文件 —— 所以它可以被单测直接喂构造好的事件。
 *
 * 两处刻意的口径选择：
 *   · **分桶按北京时间（UTC+8）**。受众是中文开发者，按 UTC 分天会把晚上 8 点后的流量
 *     算到"昨天" —— 站主看"今天的流量"时会得到反直觉的结果。
 *   · **Visitors 只在人类里去重**。爬虫没有"独立访客"的概念，混进去会让数字随抓取波动。
 */
import type { TrafficEvent, SourceKind, VisitorKind } from "./traffic-event.js"

/** 站点的目标受众时区（北京）。分桶用，展示也用它。 */
export const SITE_TZ_OFFSET_MS = 8 * 60 * 60 * 1000

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export interface TrafficBucket {
  readonly bucket: string
  readonly human: number
  readonly machine: number
  readonly visitors: number
}

export interface TrafficPage {
  readonly path: string
  readonly views: number
  readonly visitors: number
}

export interface TrafficSource {
  readonly kind: SourceKind
  readonly host: string
  readonly visits: number
}

export interface TrafficBot {
  readonly name: string
  readonly requests: number
  readonly uniquePaths: number
  readonly lastSeen: Date
}

export interface TrafficStatus {
  readonly status: number
  readonly count: number
}

export interface TrafficVisit {
  readonly at: Date
  readonly path: string
  readonly source: SourceKind
  readonly host: string
  readonly status: number
  readonly visitor: string
}

export interface TrafficReport {
  readonly generatedAt: Date
  readonly rangeHours: number
  readonly granularity: "hour" | "day"
  readonly logFiles: number
  readonly coveredFrom: Date
  readonly coveredTo: Date
  readonly totals: {
    readonly requests: number
    readonly humanRequests: number
    readonly pageViews: number
    readonly uniqueVisitors: number
    /** 加载过静态资源的访客 —— 真正的读者（见 TrafficEvent.isAsset 的说明） */
    readonly browserVisitors: number
    readonly crawlerRequests: number
    readonly scanRequests: number
    readonly probeRequests: number
  }
  readonly series: ReadonlyArray<TrafficBucket>
  readonly topPages: ReadonlyArray<TrafficPage>
  readonly landingPages: ReadonlyArray<TrafficPage>
  readonly sources: ReadonlyArray<TrafficSource>
  readonly bots: ReadonlyArray<TrafficBot>
  readonly statuses: ReadonlyArray<TrafficStatus>
  readonly recent: ReadonlyArray<TrafficVisit>
}

export interface BuildReportOptions {
  readonly rangeHours: number
  readonly now: Date
  /** 实际读进来的日志文件数（含轮转备份） */
  readonly logFiles: number
}

const RECENT_LIMIT = 40
const TOP_PAGES_LIMIT = 20
const LANDING_LIMIT = 15
const SOURCES_LIMIT = 20
const BOTS_LIMIT = 15

interface Counter {
  views: number
  visitors: Set<string>
}

/** 桶起点：按北京时间对齐到小时或天，再换回 UTC 瞬时（前端按同一时区格式化） */
export function bucketStart(at: Date, granularity: "hour" | "day"): number {
  const size = granularity === "hour" ? HOUR_MS : DAY_MS
  const local = at.getTime() + SITE_TZ_OFFSET_MS
  return Math.floor(local / size) * size - SITE_TZ_OFFSET_MS
}

const isMachine = (kind: VisitorKind): boolean => kind !== "human"

export function buildReport(
  events: ReadonlyArray<TrafficEvent>,
  options: BuildReportOptions
): TrafficReport {
  const { rangeHours, now, logFiles } = options
  const since = now.getTime() - rangeHours * HOUR_MS
  const granularity: "hour" | "day" = rangeHours <= 72 ? "hour" : "day"

  const inRange = events.filter((event) => event.at.getTime() >= since && event.at.getTime() <= now.getTime())

  const totals = {
    requests: 0,
    humanRequests: 0,
    pageViews: 0,
    uniqueVisitors: 0,
    browserVisitors: 0,
    crawlerRequests: 0,
    scanRequests: 0,
    probeRequests: 0
  }

  const allVisitors = new Set<string>()
  const browserVisitors = new Set<string>()
  const buckets = new Map<number, { human: number; machine: number; visitors: Set<string> }>()
  const pages = new Map<string, Counter>()
  const landings = new Map<string, Counter>()
  const sources = new Map<string, { kind: SourceKind; host: string; visits: number }>()
  const bots = new Map<string, { requests: number; paths: Set<string>; lastSeen: Date }>()
  const statuses = new Map<number, number>()
  const humanVisits: TrafficVisit[] = []

  let coveredFrom: Date | undefined
  let coveredTo: Date | undefined

  for (const event of inRange) {
    totals.requests += 1
    if (coveredFrom === undefined || event.at < coveredFrom) coveredFrom = event.at
    if (coveredTo === undefined || event.at > coveredTo) coveredTo = event.at

    statuses.set(event.status, (statuses.get(event.status) ?? 0) + 1)

    if (event.kind === "crawler") totals.crawlerRequests += 1
    else if (event.kind === "scanner") totals.scanRequests += 1
    else if (event.kind === "probe") totals.probeRequests += 1

    // ── 时间序列（所有请求都进，人和机器分开） ──
    const start = bucketStart(event.at, granularity)
    const bucket = buckets.get(start) ?? { human: 0, machine: 0, visitors: new Set<string>() }
    if (isMachine(event.kind)) {
      bucket.machine += 1
    } else {
      bucket.human += 1
      bucket.visitors.add(event.visitor)
    }
    buckets.set(start, bucket)

    // ── 以下只统计人类：爬虫会让页面榜和来源榜失真 ──
    if (event.kind !== "human") {
      if (event.kind === "crawler") {
        const name = event.crawlerName ?? "其它爬虫"
        const entry = bots.get(name) ?? { requests: 0, paths: new Set<string>(), lastSeen: event.at }
        entry.requests += 1
        entry.paths.add(event.path)
        if (event.at > entry.lastSeen) entry.lastSeen = event.at
        bots.set(name, entry)
      }
      continue
    }

    totals.humanRequests += 1
    allVisitors.add(event.visitor)
    // 真浏览器会去拉 /_astro/*.css|js，扫描器只请求一条路径就走 ——
    // 这是唯一能把伪装成 Chrome 的扫描器从"读者"里摘出去的信号
    if (event.isAsset) browserVisitors.add(event.visitor)

    if (event.isPageView) {
      totals.pageViews += 1
      bumpCounter(pages, event.path, event.visitor)
      // 落地页：来源不是站内跳转 ⇒ 近似"这次访问的第一页"
      if (event.source !== "internal") bumpCounter(landings, event.path, event.visitor)
    }

    if (event.source !== "internal") {
      const key = `${event.source}\u0000${event.sourceHost}`
      const entry = sources.get(key) ?? { kind: event.source, host: event.sourceHost, visits: 0 }
      entry.visits += 1
      sources.set(key, entry)
    }

    humanVisits.push({
      at: event.at,
      path: event.path,
      source: event.source,
      host: event.sourceHost,
      status: event.status,
      visitor: event.visitor
    })
  }

  totals.uniqueVisitors = allVisitors.size
  totals.browserVisitors = browserVisitors.size

  return {
    generatedAt: now,
    rangeHours,
    granularity,
    logFiles,
    // 一条数据都没有时退回 now，避免生成 1970 这样的假日期
    coveredFrom: coveredFrom ?? now,
    coveredTo: coveredTo ?? now,
    totals,
    series: [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([start, value]) => ({
        bucket: new Date(start).toISOString(),
        human: value.human,
        machine: value.machine,
        visitors: value.visitors.size
      })),
    topPages: toRanked(pages).slice(0, TOP_PAGES_LIMIT),
    landingPages: toRanked(landings).slice(0, LANDING_LIMIT),
    sources: [...sources.values()]
      .sort((a, b) => b.visits - a.visits)
      .slice(0, SOURCES_LIMIT),
    bots: [...bots.entries()]
      .map(([name, value]) => ({
        name,
        requests: value.requests,
        uniquePaths: value.paths.size,
        lastSeen: value.lastSeen
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, BOTS_LIMIT),
    statuses: [...statuses.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    recent: humanVisits
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, RECENT_LIMIT)
  }
}

function bumpCounter(map: Map<string, Counter>, key: string, visitor: string): void {
  const entry = map.get(key) ?? { views: 0, visitors: new Set<string>() }
  entry.views += 1
  entry.visitors.add(visitor)
  map.set(key, entry)
}

function toRanked(map: Map<string, Counter>): ReadonlyArray<TrafficPage> {
  return [...map.entries()]
    .map(([path, counter]) => ({ path, views: counter.views, visitors: counter.visitors.size }))
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path))
}
