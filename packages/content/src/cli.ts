/**
 * 内容管线 CLI（Phase 0 只有一个子命令 status）
 *
 *   ecn-content status [--dir <译文目录>]
 *
 * 输出：译文同步状态摘要 —— 总量 / 各版本 / 各状态 / 孤儿译文（缺上游基线）。
 * 供：本地译者自查、CI 门禁（Phase 1）、/docs/translation-status 页面的数据源。
 */
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { scanDocsDir, summarize } from "./status.js"

const HELP = `用法：
  ecn-content status [--dir <译文目录>]
  （默认查找 apps/site/src/content/docs）
`

function resolveDocsDir(cliDir: string | undefined): string {
  if (cliDir !== undefined) return path.resolve(cliDir)

  const candidates = [
    path.resolve(process.cwd(), "apps/site/src/content/docs"),
    path.resolve(process.cwd(), "../../apps/site/src/content/docs"),
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../apps/site/src/content/docs"
    )
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  // 目录不存在也返回首选路径，扫描会给出明确报错
  return candidates[0]!
}

async function runStatus(cliDir: string | undefined): Promise<number> {
  const dir = resolveDocsDir(cliDir)
  const entries = await scanDocsDir(dir)
  const summary = summarize(entries)

  console.log(`译文目录：${dir}\n`)

  const order: Array<keyof typeof summary.byStatus> = [
    "published",
    "reviewing",
    "translating",
    "pending",
    "stale"
  ]
  const row = (label: string, n: number) =>
    console.log(`${label.padEnd(12)} ${String(n).padStart(4)}`)

  console.log("── 按状态 ──")
  for (const status of order) row(status, summary.byStatus[status])
  console.log("")
  console.log("── 按版本 ──")
  for (const [version, n] of Object.entries(summary.byVersion)) row(version, n)
  console.log("")
  console.log(`合计 ${summary.total} 篇；孤儿译文（缺 upstreamPath/upstreamCommit）${summary.orphaned} 篇`)

  if (summary.published.length > 0) {
    console.log("\n── 已发布译文 ──")
    for (const entry of summary.published) {
      const baseline = entry.upstreamCommit?.slice(0, 7) ?? "?"
      console.log(
        `  [${entry.version}] ${entry.status === "stale" ? "⚠ 落后" : "✓"} ${entry.file}  @${baseline}`
      )
    }
  }
  return 0
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP)
    return args.length === 0 ? 1 : 0
  }
  const command = args[0]
  if (command !== "status") {
    console.error(`未知子命令：${command}\n`)
    console.error(HELP)
    return 1
  }
  const dirFlag = args.indexOf("--dir")
  const cliDir = dirFlag >= 0 ? args[dirFlag + 1] : undefined
  return await runStatus(cliDir)
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
