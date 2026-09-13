#!/usr/bin/env node
/**
 * 报错百科快照导出 / 校验。
 *
 * ── 为什么需要快照 ────────────────────────────────────────────────────
 * 百科条目是**运行时增长**的（存在 Postgres 里），但站点是静态的。
 * 如果只靠客户端拉取，条目就永远进不了静态 HTML —— 而**人们是拿报错去搜索的**，
 * 搜不到等于这个功能的价值少了一半。所以：
 *
 *   运行时条目（Postgres）  --export-->  apps/site/src/data/errors.json（提交进仓库）
 *                                              |
 *                                        构建期生成静态页 /errors/<signature>/
 *
 * 同一套思路站上已经用在生态榜上（ecosystem:collect → ecosystem.json → 静态页）。
 *
 * ── 两条纪律 ──────────────────────────────────────────────────────────
 * 1. **导出走 HTTP 接口，不直连数据库**：这样本机也能导出生产的数据，
 *    也不需要在导出机器上配数据库凭据；
 * 2. **导出绝不会清空已有快照**：接口挂了/返回 0 条时**拒绝写入**并退出非 0 ——
 *    否则一次网络抖动就会把已经积累的百科从站点上抹掉。
 *
 * 用法：
 *   node scripts/export-errors.mjs                    # 从 https://effect-ts.cn 导出
 *   node scripts/export-errors.mjs --api http://127.0.0.1:8787
 *   node scripts/export-errors.mjs --check            # 只校验已提交的快照（CI 用，离线）
 */
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SNAPSHOT = path.join(ROOT, "apps/site/src/data/errors.json")
const DEFAULT_API = process.env["ECN_API_BASE"] ?? "https://effect-ts.cn"
const LIMIT = 500

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const checkOnly = args.includes("--check")
const api = flag("--api", DEFAULT_API).replace(/\/+$/, "")

const SIGNATURE = /^[a-z0-9]+-[a-z0-9]+$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

/**
 * 快照校验（离线、确定性）。
 *
 * 刻意**不校验"签名是否等于从 errorText 重算的结果"**：存下来的是**截断后**的报错样本
 * （2000 字符），而签名是按完整文本算的 —— 重算必然对不上。这种"看起来更严格、
 * 实际是错的"断言比不校验更糟，所以不做。
 */
export function validateSnapshot(snapshot) {
  const problems = []
  if (typeof snapshot !== "object" || snapshot === null) return ["快照不是对象"]
  if (typeof snapshot.generatedAt !== "string" || !ISO.test(snapshot.generatedAt)) {
    problems.push(`generatedAt 不是 ISO 时间：${snapshot.generatedAt}`)
  }
  if (typeof snapshot.source !== "string" || snapshot.source.trim() === "") {
    problems.push("缺少 source（快照来自哪个接口）")
  }
  if (!Array.isArray(snapshot.entries)) return [...problems, "entries 不是数组"]

  const seen = new Set()
  for (const entry of snapshot.entries) {
    const at = (message) => problems.push(`${entry?.signature ?? "<无签名>"}: ${message}`)
    if (typeof entry?.signature !== "string" || !SIGNATURE.test(entry.signature)) {
      problems.push(`签名形态非法：${entry?.signature}`)
      continue
    }
    if (seen.has(entry.signature)) at("重复条目")
    seen.add(entry.signature)
    if (!Array.isArray(entry.codes) || !Array.isArray(entry.symbols)) at("codes/symbols 不是数组")
    if (typeof entry.errorText !== "string" || entry.errorText.trim() === "") at("errorText 为空")
    if (typeof entry.answer !== "string" || entry.answer.trim() === "") at("answer 为空")
    if (!Array.isArray(entry.citations)) at("citations 不是数组")
    if (entry.mode !== "extractive" && entry.mode !== "llm") at(`mode 非法：${entry.mode}`)
    if (!Number.isInteger(entry.hits) || entry.hits < 1) at(`hits 非法：${entry.hits}`)
    if (!ISO.test(entry.firstSeen ?? "")) at("firstSeen 不是 ISO 时间")
    if (!ISO.test(entry.lastSeen ?? "")) at("lastSeen 不是 ISO 时间")
    if (typeof entry.reviewed !== "boolean") at("reviewed 必须是布尔")
    // 治理纪律：未经人审的条目必须能被识别出来。这里只要求字段存在且类型正确，
    // 不要求它一定是 true —— 但展示层不得省略它（页面侧有对应的渲染断言）
    if (entry.reviewed === false && entry.citations.length === 0) {
      at("既未经人审、又没有引用 —— 这种条目不该出现在公开快照里")
    }
  }
  return problems
}

