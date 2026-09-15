/**
 * 访问报表后台（React island）。
 *
 * 数据来自 `/api/admin/traffic`，它读的是**宿主 Caddy 日志** ——
 * 站点容器的 stdout 日志随重建清零，只有宿主那份可信。
 *
 * 三点刻意的设计：
 *   1. **图表手绘 SVG，不引图表库**。只有一组柱状图 + 几张表，为它装 recharts
 *      会让站点多几百 KB，而这块页面只有一个人看。
 *   2. **口径写在界面上**（人类/收录爬虫/漏洞扫描/探针四类互斥）。报表最容易犯的错
 *      是把它们混成"流量"，于是"站点变好了"和"被扫了"看起来一模一样。
 *   3. **数据覆盖范围必须显示**。日志只覆盖几天时，30 天的图会看起来像"流量暴跌"——
 *      那不是数据，是日志不够长。
 */
import { useCallback, useEffect, useState } from "react"

const TOKEN_KEY = "ecn-admin-token"

const RANGES: ReadonlyArray<{ label: string; hours: number }> = [
  { label: "24 小时", hours: 24 },
  { label: "3 天", hours: 72 },
  { label: "7 天", hours: 168 },
  { label: "30 天", hours: 720 }
]

interface Bucket {
  bucket: string
  human: number
  machine: number
  visitors: number
}
interface PageRow {
  path: string
  views: number
  visitors: number
}
interface SourceRow {
  kind: string
  host: string
  visits: number
}
interface BotRow {
  name: string
  requests: number
  uniquePaths: number
  lastSeen: string
}
interface VisitRow {
  at: string
  path: string
  source: string
  host: string
  status: number
  visitor: string
}
interface Report {
  generatedAt: string
  rangeHours: number
  granularity: "hour" | "day"
  logFiles: number
  coveredFrom: string
  coveredTo: string
  totals: {
    requests: number
    humanRequests: number
    pageViews: number
    uniqueVisitors: number
    browserVisitors: number
    crawlerRequests: number
    scanRequests: number
    probeRequests: number
  }
  series: Bucket[]
  topPages: PageRow[]
  landingPages: PageRow[]
  sources: SourceRow[]
  bots: BotRow[]
  statuses: { status: number; count: number }[]
  recent: VisitRow[]
}

const nf = new Intl.NumberFormat("zh-CN")

/** 站点目标受众在东八区，报表也按它显示 */
const fmtTime = (iso: string, withDate = true): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: withDate ? "2-digit" : undefined,
    day: withDate ? "2-digit" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(d)
}

const fmtBucketLabel = (iso: string, granularity: "hour" | "day"): string =>
  granularity === "day"
    ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).format(
        new Date(iso)
      )
    : new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hour12: false
      }).format(new Date(iso))

const SOURCE_LABEL: Record<string, string> = {
  direct: "直接 / 来源不可知",
  search: "搜索引擎",
  social: "社区 / 平台",
  other: "其它站点",
  internal: "站内跳转"
}

