#!/usr/bin/env node
/**
 * 观测台 CLI。
 *
 *   pnpm --filter @ecn/observatory discover --snapshot 2026-09-14
 *   pnpm --filter @ecn/observatory discover --max-queries 5      # 试跑
 *
 * 设计取向：**先有数据，再有观点**。所以第一版命令只做两件事 ——
 * 发现候选、冻结快照 —— 并且把"有界宇宙"与"被截断的切片"一并写进产物。
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { discover } from "./discover.js"
import { GitHubClient } from "./github.js"
import { readCandidates, summarize, writeEffectScan, writeSnapshot } from "./snapshot.js"
import { scanEffect } from "./effect-scan.js"
import { classifyAll } from "./classify-run.js"
import { buildDataset, buildTables, computeStats } from "./dataset.js"
import { buildReport } from "./report.js"
import { buildCharts, drawReviewSample, renderReviewSheet } from "./charts.js"
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises"
import { writeAiFile } from "./snapshot.js"
import { LANGUAGES, type Language } from "./queries.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(here, "..")

interface Args {
  readonly command: string
  readonly flags: Map<string, string | true>
}

function parseArgs(argv: ReadonlyArray<string>): Args {
  const command = argv[0] ?? "help"
  const flags = new Map<string, string | true>()
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]!
    if (!token.startsWith("--")) continue
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(token.slice(2), next)
      index += 1
    } else {
      flags.set(token.slice(2), true)
    }
  }
  return { command, flags }
}

const flagString = (args: Args, name: string): string | undefined => {
  const value = args.flags.get(name)
  return typeof value === "string" ? value : undefined
}
const flagNumber = (args: Args, name: string): number | undefined => {
  const value = flagString(args, name)
  return value === undefined ? undefined : Number(value)
}

const isoDate = (date: Date): string => date.toISOString().slice(0, 10)

const usage = (): void => {
  console.log(`观测台 CLI

  discover [选项]     发现候选池并冻结快照
  scan [选项]         对快照里的 TypeScript 候选做 Effect 使用深度扫描（L0–L4）
  classify [选项]     对全部候选做 Agent 分类（A1–A4，带证据强度）
  report [选项]       生成 Dataset v0.1（四张 CSV + dataset.json）与调查报告

选项：
  --snapshot <YYYY-MM-DD>   快照日（默认今天）
  --min-stars <n>           星数下限（默认 300）
  --since-days <n>          只看最近 N 天有 push 的仓库（默认 180）
  --languages a,b           限定语言（默认 ${LANGUAGES.join(",")}）
  --max-queries <n>         只跑前 N 条查询（试跑用）
  --force                   允许覆盖已存在的快照目录（**不推荐**）
`)
}

/** 扫描：读快照的 TS 候选 → 复用生态榜的观测器 → 写 effect-scan.json */
async function runScan(args: Args): Promise<void> {
  const snapshotsRoot = path.join(packageRoot, "data", "snapshots")
  const resolved = flagString(args, "snapshot") ?? (await latestSnapshot(snapshotsRoot))
  if (resolved === undefined) throw new Error("找不到快照：先跑 discover")
  const dir = path.join(snapshotsRoot, resolved)

  const all = await readCandidates(dir)
  const typeScript = all.filter((candidate) => candidate.githubLanguage === "TypeScript")
  console.log(`快照 ${resolved}：候选 ${all.length} · 其中 TypeScript ${typeScript.length}（只有它们需要深度扫描，Effect 是 TS 生态）`)

  const result = await scanEffect(typeScript, {
    cacheFile: path.join(packageRoot, "..", "..", "artifacts", "observatory", "effect-cache.json"),
    ...(flagNumber(args, "concurrency") !== undefined ? { concurrency: flagNumber(args, "concurrency")! } : {}),
    ...(flagNumber(args, "limit") !== undefined ? { limit: flagNumber(args, "limit")! } : {}),
    log: (message) => console.log(message)
  })

  const file = await writeEffectScan(dir, result)
  console.log(`\nEffect 使用深度：${JSON.stringify(result.byDepth)}`)
  const deep = result.entries.filter((entry) => entry.depth === "L2" || entry.depth === "L3" || entry.depth === "L4")
  console.log(`真正在用 Effect（L2+）：${deep.length} / ${result.candidates} = ${((deep.length / Math.max(1, result.candidates)) * 100).toFixed(1)}%`)
  console.log("\nL2+ 项目（前 15）：")
  for (const entry of deep.slice(0, 15)) {
    console.log(`  ${entry.depth} ${String(entry.stars).padStart(7)}★ ${entry.repo.padEnd(42)} 能力 ${entry.capabilities.length} 项${entry.usesAi ? " · @effect/ai" : ""}`)
  }
  console.log(`\n写入 ${path.relative(process.cwd(), file)}`)
}

