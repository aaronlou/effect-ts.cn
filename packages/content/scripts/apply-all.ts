/**
 * 维护者批量落地工具：把 `.proposals/` 里的**全部**提案落地到译文目录，
 * 并把 frontmatter 归一为仓库惯例（`status: published`、`reviewers: [ecn-review]`）。
 *
 * 用法（必须显式确认）：
 *   pnpm --filter @ecn/content exec tsx scripts/apply-all.ts --yes
 *
 * ⚠️ 治理说明：
 * - 单条落地请用 `proposals:apply <id>`（一次一条，便于逐条审阅）；
 *   这个脚本是**维护者**在"整批已过机械门禁、同意一次性落地"时的批量动作。
 * - `reviewers: [ecn-review]` 表示"**机器可复核的自动化审校**"（代码块与上游逐字节一致、
 *   标题/组件/链接结构对齐、术语门禁 0 命中、引用锚点可达），**不等于人类精读**。
 *   维护者精读抽查后，请把自己的名字**追加**进 reviewers。
 * - 落地后建议立刻跑：`pnpm content:check && pnpm build && pnpm corpus:build && pnpm build`
 *   以及 `proposals:prune --write`（把已落地的提案出队）。
 */
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { applyProposal, loadProposalContext, loadProposals } from "../src/proposals.js"

if (!process.argv.includes("--yes")) {
  console.error("这个命令会一次性落地全部提案。确认请加 --yes")
  process.exit(1)
}

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "../../..")
const docsDir = path.join(repoRoot, "apps/site/src/content/docs")
const proposalsDir = path.join(repoRoot, ".proposals")

const context = await loadProposalContext({
  navFile: path.join(repoRoot, "apps/site/src/data/docs-nav.json"),
  glossaryFile: path.join(repoRoot, "docs/glossary.json"),
  docsDir
})
const result = await loadProposals(proposalsDir, context)
if (result.errors.length > 0) {
  console.error(`提案队列有 ${result.errors.length} 个错误，先修好再落地：`)
  for (const issue of result.errors.slice(0, 10)) console.error(`  ✗ ${issue.message}`)
  process.exit(1)
}
if (result.proposals.length === 0) {
  console.log("提案队列为空，无需落地 ✔")
  process.exit(0)
}

/** frontmatter 归一：status → published；reviewers → [ecn-review]（保留其它字段） */
const normalize = (raw: string): string => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw)
  if (match === null) return raw
  let head = match[1]
  head = /^status:\s*.*$/m.test(head)
    ? head.replace(/^status:\s*.*$/m, "status: published")
    : `${head}\nstatus: published`
  head = /^reviewers:\s*.*$/m.test(head)
    ? head.replace(/^reviewers:\s*.*$/m, "reviewers: [ecn-review]")
    : `${head}\nreviewers: [ecn-review]`
  return raw.replace(match[0], `---\n${head}\n---\n`)
}

let applied = 0
for (const proposal of result.proposals) {
  const target = await applyProposal(proposal, { docsDir, force: true })
  await writeFile(target, normalize(await readFile(target, "utf8")), "utf8")
  applied += 1
  if (applied % 25 === 0) console.log(`  已落地 ${applied}/${result.proposals.length}`)
}
console.log(`✅ 落地 ${applied} 篇（status → published，reviewers → [ecn-review]）`)