if (checkOnly) {
  let snapshot
  try {
    snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"))
  } catch (error) {
    console.error(`✘ 读不到快照 ${SNAPSHOT}：${String(error)}`)
    process.exit(1)
  }
  const problems = validateSnapshot(snapshot)
  if (problems.length > 0) {
    console.error(`✘ 报错百科快照校验失败（${problems.length} 条）：`)
    for (const problem of problems) console.error(`  · ${problem}`)
    process.exit(1)
  }
  console.log(
    `✔ 报错百科快照校验通过（${snapshot.entries.length} 条，数据截至 ${snapshot.generatedAt}，来源 ${snapshot.source}）`
  )
  process.exit(0)
}

// ── 导出 ──────────────────────────────────────────────────────────────
const url = `${api}/api/knowledge/errors?limit=${LIMIT}`
let payload
try {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  payload = await response.json()
} catch (error) {
  console.error(`✘ 导出失败（${url}）：${String(error)}`)
  console.error("  已保留现有快照不动 —— 一次网络抖动不该把百科从站点上抹掉。")
  process.exit(1)
}

/** 接口返回的是列表用答案（截断过）。快照要存**完整答案**，否则静态页显示不全。 */
const details = await Promise.all(
  (payload.entries ?? []).map(async (entry) => {
    try {
      const response = await fetch(`${api}/api/knowledge/errors/${encodeURIComponent(entry.signature)}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(20_000)
      })
      return response.ok ? await response.json() : entry
    } catch {
      return entry
    }
  })
)

const previous = (() => {
  try {
    return JSON.parse(readFileSync(SNAPSHOT, "utf8"))
  } catch {
    return undefined
  }
})()

// 空结果**不清空已有快照**：新站刚上线时接口就是 0 条，
// 若直接写入会把别人已经积累的百科抹掉（而这里是不可恢复的）
if (details.length === 0 && (previous?.entries?.length ?? 0) > 0) {
  console.error(
    `✘ 接口返回 0 条，但现有快照有 ${previous.entries.length} 条 —— 拒绝写入。` +
      "（若确实要清空，请手动编辑该文件）"
  )
  process.exit(1)
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: api,
  /** 快照口径写进产物：读者与后续维护者都该知道这些条目是怎么来的 */
  method:
    "来自站内 /debug 的真实诊断，按报错签名归并（绝对路径/行列号/堆栈帧已归一）。" +
    "条目为机器生成、未经人审（reviewed 字段），引用是提问那一刻的快照。",
  entries: details
}

const problems = validateSnapshot(snapshot)
if (problems.length > 0) {
  console.error(`✘ 导出结果自身不合格（${problems.length} 条），拒绝写入：`)
  for (const problem of problems) console.error(`  · ${problem}`)
  process.exit(1)
}

writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 1)}\n`)
const added = details.filter((entry) => !(previous?.entries ?? []).some((old) => old.signature === entry.signature))
console.log(
  `✔ 已写入 ${path.relative(ROOT, SNAPSHOT)}：${details.length} 条（新增 ${added.length} 条，来源 ${api}）`
)