export default function TrafficDashboard() {
  const [token, setToken] = useState<string>("")
  const [tokenDraft, setTokenDraft] = useState("")
  const [hours, setHours] = useState(24)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const saved = window.localStorage.getItem(TOKEN_KEY)
    if (saved !== null && saved !== "") {
      setToken(saved)
      setTokenDraft(saved)
    }
  }, [])

  const load = useCallback(
    async (useToken: string, useHours: number) => {
      if (useToken === "") return
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/admin/traffic?hours=${useHours}`, {
          headers: { Authorization: `Bearer ${useToken}` }
        })
        if (res.status === 401) {
          window.localStorage.removeItem(TOKEN_KEY)
          setToken("")
          setError("口令不对（或服务端没有配置 ADMIN_TOKEN）")
          setReport(null)
          return
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null
          setError(body?.message ?? `请求失败：HTTP ${res.status}`)
          setReport(null)
          return
        }
        setReport((await res.json()) as Report)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setReport(null)
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    void load(token, hours)
  }, [token, hours, load])

  if (token === "") {
    return (
      <section className="section" style={{ borderTop: 0 }}>
        <div className="container" style={{ maxWidth: 460 }}>
          <h1 style={{ marginBottom: "0.5rem" }}>后台 · 访问报表</h1>
          <p style={{ color: "var(--fg-muted)", fontSize: "0.9rem" }}>
            需要管理员口令（服务端 <code>ADMIN_TOKEN</code>）。口令只存在这台浏览器的
            localStorage 里，不会发给任何第三方。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const value = tokenDraft.trim()
              if (value === "") return
              window.localStorage.setItem(TOKEN_KEY, value)
              setToken(value)
            }}
            style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}
          >
            <input
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="ADMIN_TOKEN"
              autoFocus
              style={{
                flex: 1,
                padding: "0.5rem 0.7rem",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                color: "var(--fg)"
              }}
            />
            <button className="btn" type="submit">
              进入
            </button>
          </form>
          {error !== null && (
            <p style={{ color: "var(--warn, #d97706)", fontSize: "0.85rem", marginTop: "0.75rem" }}>{error}</p>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="section" style={{ borderTop: 0 }}>
      <div className="container">
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>访问报表</h1>
          <span style={{ color: "var(--fg-muted)", fontSize: "0.85rem" }}>
            数据源：宿主 Caddy 访问日志 · 不含原始 IP
          </span>
          <span style={{ marginLeft: "auto", display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {RANGES.map((range) => (
              <button
                key={range.hours}
                className={`btn ${hours === range.hours ? "" : "ghost"}`}
                onClick={() => setHours(range.hours)}
                type="button"
              >
                {range.label}
              </button>
            ))}
            <button className="btn ghost" type="button" onClick={() => void load(token, hours)} disabled={loading}>
              {loading ? "刷新中…" : "刷新"}
            </button>
            <button
              className="btn ghost"
              type="button"
              title="清除本机保存的口令"
              onClick={() => {
                window.localStorage.removeItem(TOKEN_KEY)
                setToken("")
                setReport(null)
              }}
            >
              退出
            </button>
          </span>
        </div>

        {error !== null && (
          <p style={{ color: "var(--warn, #d97706)", marginTop: "0.75rem" }}>
            {error}
          </p>
        )}

        {report !== null && <ReportBody report={report} />}
      </div>
    </section>
  )
}

function ReportBody({ report }: { report: Report }) {
  const t = report.totals
  const coverageDays = (new Date(report.coveredTo).getTime() - new Date(report.coveredFrom).getTime()) / 86400000

  return (
    <>
      <p style={{ color: "var(--fg-muted)", fontSize: "0.8rem", marginTop: "0.5rem" }}>
        生成于 {fmtTime(report.generatedAt)}（北京时间） · 读了 <strong>{report.logFiles}</strong> 个日志文件 ·
        日志实际覆盖 {fmtTime(report.coveredFrom)} → {fmtTime(report.coveredTo)}
        {coverageDays < report.rangeHours / 24 - 0.5 && (
          <strong style={{ color: "var(--warn, #d97706)" }}>
            {" "}
            —— 不足所选时间窗（只有 {coverageDays.toFixed(1)} 天），空白不代表没流量
          </strong>
        )}
      </p>

      <div style={cardsStyle}>
        <Card
          label="真实读者"
          value={t.browserVisitors}
          hint="加载过 CSS/JS 的访客 —— 真正在阅读的人"
          tone="human"
        />
        <Card
          label="独立访客（IP）"
          value={t.uniqueVisitors}
          hint="按 IP 哈希去重；含伪装成浏览器的扫描器，只作参考"
          tone="dim"
        />
        <Card label="页面浏览" value={t.pageViews} hint="人类 · 内容页" tone="human" />
        <Card label="收录型爬虫" value={t.crawlerRequests} hint="搜索引擎 + AI 抓取" tone="bot" />
        <Card label="漏洞扫描" value={t.scanRequests} hint="找 .env / wp-login 之类" tone="scan" />
        <Card label="探针 / 健康检查" value={t.probeRequests} hint="我们自己的，不是访客" tone="dim" />
        <Card label="请求总数" value={t.requests} hint="含以上全部" tone="dim" />
      </div>

      <p style={{ fontSize: "0.75rem", color: "var(--fg-muted)", marginTop: "-1rem", marginBottom: "1.5rem" }}>
        为什么要区分：UA 分不出扫描器 —— 日志里大量请求伪装成 <code>Chrome/131</code>，
        只请求一条路径就走。真浏览器打开页面后必然会去拉 <code>/_astro/*.css|js</code>，
        所以「真实读者」这个数字才接近"有多少人在读"。
      </p>

      <h2 style={h2Style}>人 vs 机器（每{report.granularity === "hour" ? "小时" : "天"}）</h2>
      <SeriesChart series={report.series} granularity={report.granularity} />

      <div style={twoColStyle}>
        <div>
          <h2 style={h2Style}>内容页 Top</h2>
          <PageTable rows={report.topPages} empty="这段时间没有人类访问内容页" />
        </div>
        <div>
          <h2 style={h2Style}>落地页（进入站点的第一页）</h2>
          <PageTable rows={report.landingPages} empty="没有带外部来源的访问" />
        </div>
      </div>

      <div style={twoColStyle}>
        <div>
          <h2 style={h2Style}>来源</h2>
          {report.sources.length === 0 ? (
            <Empty>没有站外来源</Empty>
          ) : (
            <table style={tableStyle}>
              <tbody>
                {report.sources.map((s) => (
                  <tr key={`${s.kind}|${s.host}`}>
                    <td>{SOURCE_LABEL[s.kind] ?? s.kind}</td>
                    <td style={{ color: "var(--fg-muted)" }}>{s.host === "" ? "—" : s.host}</td>
                    <td style={numStyle}>{s.visits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h2 style={h2Style}>爬虫（谁在抓、抓多深）</h2>
          {report.bots.length === 0 ? (
            <Empty>这段时间没有爬虫</Empty>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>名字</th>
                  <th style={thStyle}>请求</th>
                  <th style={thStyle}>唯一页面</th>
                  <th style={thStyle}>最后来访</th>
                </tr>
              </thead>
              <tbody>
                {report.bots.map((b) => (
                  <tr key={b.name}>
                    <td>{b.name}</td>
                    <td style={numStyle}>{b.requests}</td>
                    <td style={numStyle}>{b.uniquePaths}</td>
                    <td style={{ color: "var(--fg-muted)", fontSize: "0.8rem" }}>{fmtTime(b.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <h2 style={h2Style}>最近的真实访问</h2>
      {report.recent.length === 0 ? (
        <Empty>这段时间没有人类访问</Empty>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>时间</th>
              <th style={thStyle}>页面</th>
              <th style={thStyle}>来源</th>
              <th style={thStyle}>状态</th>
              <th style={thStyle}>访客</th>
            </tr>
          </thead>
          <tbody>
            {report.recent.map((v, i) => (
              <tr key={`${v.at}-${i}`}>
                <td style={{ whiteSpace: "nowrap", color: "var(--fg-muted)", fontSize: "0.8rem" }}>{fmtTime(v.at)}</td>
                <td style={{ fontFamily: "var(--mono, monospace)", fontSize: "0.82rem" }}>{v.path}</td>
                <td style={{ fontSize: "0.82rem" }}>
                  {SOURCE_LABEL[v.source] ?? v.source}
                  {v.host !== "" && <span style={{ color: "var(--fg-muted)" }}> · {v.host}</span>}
                </td>
                <td style={numStyle}>{v.status}</td>
                <td style={{ fontFamily: "var(--mono, monospace)", fontSize: "0.75rem", color: "var(--fg-muted)" }}>
                  {v.visitor}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={h2Style}>状态码</h2>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {report.statuses.map((s) => (
          <span key={s.status} className="badge dim">
            {s.status} · {nf.format(s.count)}
          </span>
        ))}
      </div>
    </>
  )
}

function Card({
  label,
  value,
  hint,
  tone
}: {
  label: string
  value: number
  hint: string
  tone: "human" | "bot" | "scan" | "dim"
}) {
  const color =
    tone === "human"
      ? "var(--accent, #6e56cf)"
      : tone === "bot"
        ? "var(--ok, #10b981)"
        : tone === "scan"
          ? "var(--warn, #d97706)"
          : "var(--fg-muted)"
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: "0.78rem", color: "var(--fg-muted)" }}>{label}</div>
      <div style={{ fontSize: "1.75rem", fontWeight: 700, color, lineHeight: 1.2 }}>{nf.format(value)}</div>
      <div style={{ fontSize: "0.72rem", color: "var(--fg-muted)" }}>{hint}</div>
    </div>
  )
}

/**
 * 柱状图：人（实心）+ 机器（淡色）叠在同一根柱子上。
 * 手绘 SVG —— 只有一组数据，不值得为此引入图表库。
 */
function SeriesChart({ series, granularity }: { series: Bucket[]; granularity: "hour" | "day" }) {
  if (series.length === 0) return <Empty>这段时间没有请求</Empty>

  const width = 960
  const height = 220
  const padding = { top: 12, right: 8, bottom: 28, left: 8 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const max = Math.max(1, ...series.map((b) => b.human + b.machine))
  const slot = innerW / series.length
  const barW = Math.max(2, Math.min(28, slot * 0.68))

  // 标签太密就隔几个显示一个
  const labelEvery = Math.max(1, Math.ceil(series.length / 12))

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", minWidth: 560, height: "auto" }}>
        <line
          x1={padding.left}
          y1={padding.top + innerH}
          x2={width - padding.right}
          y2={padding.top + innerH}
          stroke="var(--border)"
        />
        {series.map((b, i) => {
          const x = padding.left + i * slot + (slot - barW) / 2
          const humanH = (b.human / max) * innerH
          const machineH = (b.machine / max) * innerH
          const baseY = padding.top + innerH
          return (
            <g key={b.bucket}>
              <title>
                {fmtBucketLabel(b.bucket, granularity)} · 人 {b.human}（访客 {b.visitors}）· 机器 {b.machine}
              </title>
              <rect x={x} y={baseY - humanH} width={barW} height={humanH} fill="var(--accent, #6e56cf)" rx={2} />
              <rect
                x={x}
                y={baseY - humanH - machineH}
                width={barW}
                height={machineH}
                fill="var(--fg-muted)"
                opacity={0.35}
                rx={2}
              />
              {i % labelEvery === 0 && (
                <text
                  x={x + barW / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--fg-muted)"
                >
                  {fmtBucketLabel(b.bucket, granularity)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <p style={{ fontSize: "0.75rem", color: "var(--fg-muted)", marginTop: "0.25rem" }}>
        <span style={{ color: "var(--accent, #6e56cf)" }}>■</span> 人类 ·{" "}
        <span style={{ opacity: 0.55 }}>■</span> 机器（爬虫 + 扫描 + 探针），纵轴最大值 {nf.format(max)}
      </p>
    </div>
  )
}

function PageTable({ rows, empty }: { rows: PageRow[]; empty: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>页面</th>
          <th style={thStyle}>浏览</th>
          <th style={thStyle}>访客</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.path}>
            <td style={{ fontFamily: "var(--mono, monospace)", fontSize: "0.8rem" }}>
              <a href={r.path} target="_blank" rel="noreferrer">
                {r.path}
              </a>
            </td>
            <td style={numStyle}>{nf.format(r.views)}</td>
            <td style={numStyle}>{nf.format(r.visitors)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p style={{ color: "var(--fg-muted)", fontSize: "0.85rem" }}>{children}</p>
)

const cardsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "0.75rem",
  margin: "1rem 0 1.5rem"
}
const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "0.7rem 0.85rem",
  background: "var(--bg-elev)"
}
const h2Style: React.CSSProperties = { fontSize: "1rem", margin: "1.5rem 0 0.5rem" }
const twoColStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: "1.5rem"
}
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }
const thStyle: React.CSSProperties = {
  textAlign: "left",
  fontWeight: 500,
  color: "var(--fg-muted)",
  fontSize: "0.75rem",
  padding: "0.25rem 0.4rem",
  borderBottom: "1px solid var(--border)"
}
const numStyle: React.CSSProperties = { textAlign: "right", padding: "0.25rem 0.4rem", fontVariantNumeric: "tabular-nums" }