/** 分类：读快照候选 → 取文件树与 manifest → 规则分类 → 写 agent-classification.json */
async function runClassify(args: Args): Promise<void> {
  const snapshotsRoot = path.join(packageRoot, "data", "snapshots")
  const resolved = flagString(args, "snapshot") ?? (await latestSnapshot(snapshotsRoot))
  if (resolved === undefined) throw new Error("找不到快照：先跑 discover")
  const dir = path.join(snapshotsRoot, resolved)

  const all = await readCandidates(dir)
  console.log(`快照 ${resolved}：对 ${all.length} 个候选做 Agent 分类`)

  const result = await classifyAll(all, {
    // 与 Effect 扫描共用同一份 GitHub 观测缓存（TS 部分的文件树已经热了）
    cacheFile: path.join(packageRoot, "..", "..", "artifacts", "observatory", "effect-cache.json"),
    ...(flagNumber(args, "concurrency") !== undefined ? { concurrency: flagNumber(args, "concurrency")! } : {}),
    ...(flagNumber(args, "limit") !== undefined ? { limit: flagNumber(args, "limit")! } : {}),
    log: (message) => console.log(message)
  })

  const file = await writeAiFile(dir, "agent-classification.json", result)
  console.log(`\n判定：${JSON.stringify(result.byVerdict)}`)
  console.log(`证据强度：${JSON.stringify(result.byTier)}`)
  console.log(`类型分布：${JSON.stringify(result.byType)}`)
  if (result.unreadable.length > 0) console.log(`⚠️ 文件树读不到（记为 unknown，不算 not-agent）：${result.unreadable.length}`)
  console.log(`\n写入 ${path.relative(process.cwd(), file)}`)
}

