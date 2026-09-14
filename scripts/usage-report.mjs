#!/usr/bin/env node
/**
 * 周报：一次看清"有没有人来 / AI 被用了多少 / 答得准不准 / Agent 侧有没有动静"。
 *
 * 为什么需要它：在它之前，站点只有"访问日志报表"，而 AI 与 Agent 面**完全没有数字** ——
 * 于是所有产品判断（该做内容还是该做分发、该上向量还是该先修拒答）都只能靠感觉。
 *
 * 数据来源（全部是我们自己的，无第三方埋点）：
 *   1. `/api/knowledge/stats` 的 `usage` 段 —— 进程内账本（今日 / 最近 7 天）；
 *   2. `--usage <文件>` —— API 容器 stdout 里的 `ecn.usage` JSONL（重启不丢，可离线复算）；
 *   3. `--access <文件>` —— 宿主 Caddy 访问日志（PV / 来源 / AI 与 Agent 端点调用数）；
 *   4. `--npm` —— npm 周下载量，作为 MCP 被 Agent 使用的代理指标。
 *
 * 用法：
 *   node scripts/usage-report.mjs                                  # 打生产 API（最省事）
 *   node scripts/usage-report.mjs --api http://127.0.0.1:8787
 *   ssh … 'sudo cat /var/log/caddy/effect-ts.cn.log*' > access.log
 *   docker logs ecn-api 2>&1 | grep ecn.usage > usage.jsonl
 *   node scripts/usage-report.mjs --access access.log --usage usage.jsonl --npm effect-ts-cn-mcp
 */
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { summarize, top } from "./lib/access-log.mjs"

const args = process.argv.slice(2)
const valueOf = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const api = valueOf("--api", "https://effect-ts.cn")
const accessFile = valueOf("--access", undefined)
const usageFile = valueOf("--usage", undefined)
const npmPackage = valueOf("--npm", "effect-ts-cn-mcp")
const days = Number(valueOf("--days", "7"))
const DAY = 86_400_000

const lines = (file) =>
  file === "-" || file === undefined
    ? createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY })
    : createInterface({ input: createReadStream(file), crlfDelay: Number.POSITIVE_INFINITY })

