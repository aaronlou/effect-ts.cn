/**
 * 内容管线 CLI（Phase 0）
 *
 *   ecn-content status   [--dir <译文目录>]        译文同步状态摘要
 *   ecn-content snapshot --dir <上游docs目录> -o <out.json>  固化上游快照
 *   ecn-content diff    --snapshot <snapshot.json> --docs <译文目录> [--out <report>]
 *
 * 用途：
 *   - status：译者自查（各版本/状态/孤儿译文）
 *   - snapshot + diff：本地/CI 判定哪些译文落后于上游（stale）
 *   - diff --out：输出 stale 清单供 GitHub Actions 打 issue
 */
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { scanDocsDir, summarize } from "./status.js"
import { buildSnapshot, writeSnapshot } from "./snapshot.js"
import { diffTranslations, loadSnapshot } from "./diff.js"
import { generateNav, writeNav } from "./nav.js"
import { checkDocs, loadGlossary, loadNav } from "./check.js"
import { buildCorpus } from "./corpus.js"

const HELP = `用法：
  ecn-content status   [--dir <译文目录>]
  ecn-content snapshot --dir <上游docs目录> -o <out.json>
  ecn-content diff    --snapshot <snapshot.json> --docs <译文目录> [--out <report.json>]
  ecn-content nav     --dir <上游docs目录> -o <nav.json>
  ecn-content check   [--docs <译文目录>] [--nav <nav.json>] [--glossary <glossary.json>]
  ecn-content corpus  [--docs <译文目录>] [--nav <nav.json>] [--html <站点构建产物>] [-o <corpus.json>]
`

function parseFlag(args: ReadonlyArray<string>, flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

/** 默认译文目录：仓库内 apps/site/src/content/docs */
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
  return candidates[0]!
}

/** 仓库内文件（nav/glossary 等）的定位：兼容从仓库根或包目录运行 */
function resolveRepoFile(relative: string): string {
  const candidates = [
    path.resolve(process.cwd(), relative),
    path.resolve(process.cwd(), "..", "..", relative),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", relative)
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]!
}

/** 生成产物的落盘路径：优先当前目录（存在父目录时），否则回到仓库根 */
function resolveRepoWritePath(relative: string): string {
  const fromCwd = path.resolve(process.cwd(), relative)
  if (existsSync(path.dirname(fromCwd))) return fromCwd
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", relative)
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
  for (const status of order) {
    console.log(`${status.padEnd(12)} ${String(summary.byStatus[status]).padStart(4)}`)
  }
  console.log("")
  console.log(`按版本：${JSON.stringify(summary.byVersion)}`)
  console.log(
    `合计 ${summary.total} 篇；孤儿译文（缺 upstreamPath/upstreamCommit）${summary.orphaned} 篇`
  )
  if (summary.published.length > 0) {
    console.log("\n── 已发布译文 ──")
    for (const entry of summary.published) {
      console.log(`  [${entry.version}] ${entry.file}  @${(entry.upstreamCommit ?? "?").slice(0, 7)}`)
    }
  }
  return 0
}

async function runSnapshot(snapshotDir: string, outFile: string): Promise<number> {
  const snapshot = await buildSnapshot(snapshotDir)
  await writeSnapshot(snapshot, outFile)
  console.log(`快照已写入 ${outFile}（${snapshot.fileCount} 个上游内容文件，HEAD=${snapshot.top ?? "?"}）`)
  return 0
}