/** 报告：三份快照产物 → Dataset v0.1 + 调查报告（数字全部现算，不手抄） */
async function runReport(args: Args): Promise<void> {
  const snapshotsRoot = path.join(packageRoot, "data", "snapshots")
  const resolved = flagString(args, "snapshot") ?? (await latestSnapshot(snapshotsRoot))
  if (resolved === undefined) throw new Error("找不到快照：先跑 discover / scan / classify")
  const dir = path.join(snapshotsRoot, resolved)

  const candidates = await readCandidates(dir)
  const frame = JSON.parse(await readFile(path.join(dir, "frame.json"), "utf8")) as {
    frame?: { snapshotDate?: string }
    raisedFloors?: ReadonlyArray<{ effectiveMinStars: number; total: number }>
    truncatedSlices?: ReadonlyArray<string>
    statement?: string
  }
  const classifications = (JSON.parse(await readFile(path.join(dir, "agent-classification.json"), "utf8")) as {
    entries: ReadonlyArray<import("./agent-classify.js").AgentClassification>
    byTier: Record<string, number>
  })
  const scans = (JSON.parse(await readFile(path.join(dir, "effect-scan.json"), "utf8")) as {
    entries: ReadonlyArray<import("./effect-scan.js").EffectScanEntry>
    byEvidence: Record<string, number>
  })

  const dataset = buildDataset({
    snapshotDate: resolved,
    version: "0.1",
    candidates,
    classifications: classifications.entries,
    effectScans: scans.entries
  })
  const stats = computeStats(dataset)
  const tables = buildTables(dataset)

  // 结论由**人**写：读 data/conclusion.md（每行一条），缺省时明确写"待补"
  let conclusion: string
  try {
    conclusion = await readFile(path.join(packageRoot, "data", "conclusion.md"), "utf8")
  } catch {
    conclusion = "（结论待人工填写：packages/observatory/data/conclusion.md）"
  }

  const markdown = buildReport({
    dataset,
    stats,
    agentEvidence: classifications.byTier,
    effectEvidence: scans.byEvidence,
    raisedFloors: frame.raisedFloors ?? [],
    truncatedSlices: frame.truncatedSlices ?? [],
    frameStatement: frame.statement ?? "",
    conclusion
  })

  // 产物：dataset/ 下的四张 CSV + dataset.json，以及 reports/ 下的报告
  const datasetDir = path.join(packageRoot, "data", "dataset")
  await mkdir(datasetDir, { recursive: true })
  await writeFile(path.join(datasetDir, "dataset.json"), JSON.stringify(dataset), "utf8")
  await writeFile(path.join(datasetDir, "agents.csv"), tables.agents, "utf8")
  await writeFile(path.join(datasetDir, "typescript-agents.csv"), tables.typeScriptAgents, "utf8")
  await writeFile(path.join(datasetDir, "effect-agents.csv"), tables.effectAgents, "utf8")
  await writeFile(path.join(datasetDir, "frameworks.csv"), tables.frameworks, "utf8")
  await writeFile(path.join(datasetDir, "stats.json"), JSON.stringify(stats, null, 2), "utf8")

  // 站点侧产物：site 的 Docker 构建上下文里只有 apps/site 与两个 package，
  // 所以页面**不能**在构建期读 packages/observatory/data（实测 CI 的 docker 任务就栽在这里）。
  // 与 ecosystem.json 同一模式：数据管线把页面需要的那一份生成进站点自己的树里。
  const siteDataDir = path.join(packageRoot, "..", "..", "apps", "site", "src", "data")
  const siteChartDir = path.join(packageRoot, "..", "..", "apps", "site", "public", "observatory", "charts")
  await mkdir(siteDataDir, { recursive: true })
  await mkdir(siteChartDir, { recursive: true })
  const siteCharts = buildCharts(dataset, stats)
  for (const [name, svg] of Object.entries(siteCharts)) {
    await writeFile(path.join(siteChartDir, name), svg, "utf8")
  }
  await writeFile(
    path.join(siteDataDir, "observatory.json"),
    JSON.stringify(
      {
        snapshotDate: dataset.snapshotDate,
        version: dataset.version,
        generatedAt: dataset.generatedAt,
        stats,
        conclusion,
        charts: Object.keys(siteCharts).sort(),
        effectAgents: dataset.rows
          .filter((row) => row.isAgent && row.githubLanguage === "TypeScript" && ["L2", "L3", "L4"].includes(row.effectDepth))
          .sort((a, b) => b.stars - a.stars)
          .map((row) => ({
            repo: row.repo,
            url: row.url,
            stars: row.stars,
            agentType: row.agentType,
            effectDepth: row.effectDepth,
            effectDeps: row.effectDeps,
            capabilities: row.effectCapabilities.length
          }))
      },
      null,
      2
    ),
    "utf8"
  )

  // 结论走**站点的 Markdown 管线**：塞进 set:html 只会把 `**` 与 `-` 原样显示（实测踩到）
  const conclusionDir = path.join(packageRoot, "..", "..", "apps", "site", "src", "content", "observatory")
  await mkdir(conclusionDir, { recursive: true })
  await writeFile(
    path.join(conclusionDir, "conclusion.md"),
    `---
title: 结论
snapshotDate: "${dataset.snapshotDate}"
---

${conclusion.replace(/^#.*\n/, "").trim()}
`,
    "utf8"
  )

  const reportsDir = path.join(packageRoot, "..", "..", "reports")
  await mkdir(reportsDir, { recursive: true })
  const reportFile = path.join(reportsDir, `effect-agent-ecosystem-v${dataset.version}.md`)
  await writeFile(reportFile, markdown, "utf8")

  console.log(`Agent 判定：${stats.agents} / ${stats.total}（判不准 ${stats.uncertain}）`)
  console.log(`TypeScript Agent：${stats.typeScriptAgents} · 其中 Effect（L2+）：${stats.effectAgents} = ${(stats.effectShareOfTypeScriptAgents * 100).toFixed(1)}%`)
  console.log(`Effect 深度分布：${stats.effectByDepth.map((row) => `${row.depth} ${row.count}`).join(" · ")}`)
  console.log(`\n写入：`)
  for (const file of ["dataset.json", "agents.csv", "typescript-agents.csv", "effect-agents.csv", "frameworks.csv", "stats.json"]) {
    console.log(`  packages/observatory/data/dataset/${file}`)
  }
  console.log(`  ${path.relative(process.cwd(), reportFile)}`)

  // 图表（计划 §48）与人工审核抽样表（计划 §7）
  const charts = buildCharts(dataset, stats)
  const chartsDir = path.join(packageRoot, "data", "charts")
  await mkdir(chartsDir, { recursive: true })
  for (const [name, svg] of Object.entries(charts)) {
    await writeFile(path.join(chartsDir, name), svg, "utf8")
  }
  const sample = drawReviewSample(dataset, flagNumber(args, "review-sample") ?? 120)
  const reviewFile = path.join(dataDirOrDefault(), "review-sample.md")
  await mkdir(path.dirname(reviewFile), { recursive: true })
  await writeFile(reviewFile, renderReviewSheet(sample, resolved), "utf8")

  console.log(`  packages/observatory/data/charts/（${Object.keys(charts).length} 张图）`)
  console.log(`  apps/site/src/data/observatory.json + apps/site/public/observatory/charts/（站点侧）`)
  console.log(`  apps/site/src/content/observatory/conclusion.md（结论，走站点 Markdown 管线）`)
  console.log(`  ${path.relative(process.cwd(), reviewFile)}（人工审核抽样 ${sample.entries.length} 条）`)
}

