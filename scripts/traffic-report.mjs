#!/usr/bin/env node
/**
 * 流量报表：从**我们自己**的 nginx 访问日志里出统计。
 *
 * 为什么自建而不是接 Google Analytics：
 *   本站访客以中国大陆为主，而 GA 的域名在大陆不可达 —— 用了它只会**系统性低估真正的受众**，
 *   拿到的是一份方向错误的报表。服务端日志没有这个问题：请求已经到达服务器，
 *   广告拦截、禁用 JS、网络封锁都影响不到它。
 *
 * 用法：
 *   docker logs ecn-web 2>/dev/null | node scripts/traffic-report.mjs
 *   node scripts/traffic-report.mjs access.log            # 从文件读
 *   docker logs ecn-web --since 24h | node scripts/traffic-report.mjs --json
 *
 * 日志格式见 apps/site/nginx.conf 的 `ecn_json`（结构化 JSON，不用正则猜字段）。
 */
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"

const args = process.argv.slice(2)
const asJson = args.includes("--json")
const file = args.find((a) => !a.startsWith("--"))

/** 健康检查与探针：它们会以固定频率打首页，会把"页面浏览"整体带偏 */
const isProbe = (ua, path) =>
  /^(Wget|curl|kube-probe|ELB-HealthChecker|GoogleHC|UptimeRobot)/i.test(ua ?? "") ||
  path === "/api/health" ||
  path === "/healthz"

/** 常见爬虫（粗判，够用即可：报表里单独列一行，不计入"访客"） */
const isBot = (ua) =>
  /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|python-requests|headlesschrome|Go-http-client|axios|node-fetch|Deno/i.test(
    ua ?? ""
  )

const normalizePath = (u) => {
  const p = u.split("?")[0]
  // 把文档页归一到目录形式，避免 /docs/x 与 /docs/x/ 被算成两个页面
  if (/^\/docs\/[^.]+\/?$/.test(p) && !p.endsWith("/")) return `${p}/`
  return p
}

const isStatic = (p) =>
  /^\/_astro\//.test(p) || /\.(css|js|mjs|png|jpe?g|svg|webp|avif|ico|woff2?|ttf|map)$/i.test(p)

const stats = {
  total: 0,
  human: 0,
  probe: 0,
  bot: 0,
  pages: new Map(),
  status: new Map(),
  referrers: new Map(),
  ips: new Map(), // ip → 页面浏览数
  ai: { ask: 0, explain: 0, stats: 0 },
  slow: []
}

const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1)

const input = file !== undefined ? createReadStream(file) : process.stdin
const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })

for await (const line of rl) {
  const start = line.indexOf("{")
  if (start < 0) continue
  let e
  try {
    e = JSON.parse(line.slice(start))
  } catch {
    continue // 非 JSON 行（例如容器启动日志）直接跳过
  }
  const path = normalizePath(e.u ?? "")
  const ua = e.ua ?? ""
  stats.total += 1
  bump(stats.status, String(e.s))

  if (isProbe(ua, path)) {
    stats.probe += 1
    continue
  }
  if (isBot(ua)) {
    stats.bot += 1
    continue
  }
  stats.human += 1

  // AI 接口单独计数：它直接对应成本（见 docs/deployment.md §3.9）
  if (path === "/api/knowledge/ask") stats.ai.ask += 1
  if (path === "/api/knowledge/explain") stats.ai.explain += 1
  if (path === "/api/knowledge/stats") stats.ai.stats += 1

  if (!isStatic(path) && !path.startsWith("/api/")) {
    bump(stats.pages, path)
    if (e.ip) bump(stats.ips, e.ip)
  }
  if (e.ref && !/effect-ts\.cn/.test(e.ref)) bump(stats.referrers, e.ref)
  if (Number(e.rt) > 2) stats.slow.push({ path, rt: Number(e.rt), s: e.s })
}

const top = (map, n = 15) =>
  [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

if (asJson) {
  console.log(
    JSON.stringify(
      {
        total: stats.total,
        human: stats.human,
        bot: stats.bot,
        probe: stats.probe,
        uniqueVisitors: stats.ips.size,
        pages: Object.fromEntries(top(stats.pages, 50)),
        status: Object.fromEntries(stats.status),
        referrers: Object.fromEntries(top(stats.referrers, 30)),
        ai: stats.ai
      },
      null,
      2
    )
  )
  process.exit(0)
}

const pct = (n, d) => (d === 0 ? "0%" : `${((n / d) * 100).toFixed(1)}%`)
const line = (label, value) => console.log(`  ${label.padEnd(18)} ${value}`)

console.log("\n===== 流量报表（来自本站 nginx 日志，无第三方）=====\n")
line("请求总数", stats.total)
line("人类访客请求", `${stats.human}（${pct(stats.human, stats.total)}）`)
line("爬虫", `${stats.bot}（${pct(stats.bot, stats.total)}）`)
line("健康检查/探针", `${stats.probe}（已从统计中剔除）`)
line("独立来源 IP", stats.ips.size)

console.log("\n-- 页面浏览 Top 15 --")
for (const [p, n] of top(stats.pages)) console.log(`  ${String(n).padStart(6)}  ${p}`)

console.log("\n-- 状态码 --")
for (const [s, n] of top(stats.status, 10)) console.log(`  ${String(n).padStart(6)}  ${s}`)

if (stats.referrers.size > 0) {
  console.log("\n-- 站外来源 Top 10 --")
  for (const [r, n] of top(stats.referrers, 10)) console.log(`  ${String(n).padStart(6)}  ${r.slice(0, 90)}`)
}

console.log("\n-- AI 接口调用（直接对应 token 成本）--")
line("问答 /ask", stats.ai.ask)
line("报错诊断 /explain", stats.ai.explain)
line("状态探测 /stats", stats.ai.stats)

if (stats.slow.length > 0) {
  console.log(`\n-- 慢请求（>2s）Top 5，共 ${stats.slow.length} 条 --`)
  for (const s of stats.slow.slice(0, 5)) console.log(`  ${s.rt.toFixed(2)}s  ${s.s}  ${s.path}`)
}
console.log()