async function runDiff(snapshotPath: string, docsDir: string, out?: string): Promise<number> {
  const snapshot = await loadSnapshot(snapshotPath)
  const report = await diffTranslations(docsDir, snapshot)

  console.log(`上游快照共 ${snapshot.fileCount} 个内容文件`)
  console.log(`本地译文 ${report.localTotal} 篇；可判定 ${report.checked} 篇；同步 ${report.okCount} 篇；`)
  if (report.stale.length === 0) {
    console.log("没有落后于上游的译文 ✔")
  } else {
    console.log(`落后 ${report.stale.length} 篇：`)
    for (const item of report.stale) {
      const reason = item.reason === "commit-changed" ? "落后" : "上游已移动/删除"
      console.log(
        `  [${item.version}] ${item.localFile}  ${reason}  本地@${(item.localCommit ?? "-").slice(0, 7)} → 上游@${(item.upstreamCommit ?? "?").slice(0, 7)}`
      )
    }
  }

  if (out !== undefined) {
    await writeFile(out, JSON.stringify(report, null, 2), "utf8")
    console.log(`报告已写入 ${out}`)
    // 有落后时返回 1 供 CI 判定
    return report.stale.length > 0 ? 1 : 0
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

  switch (command) {
    case "status":
      return runStatus(parseFlag(args, "--dir"))
    case "snapshot": {
      const dir = parseFlag(args, "--dir")
      const out = parseFlag(args, "-o")
      if (dir === undefined || out === undefined) {
        console.error("snapshot 需要 --dir <上游目录> 与 -o <输出>")
        console.error(HELP)
        return 1
      }
      return runSnapshot(dir, out)
    }
    case "diff": {
      const snapshot = parseFlag(args, "--snapshot")
      const docs = parseFlag(args, "--docs") ?? resolveDocsDir(undefined)
      const out = parseFlag(args, "--out")
      if (snapshot === undefined) {
        console.error("diff 需要 --snapshot <snapshot.json>")
        console.error(HELP)
        return 1
      }
      return runDiff(snapshot, docs, out)
    }
    case "check": {
      const docsDir = parseFlag(args, "--docs") ?? resolveDocsDir(undefined)
      const navFile = parseFlag(args, "--nav") ?? resolveRepoFile("apps/site/src/data/docs-nav.json")
      const glossaryFile = parseFlag(args, "--glossary") ?? resolveRepoFile("docs/glossary.json")

      const nav = await loadNav(navFile)
      const glossary = await loadGlossary(glossaryFile)
      const result = await checkDocs({ docsDir, nav, glossary })

      console.log(`内容门禁：${docsDir}`)
      console.log(`  译文 ${result.total} 篇 · 错误 ${result.errors.length} · 警告 ${result.warnings.length}`)
      console.log(
        nav === undefined
          ? `  ⚠ 未找到导航清单（${navFile}）——跳过 upstreamPath 存在性校验`
          : `  导航清单：${navFile}`
      )
      if (result.errors.length > 0) {
        console.log("\n── 错误 ──")
        for (const issue of result.errors) console.log(`  ✗ ${issue.file}: ${issue.message}`)
      }
      if (result.warnings.length > 0) {
        console.log("\n── 警告（不阻断） ──")
        for (const issue of result.warnings) console.log(`  ⚠ ${issue.file}: ${issue.message}`)
      }
      if (result.errors.length === 0) {
        console.log("\n✔ 内容门禁通过")
      }
      return result.errors.length > 0 ? 1 : 0
    }
    case "corpus": {
      const docsDir = parseFlag(args, "--docs") ?? resolveDocsDir(undefined)
      const navFile = parseFlag(args, "--nav") ?? resolveRepoFile("apps/site/src/data/docs-nav.json")
      const htmlDir = parseFlag(args, "--html") ?? resolveRepoFile("apps/site/dist")
      const outFile = parseFlag(args, "-o") ?? resolveRepoWritePath("packages/knowledge/data/corpus.json")
      const corpus = await buildCorpus({ docsDir, navFile, htmlDir, outFile })
      const stats = corpus.stats
      console.log(
        `语料已写入 ${outFile}\n  页面 ${stats.pages} · 切片 ${stats.chunks} · 未翻译 ${stats.pendingPages} · 上游 ${stats.upstreamHead?.slice(0, 7) ?? "?"}`
      )
      return 0
    }
    case "nav": {
      const dir = parseFlag(args, "--dir")
      const out = parseFlag(args, "-o")
      if (dir === undefined || out === undefined) {
        console.error("nav 需要 --dir <上游docs目录> 与 -o <输出>")
        console.error(HELP)
        return 1
      }
      const nav = await generateNav(dir)
      await writeNav(nav, out)
      const stats = Object.entries(nav.versions)
        .map(([version, sections]) => {
          const items = sections.reduce((sum, section) => sum + section.items.length, 0)
          return `${version}: ${sections.length} 章节 / ${items} 条目`
        })
        .join("；")
      console.log(`导航已写入 ${out}（${stats}，HEAD=${nav.generatedFrom.head?.slice(0, 7) ?? "?"}）`)
      return 0
    }
    default:
      console.error(`未知子命令：${command}\n`)
      console.error(HELP)
      return 1
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