/** 抽样表落在 docs/observatory/ 下（它是给人看的流程产物，不是数据） */
function dataDirOrDefault(): string {
  return path.join(packageRoot, "..", "..", "docs", "observatory")
}

async function latestSnapshot(root: string): Promise<string | undefined> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1)
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.command === "help" || args.command === "--help") {
    usage()
    return
  }

  if (args.command === "scan") {
    await runScan(args)
    return
  }

  if (args.command === "classify") {
    await runClassify(args)
    return
  }

  if (args.command === "report") {
    await runReport(args)
    return
  }

  if (args.command !== "discover") {
    usage()
    process.exitCode = 1
    return
  }

  const now = new Date()
  const snapshotDate = flagString(args, "snapshot") ?? isoDate(now)
  const minStars = flagNumber(args, "min-stars") ?? 300
  const sinceDays = flagNumber(args, "since-days") ?? 180
  const pushedSince = isoDate(new Date(now.getTime() - sinceDays * 86_400_000))
  const languages = flagString(args, "languages")?.split(",").map((item) => item.trim()) as
    | ReadonlyArray<Language>
    | undefined

  const client = new GitHubClient({
    cacheDir: path.join(packageRoot, "..", "..", "artifacts", "observatory", "cache")
  })

  const limits = await client.rateLimit()
  console.log(
    `配额预检：core ${limits.core.remaining}/${limits.core.limit}（5000/小时） · ` +
      `search ${limits.search.remaining}/${limits.search.limit}（30/分钟，不够时会自动等到重置）`
  )

  console.log(
    `开始发现：stars ≥ ${minStars} · ${pushedSince} 之后有 push · 语言 ${(languages ?? LANGUAGES).join("/")}`
  )

  const result = await discover({
    snapshotDate,
    minStars,
    pushedSince,
    ...(languages !== undefined ? { languages } : {}),
    ...(flagNumber(args, "max-queries") !== undefined ? { maxQueries: flagNumber(args, "max-queries")! } : {}),
    client
  })

  const summary = summarize(result)
  const paths = await writeSnapshot(result, {
    root: path.join(packageRoot, "data", "snapshots"),
    ...(args.flags.get("force") === true ? { force: true } : {})
  })

  console.log(`\n候选池：${summary.totalCandidates} 个仓库（去重前命中 ${result.calls.reduce((sum, call) => sum + call.taken, 0)} 条）`)
  console.log(`  语言（GitHub 字段，参考口径）：${summary.byGithubLanguage.slice(0, 8).map((row) => `${row.language} ${row.count}`).join(" · ")}`)
  console.log(`  TypeScript 候选（需要深度扫描）：${summary.typeScriptCandidates}`)
  console.log(`  Stars：中位 ${summary.stars.median} · 均值 ${summary.stars.mean} · p90 ${summary.stars.p90} · 最高 ${summary.stars.max}`)
  console.log(`  近 90 天有 push：${summary.active90d}`)
  console.log(`  排除：fork ${summary.forksExcluded} · archived ${summary.archivedExcluded} · 合并重复 ${summary.duplicateMerges}`)
  console.log(`  疑似同一项目的组（待人判断）：${summary.possibleDuplicateGroups}`)
  if (result.truncatedSlices.length > 0) {
    console.log(`  ⚠️ 被 1000 上限截断的切片：${result.truncatedSlices.length} 条（已写入 search-calls.json）`)
  }
  console.log(`  API：网络 ${result.api.networkCalls} 次 · 缓存命中 ${result.api.cacheHits} 次 · 等配额 ${result.api.waits} 次`)
  console.log(`\n快照：${paths.dir}`)
  console.log(`  ${path.relative(process.cwd(), paths.candidates)}`)
  console.log(`  ${path.relative(process.cwd(), paths.summary)}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