const pct = (n, d) => (d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`)
const num = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : "—")

// ── 1) 账本：从 API 的 usage 段，或从 JSONL 现算 ─────────────────────────────

const fetchJson = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return { error: `HTTP ${response.status}` }
    return { value: await response.json() }
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
}

const API_HINT =
  "怎么办：确认 API 在跑且是较新版本（`usage` 段是后加的，旧部署没有）；" +
  "离线场景用 `docker logs ecn-api 2>&1 | grep ecn.usage > usage.jsonl`，再 `--usage usage.jsonl`。"

const windowsFromApi = async () => {
  const result = await fetchJson(`${api.replace(/\/+$/, "")}/api/knowledge/stats`)
  if (result.error !== undefined) return { error: result.error }
  const usage = result.value?.usage
  if (usage === undefined) return { error: "该 API 的 /stats 还没有 usage 段（旧版本）" }
  return { value: { usage, stats: result.value } }
}

/** 从 `ecn.usage` JSONL 现算窗口（短名 → 计数字段，与 ports/usage-log.ts 对应） */
const windowsFromJsonl = async (file) => {
  const records = []
  for await (const line of lines(file)) {
    const match = /ecn\.usage (\{.*\})\s*$/.exec(line.trim())
    if (match === null) continue
    try {
      const raw = JSON.parse(match[1])
      records.push({
        at: Date.parse(raw.at),
        mode: raw.mode,
        refused: raw.refused === true,
        reason: raw.reason,
        citations: raw.cites ?? 0,
        resolvable: raw.resolvable ?? 0,
        cacheHit: raw.cacheHit === true,
        rewritten: raw.rewritten === true,
        expanded: raw.expanded === true,
        reranked: raw.reranked === true,
        scoped: raw.scoped === true,
        ms: raw.ms ?? 0
      })
    } catch {
      continue
    }
  }
  const empty = () => ({
    asks: 0,
    refused: 0,
    noMatch: 0,
    untranslated: 0,
    verifiable: 0,
    llm: 0,
    extractive: 0,
    cacheHits: 0,
    rewritten: 0,
    expanded: 0,
    reranked: 0,
    citations: 0,
    resolvableCitations: 0,
    durationMsTotal: 0
  })
  const accumulate = (window, entry) => ({
    asks: window.asks + 1,
    refused: window.refused + (entry.refused ? 1 : 0),
    noMatch: window.noMatch + (entry.reason === "no-match" ? 1 : 0),
    untranslated: window.untranslated + (entry.reason === "untranslated" ? 1 : 0),
    verifiable: window.verifiable + (!entry.refused && entry.resolvable > 0 ? 1 : 0),
    llm: window.llm + (entry.mode === "llm" ? 1 : 0),
    extractive: window.extractive + (entry.mode === "extractive" ? 1 : 0),
    cacheHits: window.cacheHits + (entry.cacheHit ? 1 : 0),
    rewritten: window.rewritten + (entry.rewritten ? 1 : 0),
    expanded: window.expanded + (entry.expanded ? 1 : 0),
    reranked: window.reranked + (entry.reranked ? 1 : 0),
    citations: window.citations + entry.citations,
    resolvableCitations: window.resolvableCitations + entry.resolvable,
    durationMsTotal: window.durationMsTotal + entry.ms
  })
  const now = Date.now()
  const dayStart = (millis) => Math.floor(millis / DAY) * DAY
  const windowSince = (from) => records.filter((r) => r.at >= from).reduce(accumulate, empty())
  const daily = new Map()
  for (const record of records) {
    const key = new Date(dayStart(record.at)).toISOString().slice(0, 10)
    daily.set(key, (daily.get(key) ?? 0) + 1)
  }
  return {
    value: {
      usage: {
        today: windowSince(dayStart(now)),
        last7Days: windowSince(dayStart(now) - (days - 1) * DAY),
        recorded: records.length,
        capacity: 0,
        since: records[0]?.at ?? 0
      },
      daily: [...daily.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
      source: usageFile
    }
  }
}

// ── 2) 报告 ────────────────────────────────────────────────────────────────

const now = new Date()
const from = new Date(now.getTime() - (days - 1) * DAY)
console.log(`\n# effect-ts.cn 周报`)
console.log(`\n范围：${from.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}（UTC 日）\n`)

const account = usageFile !== undefined ? await windowsFromJsonl(usageFile) : await windowsFromApi()

if (account.error !== undefined) {
  console.log(`## AI 问答\n\n取不到用量：${account.error}\n\n> ${API_HINT}\n`)
} else {
  const { usage } = account.value
  const window = usage.last7Days
  const rate = (n, d) => (d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`)
  console.log(`## AI 问答（来源：${account.value.source ?? `/api/knowledge/stats @ ${api}`}）\n`)
  console.log(`| 指标 | 最近 ${days} 天 | 今日 |`)
  console.log(`| --- | --- | --- |`)
  console.log(`| 提问次数 | ${num(window.asks)} | ${num(usage.today.asks)} |`)
  console.log(`| 拒答 | ${num(window.refused)}（${rate(window.refused, window.asks)}） | ${num(usage.today.refused)} |`)
  console.log(`| ├ 站内没有（no-match） | ${num(window.noMatch)} | ${num(usage.today.noMatch)} |`)
  console.log(`| └ 中文未翻译（untranslated） | ${num(window.untranslated)} | ${num(usage.today.untranslated)} |`)
  console.log(
    `| **可验证答率**（至少一条可解引用引用） | ${rate(window.verifiable, window.asks)} | ${rate(usage.today.verifiable, usage.today.asks)} |`
  )
  console.log(
    `| 引用可解引用率 | ${rate(window.resolvableCitations, window.citations)} | ${rate(usage.today.resolvableCitations, usage.today.citations)} |`
  )
  console.log(
    `| 缓存命中（命中即零 token） | ${rate(window.cacheHits, window.asks)} | ${rate(usage.today.cacheHits, usage.today.asks)} |`
  )
  console.log(`| 模型润色 / 检索合成 | ${num(window.llm)} / ${num(window.extractive)} | ${num(usage.today.llm)} / ${num(usage.today.extractive)} |`)
  console.log(
    `| 触发改写 / 扩展 / 重排 | ${num(window.rewritten)} / ${num(window.expanded)} / ${num(window.reranked)} | ${num(usage.today.rewritten)} / ${num(usage.today.expanded)} / ${num(usage.today.reranked)} |`
  )
  console.log(
    `| 平均耗时 | ${window.asks === 0 ? "—" : `${Math.round(window.durationMsTotal / window.asks)} ms`} | — |`
  )
  console.log(`\n进程内保留账目：${num(usage.recorded)} 条（容量 ${num(usage.capacity)}）`)
  if (Array.isArray(account.value.daily) && account.value.daily.length > 0) {
    console.log(`\n按天：${account.value.daily.map(([day, count]) => `${day} ${count}`).join(" · ")}`)
  }
  if (account.value.stats?.llmBudget !== undefined) {
    const budget = account.value.stats.llmBudget
    console.log(
      `\n今日 token：${num(budget.used)} / ${num(budget.limit)}${
        budget.exhausted ? "（**已用尽，问答已自动降级为检索合成**）" : ""
      }`
    )
  }
  if (account.value.stats !== undefined) {
    console.log(
      `\n语料：${num(account.value.stats.pages)} 页 · ${num(account.value.stats.citations)} 条可引用记录 · 报错百科 ${num(account.value.stats.errorEntries)} 条`
    )
  }
  console.log()
}

// ── 3) 流量（可选：宿主 Caddy 日志） ────────────────────────────────────────

if (accessFile !== undefined) {
  const stats = await summarize(lines(accessFile))
  console.log(`## 流量（来源：${accessFile}）\n`)
  console.log(`| 指标 | 值 |`)
  console.log(`| --- | --- |`)
  console.log(`| 请求总数 | ${num(stats.total)} |`)
  console.log(`| 人类访客请求 | ${num(stats.human)}（${pct(stats.human, stats.total)}） |`)
  console.log(`| 爬虫 | ${num(stats.bot)}（${pct(stats.bot, stats.total)}） |`)
  console.log(`| 独立来源 IP | ${num(stats.ips.size)} |`)
  console.log(`| 漏洞扫描尝试 | ${num(stats.scan)}（已剔除） |`)
  console.log(`| Agent 面取用（llms.txt / full / .md / cite） | ${stats.agent.llms} / ${stats.agent.llmsFull} / ${stats.agent.docsMd} / ${stats.agent.cite} |`)
  const pages = top(stats.pages, 10)
  if (pages.length > 0) {
    console.log(`\n页面浏览 Top 10：\n`)
    for (const [path, count] of pages) console.log(`- ${num(count)}  \`${path}\``)
  }
  const referrers = top(stats.referrers, 8)
  if (referrers.length > 0) {
    console.log(`\n站外来源 Top 8：\n`)
    for (const [referrer, count] of referrers) console.log(`- ${num(count)}  ${referrer.slice(0, 90)}`)
  }
  console.log()
}

// ── 4) Agent 侧（npm 下载量作为 MCP 使用代理指标） ──────────────────────────

console.log(`## Agent 侧\n`)
const downloads = await fetchJson(
  `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(npmPackage)}`
)
if (downloads.error !== undefined) {
  console.log(
    downloads.error === "HTTP 404"
      ? `- npm 包 \`${npmPackage}\`：**没有下载记录**（刚发布，或包名写错）`
      : `- npm 包 \`${npmPackage}\`：取不到下载量（${downloads.error}）`
  )
} else {
  console.log(`- npm 包 \`${npmPackage}\`：周下载 **${num(downloads.value?.downloads ?? 0)}** 次`)
}
console.log()

// ── 5) 读法提示（启发式，写出来是为了让数字能被正确解读） ───────────────────

if (account.error === undefined) {
  const window = account.value.usage.last7Days
  const hints = []
  if (window.asks === 0) {
    hints.push("本周没有任何提问 —— 瓶颈在**分发**，不在功能。先把已写好的文章发出去、把 MCP 推到中文 Agent 社区。")
  } else {
    const refusal = window.refused / window.asks
    if (refusal > 0.3) {
      const untranslatedShare = window.refused === 0 ? 0 : window.untranslated / window.refused
      hints.push(
        untranslatedShare > 0.5
          ? `拒答率 ${pct(window.refused, window.asks)}，其中一半以上是「中文还没这一页」 ⇒ 该补内容，向量检索救不了。`
          : `拒答率 ${pct(window.refused, window.asks)}，以「站内没有」为主 ⇒ 先看这些问题的检索词，扩展/重排是否真的触发（见上表改写/扩展/重排列）。`
      )
    }
    // 小样本不报警：4 次里错 1 次就是 75%，那不是"北极星不达标"，那是噪声
    if (window.asks >= 10 && window.verifiable / window.asks < 0.9) {
      hints.push("可验证答率低于 90% —— 北极星指标不达标，先查引用为什么不可解引用，再谈新功能。")
    }
    if (window.asks > 20 && window.cacheHits / window.asks < 0.3) {
      hints.push(`缓存命中只有 ${pct(window.cacheHits, window.asks)} —— 检查缓存 TTL 与 key 是否被 history/scope 打得过碎。`)
    }
  }
  if (hints.length > 0) {
    console.log(`## 读法提示（启发式，不是结论）\n`)
    for (const hint of hints) console.log(`- ${hint}`)
    console.log()
  }
}
