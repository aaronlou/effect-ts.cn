/**
 * 访问流量报表契约（**仅站主可见**）。
 *
 * 数据源是**宿主 Caddy 的访问日志**，不是站点容器的 stdout ——
 * 后者随容器重建清零（每次部署都会），只有宿主日志持久且自带轮转，
 * 是唯一可信的访问记录。
 *
 * 两类刻意的设计：
 *   1. **不含任何原始 IP**：报表只输出 IP 的**哈希前缀**，够区分访客、不够定位到人
 *      （与站点的 /privacy 说法保持一致）。
 *   2. **访客分成四类且互斥**（human / crawler / scanner / probe），沿用的是 CLI 报表
 *      `scripts/lib/access-log.mjs` 里那套判据 —— 后台与命令行的数字必须能对上。
 *      把"收录型爬虫"和"来找 .env 的漏洞扫描"混成一个"机器人"会让报表失去意义。
 */
import { Schema } from "effect"

/** 来源类别 —— 比原始 referer 更能回答"流量从哪来" */
export const SourceKind = Schema.Literal("direct", "internal", "search", "social", "other")
export type SourceKind = Schema.Schema.Type<typeof SourceKind>

/** 时间序列的一个桶（小时或天）。`machine` = 爬虫 + 扫描 + 探针 */
export const TrafficBucketDto = Schema.Struct({
  /** 桶起点（ISO 字符串，可直接当图表 x 轴） */
  bucket: Schema.String,
  human: Schema.Number,
  machine: Schema.Number,
  /** 该桶内的人类独立访客数 */
  visitors: Schema.Number
})

/** 页面维度 */
export const TrafficPageDto = Schema.Struct({
  path: Schema.String,
  views: Schema.Number,
  visitors: Schema.Number
})

/** 来源维度 */
export const TrafficSourceDto = Schema.Struct({
  kind: SourceKind,
  /** referer 主机名；direct 时为空串 */
  host: Schema.String,
  visits: Schema.Number
})

/** 收录型爬虫维度 —— 用来判断"搜索引擎与 AI 抓取这两条线通不通" */
export const TrafficBotDto = Schema.Struct({
  name: Schema.String,
  requests: Schema.Number,
  uniquePaths: Schema.Number,
  lastSeen: Schema.Date
})

/** 最近的真实访问明细（只含人类） */
export const TrafficVisitDto = Schema.Struct({
  at: Schema.Date,
  path: Schema.String,
  source: SourceKind,
  /** 来源主机（搜索引擎/社区）或空串 */
  host: Schema.String,
  status: Schema.Number,
  /** IP 哈希前缀，不是原始 IP */
  visitor: Schema.String
})

export const TrafficReportDto = Schema.Struct({
  generatedAt: Schema.Date,
  rangeHours: Schema.Number,
  granularity: Schema.Literal("hour", "day"),
  /** 实际参与统计的日志文件数（含轮转备份） */
  logFiles: Schema.Number,
  /** 日志实际覆盖的起止时刻 —— 数据没你想的那么长时，报表要自己说清楚 */
  coveredFrom: Schema.Date,
  coveredTo: Schema.Date,
  totals: Schema.Struct({
    requests: Schema.Number,
    humanRequests: Schema.Number,
    pageViews: Schema.Number,
    uniqueVisitors: Schema.Number,
    crawlerRequests: Schema.Number,
    scanRequests: Schema.Number,
    probeRequests: Schema.Number
  }),
  series: Schema.Array(TrafficBucketDto),
  topPages: Schema.Array(TrafficPageDto),
  /** 落地页：referer 不是站内的那些访问（近似"会话第一页"） */
  landingPages: Schema.Array(TrafficPageDto),
  sources: Schema.Array(TrafficSourceDto),
  bots: Schema.Array(TrafficBotDto),
  statuses: Schema.Array(Schema.Struct({ status: Schema.Number, count: Schema.Number })),
  recent: Schema.Array(TrafficVisitDto)
})

export type TrafficBucketDto = Schema.Schema.Type<typeof TrafficBucketDto>
export type TrafficPageDto = Schema.Schema.Type<typeof TrafficPageDto>
export type TrafficSourceDto = Schema.Schema.Type<typeof TrafficSourceDto>
export type TrafficBotDto = Schema.Schema.Type<typeof TrafficBotDto>
export type TrafficVisitDto = Schema.Schema.Type<typeof TrafficVisitDto>
export type TrafficReportDto = Schema.Schema.Type<typeof TrafficReportDto>
