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
import { summarize, writeSnapshot } from "./snapshot.js"
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

选项：
  --snapshot <YYYY-MM-DD>   快照日（默认今天）
  --min-stars <n>           星数下限（默认 300）
  --since-days <n>          只看最近 N 天有 push 的仓库（默认 180）
  --languages a,b           限定语言（默认 ${LANGUAGES.join(",")}）
  --max-queries <n>         只跑前 N 条查询（试跑用）
  --force                   允许覆盖已存在的快照目录（**不推荐**）
`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.command === "help" || args.command === "--help") {
    usage()
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
