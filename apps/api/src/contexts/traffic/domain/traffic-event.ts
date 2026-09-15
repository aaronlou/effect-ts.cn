/**
 * Traffic 上下文 · domain：一次请求的最小事实。
 *
 * 纯类型与纯判定 —— 不读文件、不连库、不看时钟。适配器负责把 Caddy 的日志行
 * 变成这个形状，报表只认这个形状。
 */

/** 来源类别 */
export type SourceKind = "direct" | "internal" | "search" | "social" | "other"

/**
 * 访客类别：**四类互斥且完备**，加起来严格等于总请求数。
 *
 * 为什么必须分开而不是笼统的"人 / 机器人"：
 *   · `crawler` 是**资产**（搜索引擎来收录、AI 来读）—— 它涨说明分发在起作用；
 *   · `scanner` 是**噪音**（来找 `.env`、`wp-login` 的），公开站点必然有，单独计数只为不污染页面榜；
 *   · `probe` 是**我们自己的健康检查**，不是访客。
 * 混在一起看，就完全分不清"站点变好了"还是"被扫了"。
 */
export type VisitorKind = "human" | "crawler" | "scanner" | "probe"

export interface TrafficEvent {
  readonly at: Date
  readonly method: string
  /** 已归一化的路径（见 access-log 的 normalizePath） */
  readonly path: string
  readonly status: number
  readonly durationSeconds: number
  readonly bytes: number
  /** IP 的哈希前缀 —— 绝不保留原始 IP */
  readonly visitor: string
  readonly kind: VisitorKind
  /** 收录型爬虫名（kind === "crawler" 时）；其余为 null */
  readonly crawlerName: string | null
  readonly source: SourceKind
  /** referer 主机名；direct 时为空串 */
  readonly sourceHost: string
  readonly referer: string
  /** 是否算一次"页面浏览"（HTML 页面，排除静态资源与 API） */
  readonly isPageView: boolean
}
