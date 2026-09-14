#!/usr/bin/env node
/**
 * 流量报表：从**我们自己**的访问日志里出统计。
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
 * 解析逻辑在 scripts/lib/access-log.mjs（与 usage-report 共享一份字段映射）。
 */
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { summarize, top } from "./lib/access-log.mjs"

const args = process.argv.slice(2)
const asJson = args.includes("--json")
const file = args.find((a) => !a.startsWith("--"))

const input = file !== undefined ? createReadStream(file) : process.stdin
const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })

const stats = await summarize(rl)

if (asJson) {
  console.log(
    JSON.stringify(
      {
        total: stats.total,
        human: stats.human,
        bot: stats.bot,
        probe: stats.probe,
        scan: stats.scan,
        uniqueVisitors: stats.ips.size,
        pages: Object.fromEntries(top(stats.pages, 50)),
        status: Object.fromEntries(stats.status),
        referrers: Object.fromEntries(top(stats.referrers, 30)),
        ai: stats.ai,
        agent: stats.agent
      },
      null,
      2
    )
  )
  process.exit(0)
}

const pct = (n, d) => (d === 0 ? "0%" : `${((n / d) * 100).toFixed(1)}%`)
const line = (label, value) => console.log(`  ${label.padEnd(18)} ${value}`)

console.log("\n===== 流量报表（来自宿主 Caddy 日志，无第三方）=====\n")
line("请求总数", stats.total)
line("人类访客请求", `${stats.human}（${pct(stats.human, stats.total)}）`)
line("爬虫", `${stats.bot}（${pct(stats.bot, stats.total)}）`)
line("健康检查/探针", `${stats.probe}（已从统计中剔除）`)
line(
  "漏洞扫描尝试",
  stats.scan > 0
    ? `${stats.scan}（已从统计中剔除；公开站点被扫是常态，关键是确认这些路径都返回 404）`
    : "0"
)
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

console.log("\n-- Agent 面（机器消费者）--")
line("llms.txt", stats.agent.llms)
line("llms-full.txt", stats.agent.llmsFull)
line("单页 .md", stats.agent.docsMd)
line("引用核验 /cite/*", stats.agent.cite)

if (stats.slow.length > 0) {
  console.log(`\n-- 慢请求（>2s）Top 5，共 ${stats.slow.length} 条 --`)
  for (const s of stats.slow.slice(0, 5)) console.log(`  ${s.rt.toFixed(2)}s  ${s.s}  ${s.path}`)
}
console.log()
