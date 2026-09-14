/**
 * 图表生成（计划 §48）与**人工审核抽样表**（计划 §7/§43）。
 *
 * 两件事放在一个模块里，因为它们的共同点是"把 dataset 变成人能看到的东西"：
 * 图表给人看结论，抽样表给人做判断。
 *
 * 图是**手写 SVG**（不引依赖）：这些图只承载五六个数字，
 * 为它们拉一个图表库进仓库不划算；而且 SVG 可以直接嵌进 Markdown。
 */
import type { Dataset, EcosystemStats } from "./dataset.js"

const ESCAPE = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export interface BarChartInput {
  readonly title: string
  readonly subtitle?: string
  readonly bars: ReadonlyArray<{ readonly label: string; readonly value: number; readonly note?: string }>
  /** 值格式化（默认千分位） */
  readonly format?: (value: number) => string
  readonly width?: number
}

/** 横向条形图（比饼图好读，也不会有排序歧义） */
export function barChartSvg(input: BarChartInput): string {
  const width = input.width ?? 720
  const rowHeight = 34
  const padding = { top: 56, right: 96, bottom: 16, left: 210 }
  const height = padding.top + padding.bottom + input.bars.length * rowHeight
  const max = Math.max(1, ...input.bars.map((bar) => bar.value))
  const plotWidth = width - padding.left - padding.right
  const format = input.format ?? ((value: number) => value.toLocaleString("en-US"))

  const rows = input.bars
    .map((bar, index) => {
      const y = padding.top + index * rowHeight
      const barWidth = Math.max(1, Math.round((bar.value / max) * plotWidth))
      return [
        `<text x="${padding.left - 12}" y="${y + 18}" text-anchor="end" class="label">${ESCAPE(bar.label)}</text>`,
        `<rect x="${padding.left}" y="${y + 4}" width="${barWidth}" height="20" rx="3" class="bar" />`,
        `<text x="${padding.left + barWidth + 8}" y="${y + 19}" class="value">${ESCAPE(format(bar.value))}${
          bar.note !== undefined ? ` <tspan class="note">${ESCAPE(bar.note)}</tspan>` : ""
        }</text>`
      ].join("")
    })
    .join("\n  ")

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${ESCAPE(input.title)}">
  <style>
    .title { font: 600 16px ui-sans-serif, system-ui, sans-serif; fill: currentColor; }
    .subtitle { font: 12px ui-sans-serif, system-ui, sans-serif; fill: #71717a; }
    .label { font: 13px ui-sans-serif, system-ui, sans-serif; fill: currentColor; }
    .value { font: 600 13px ui-monospace, monospace; fill: currentColor; }
    .note { font: 11px ui-sans-serif, system-ui, sans-serif; fill: #71717a; }
    .bar { fill: #6e56cf; }
  </style>
  <text x="16" y="26" class="title">${ESCAPE(input.title)}</text>
  ${input.subtitle !== undefined ? `<text x="16" y="44" class="subtitle">${ESCAPE(input.subtitle)}</text>` : ""}
  ${rows}
</svg>
`
}

export interface ChartSet {
  readonly [name: string]: string
}

/** 计划 §48 里 v0.1 能画的那几张（其余需要 v0.2 的数据，宁可没有） */
export function buildCharts(dataset: Dataset, stats: EcosystemStats): ChartSet {
  const ts = dataset.rows.filter((row) => row.githubLanguage === "TypeScript")
  const tsAgents = ts.filter((row) => row.isAgent)

  return {
    "01-agent-projects-by-language.svg": barChartSvg({
      title: "Agent 项目按语言分布（有界宇宙内）",
      subtitle: `stars ≥ 300 且 180 天内有 push · 共 ${stats.total} 个候选、${stats.agents} 个判定为 Agent`,
      bars: stats.byLanguage.map((row) => ({
        label: row.language,
        value: row.total,
        note: `其中 Agent ${row.agents}`
      }))
    }),
    "02-typescript-agent-verdict.svg": barChartSvg({
      title: "TypeScript 候选的判定构成",
      subtitle: "判不准的不计入分子分母（见 methodology §7）",
      bars: [
        { label: "判定为 Agent", value: tsAgents.length },
        { label: "判不准（uncertain）", value: ts.filter((row) => row.agentVerdict === "uncertain").length },
        { label: "判定为非 Agent", value: ts.filter((row) => row.agentVerdict === "not-agent").length }
      ]
    }),
    "03-effect-depth.svg": barChartSvg({
      title: "Effect 使用深度（TypeScript Agent 内）",
      subtitle: "L2+ 才算「真正在用」；L4 = Effect 是 Agent Runtime 的地基",
      bars: stats.effectByDepth.map((row) => ({
        label: row.depth,
        value: row.count,
        note:
          {
            L0: "不用",
            L1: "边角路径",
            L2: "部分业务逻辑",
            L3: "重要架构组成",
            L4: "Runtime 地基",
            unknown: "扫描失败（不是「不用」）"
          }[row.depth] ?? ""
      }))
    }),
    "04-effect-capabilities.svg": barChartSvg({
      title: "Effect Agent 用到了哪些能力（33 个项目，可多选）",
      subtitle: "最常用的不是 @effect/ai —— 而是运行时能力",
      bars: stats.capabilityFrequency.slice(0, 12).map((row) => ({ label: row.capability, value: row.count }))
    }),
    "05-effect-agent-stars.svg": barChartSvg({
      title: "Effect Agent（L2+）的 star 分布",
      subtitle: `中位数 ${stats.starsMedianAgents.toLocaleString("en-US")}（全体候选中位数 ${stats.starsMedianAll.toLocaleString("en-US")}）`,
      bars: dataset.rows
        .filter((row) => row.isAgent && row.githubLanguage === "TypeScript" && ["L2", "L3", "L4"].includes(row.effectDepth))
        .slice(0, 15)
        .map((row) => ({ label: row.repo.split("/")[1] ?? row.repo, value: row.stars, note: row.effectDepth }))
    })
  }
}

// ── 人工审核抽样（计划 §7 / §43）─────────────────────────────────────────────

export interface ReviewSampleEntry {
  readonly repo: string
  readonly url: string
  readonly language: string
  readonly stars: number
  readonly agentVerdict: string
  readonly agentType: string
  readonly confidence: number
  readonly evidenceTier: string
  readonly effectDepth: string
  /** 机器给出的理由（人要在这一列打勾或推翻） */
  readonly machineEvidence: ReadonlyArray<string>
  readonly description: string
}

export interface ReviewSample {
  readonly target: number
  readonly strata: ReadonlyArray<{ readonly stratum: string; readonly population: number; readonly sampled: number }>
  readonly entries: ReadonlyArray<ReviewSampleEntry>
}

/** 确定性伪随机（不与 crypto 绑定）：同一份数据每次抽到同一批，抽样可复现 */
const hash32 = (text: string): number => {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * 分层抽样（语言 × 判定），每层按目标比例抽。
 *
 * 为什么分层而不是纯随机：`uncertain` 是我们最需要人看的那一层，
 * 纯随机抽 120 个里可能只有十几个 uncertain —— 而它占了近一半的池子。
 */
export function drawReviewSample(dataset: Dataset, target = 120): ReviewSample {
  const strata = new Map<string, Array<Dataset["rows"][number]>>()
  for (const row of dataset.rows) {
    const key = `${row.githubLanguage === "" ? "(未知)" : row.githubLanguage} × ${row.agentVerdict}`
    const list = strata.get(key) ?? []
    list.push(row)
    strata.set(key, list)
  }

  const total = dataset.rows.length
  const entries: Array<ReviewSampleEntry> = []
  const strataSummary: Array<{ stratum: string; population: number; sampled: number }> = []

  for (const [stratum, rows] of [...strata.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const quota = Math.max(1, Math.round((rows.length / total) * target))
    // 确定性排序后取前 quota 个（用 repo 的 hash 排序 ⇒ 与 star 无关，避免只抽到大项目）
    const picked = [...rows].sort((a, b) => hash32(a.repo) - hash32(b.repo)).slice(0, Math.min(quota, rows.length))
    strataSummary.push({ stratum, population: rows.length, sampled: picked.length })
    for (const row of picked) {
      entries.push({
        repo: row.repo,
        url: row.url,
        language: row.githubLanguage,
        stars: row.stars,
        agentVerdict: row.agentVerdict,
        agentType: row.agentType,
        confidence: row.agentConfidence,
        evidenceTier: row.agentEvidenceTier,
        effectDepth: row.effectDepth,
        machineEvidence: row.via.slice(0, 2),
        description: row.description
      })
    }
  }

  return { target, strata: strataSummary, entries }
}

/** 抽样表（Markdown）：人只要在最后一列填 ✅/❌ 就能算精确率 */
export function renderReviewSheet(sample: ReviewSample, snapshotDate: string): string {
  const rows = sample.entries
    .map((entry, index) =>
      [
        index + 1,
        `[${entry.repo}](${entry.url})`,
        entry.language || "—",
        entry.stars,
        entry.agentVerdict,
        entry.agentType,
        entry.confidence.toFixed(2),
        entry.evidenceTier,
        entry.effectDepth,
        (entry.description || "—").slice(0, 60).replace(/\|/g, "\\|"),
        "" // 人工判定列
      ].join(" | ")
    )
    .map((line) => `| ${line} |`)
    .join("\n")

  const strata = sample.strata
    .map((row) => `| ${row.stratum} | ${row.population} | ${row.sampled} |`)
    .join("\n")

  return `# 人工审核抽样表（快照 ${snapshotDate}）

> 抽样是**确定性**的（按 repo 名的 hash 排序，与 star 无关），所以同一份 dataset 每次抽到同一批；
> 别人可以用同样的命令复现这张表。
>
> 分母口径见 [methodology §7](../../docs/observatory/methodology.md)：置信度 ≥ 0.70 才自动判定，
> 低于这条线的记为 \`uncertain\` 且**不计入**统计。这张表要回答的是：
> **自动判定那部分有多准**（精确率），以及**uncertain 里有多少其实是能判的**（召回缺口）。

## 怎么填

最后一列填 **✅（同意）** 或 **❌（不同意）**；不同意的请在 Issue 里说明理由并附一个文件路径作为证据。
填完用下面的公式算，写进 \`docs/observatory/classification.md\`：

\`\`\`
精确率 = ✅ 数 / 已填的"判定为 agent"行数
假阳性 = ❌ 中"机器说 agent、人说不是"的条数
召回缺口 = uncertain 行里人判为 agent 的条数 / uncertain 行数
\`\`\`

**注意**：给区间，不要只给点估计（120 条的样本，95% 置信区间大致 ±9 个百分点）。

## 抽样分层

| 层（语言 × 机器判定） | 总体 | 抽中 |
| --- | ---: | ---: |
${strata}

合计抽样 **${sample.entries.length}** 条（目标 ${sample.target}）。

## 待审条目

| # | 仓库 | 语言 | ★ | 机器判定 | 类型 | 置信度 | 证据强度 | Effect | 描述 | 人工判定 |
| ---: | --- | --- | ---: | --- | --- | ---: | --- | --- | --- | :---: |
${rows}
`
}
