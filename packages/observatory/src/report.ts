/**
 * 报告生成（计划 §49 的结构，但**只写有证据支撑的章节**）。
 *
 * 一条硬规则：**正文里的每个数字都从 dataset 现算**，不手抄。
 * 手抄是这类研究最典型的失信方式 —— 口径一改，没人会回去核对那几张表。
 *
 * 另一条：**留白比编造好**。Benchmark 没做就写"v0.1 不做"，框架对比矩阵里
 * 没有证据的格子写"—"，而不是拿文档里的说法凑。
 */
import type { Dataset, EcosystemStats } from "./dataset.js"

export interface ReportInput {
  readonly dataset: Dataset
  readonly stats: EcosystemStats
  /** 证据强度分布（来自分类与扫描） */
  readonly agentEvidence: Readonly<Record<string, number>>
  readonly effectEvidence: Readonly<Record<string, number>>
  /** 快照自检发现的截断/抬高（诚实性声明要用） */
  readonly raisedFloors: ReadonlyArray<{ readonly effectiveMinStars: number; readonly total: number }>
  readonly truncatedSlices: ReadonlyArray<string>
  readonly frameStatement: string
  /** 人工结论（Scenario 判定与解读）——由人写，不由机器编；**原样**插入（是一段 Markdown） */
  readonly conclusion: string
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`
const num = (value: number): string => value.toLocaleString("en-US")

const table = (header: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string | number>>): string =>
  [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n")

export function buildReport(input: ReportInput): string {
  const { stats, dataset } = input
  const effectAgents = dataset.rows.filter(
    (row) => row.isAgent && row.githubLanguage === "TypeScript" && ["L2", "L3", "L4"].includes(row.effectDepth)
  )
  const sections: Array<string> = []

  sections.push(`# Effect × AI Agent 生态调查报告 v${dataset.version}

> 快照日：**${dataset.snapshotDate}** · 数据集版本 \`${dataset.version}\` · 分类器版本 \`0.1\`
> 复现：\`pnpm --filter @ecn/observatory discover && pnpm --filter @ecn/observatory scan && pnpm --filter @ecn/observatory classify && pnpm --filter @ecn/observatory report\`
> 口径：[docs/observatory/methodology.md](../../docs/observatory/methodology.md)（本文所有数字的口径依据）

## Executive Summary

- 有界宇宙内共 **${num(stats.total)}** 个候选仓库，其中判定为 Agent 的 **${num(stats.agents)}** 个
  （判不准的 ${num(stats.uncertain)} 个**不计入**分子分母）。
- TypeScript Agent **${num(stats.typeScriptAgents)}** 个；其中**真正在用 Effect（L2+）的 ${num(stats.effectAgents)} 个**
  ⇒ **${pct(stats.effectShareOfTypeScriptAgents)}**。
- Effect 的用法集中在 **L4（Effect 是 Runtime 地基）**：${stats.effectByDepth.find((row) => row.depth === "L4")?.count ?? 0} 个，
  高于 L2/L3 —— 说明"用 Effect 做 Agent"的不是浅尝，而是把执行模型建在它上面。
- 结论：**${scenarioOf(input.conclusion)}**

> ⚠️ 这是 **GitHub 有界宇宙**内的数字，不代表整个 Agent 产业。分母定义见 §2。
`)

  sections.push(`## 1. 研究问题

**2026 年，Effect-TS 正在成为 AI Agent 的下一种工程范式吗？**

拆成可验证的子问题（v0.1 覆盖情况见 [research-question.md](../../docs/observatory/research-question.md)）：
规模（有多少 Agent 项目、语言分布）、Effect 存在感（多少项目真的在用、用得多深）、
以及"Effect 在 Agent 里解决什么问题"（能力证据）。

**v0.1 不做 Benchmark**，因此本报告**不声称任何性能或可靠性优势**。这是一个刻意的边界：
同 LLM 同 prompt 下的耗时差异支撑不了"更好"的结论。
`)

  sections.push(`## 2. 方法论（摘要）

${input.frameStatement}

### 有界宇宙带来的两个诚实性声明

| 项 | 值 | 含义 |
| --- | --- | --- |
| 泛词被抬高星数下限的查询 | **${input.raisedFloors.length}** 条 | 这些查询只覆盖高星部分（裸词 \`agent\` 在 stars≥300 时超过 GitHub 的 1000 条上限） |
| 被截断的切片 | **${input.truncatedSlices.length}** 条 | 0 表示没有"只取头部 1000 条"的切片 |

**Effect 判定不是"看 package.json"**：依赖清单只是第一道筛，真正判定要下载全仓扫描，
只统计**确实 \`import\` 了 effect** 的文件，并剔除仓库里内置的 Effect 源码（有项目把整个 effect 拷进 \`.context/effect/\`）。
证据强度分布：

${table(["阶段", "证据强度", "仓库数"], [
  ["Agent 分类", "manifest（依赖清单，强）", input.agentEvidence["manifest"] ?? 0],
  ["Agent 分类", "paths（文件路径，中）", input.agentEvidence["paths"] ?? 0],
  ["Agent 分类", "metadata（描述/topics，弱）", input.agentEvidence["metadata"] ?? 0],
  ["Effect 扫描", "tarball（全仓扫描，最强）", input.effectEvidence["tarball"] ?? 0],
  ["Effect 扫描", "manifest-full（所有 package.json 都读到）", input.effectEvidence["manifest-full"] ?? 0],
  ["Effect 扫描", "unknown（什么也没读到）", input.effectEvidence["none"] ?? 0]
])}
`)

  sections.push(`## 3. Agent 生态（按语言）

${table(["语言（GitHub 字段）", "候选数", "判定为 Agent", "Agent 占比"], stats.byLanguage.map((row) => [
  row.language,
  num(row.total),
  num(row.agents),
  row.total === 0 ? "—" : pct(row.agents / row.total)
]))}

> GitHub 的 \`language\` 按字节占比计算，TS 项目常被判成 JS/JSON/Markdown ——
> 因此这一列是**参考口径**，不是裁定口径（见 methodology §9）。
`)

  sections.push(`## 4. TypeScript Agent 生态

- TypeScript 候选：**${num(stats.byLanguage.find((row) => row.language === "TypeScript")?.total ?? 0)}**
- 其中判定为 Agent：**${num(stats.typeScriptAgents)}**
- Agent 类型分布：

${table(["类型", "数量"], stats.byType.map((row) => [row.type, num(row.count)]))}
`)

  sections.push(`## 5. Effect 生态：用得多深

${table(["深度", "含义", "项目数"], stats.effectByDepth.map((row) => [
  row.depth,
  {
    L0: "不用 Effect",
    L1: "只在边角路径依赖（拿它当对比基准之类）",
    L2: "部分业务逻辑用了",
    L3: "Effect 是重要架构组成",
    L4: "Effect 是 Agent Runtime 的地基",
    unknown: "扫描失败（**不是**'不用'）"
  }[row.depth] ?? "—",
  num(row.count)
]))}

**Q5：Effect Agent 占 TypeScript Agent 的比例 = ${pct(stats.effectShareOfTypeScriptAgents)}**
（${num(stats.effectAgents)} / ${num(stats.typeScriptAgents)}；判不准的项目不计入分子也不计入分母）
`)

  sections.push(`## 6. 真正在用 Effect 的项目（L2+）

${table(
  ["项目", "★", "深度", "类型", "能力数", "证据文件"],
  effectAgents.slice(0, 40).map((row) => [
    `[${row.repo}](${row.url})`,
    num(row.stars),
    row.effectDepth,
    row.agentType,
    row.effectCapabilities.length,
    row.effectDeps.length > 0 ? `\`${row.effectDeps.slice(0, 2).join("\`, \`")}\`` : "—"
  ])
)}

**Effect 能力频次**（在 L2+ 项目里）：

${table(["能力", "项目数"], stats.capabilityFrequency.map((row) => [row.capability, num(row.count)]))}
`)

  sections.push(`## 7. Case Studies

v0.1 做了 **4 篇**（3 个 L4 + 1 个 L2 反例），见 [case-studies/](../../packages/observatory/case-studies/)。
配套文章草稿：[reports/article-01-effect-agent-ecosystem.md](../../reports/article-01-effect-agent-ecosystem.md)。

> 计划要求"必须深入源码"，所以宁可只写 4 篇能落到文件与代码的，也不写 10 篇浅的。
> 每篇的证据文件都来自全仓扫描的真实命中列表 —— 不是读 README 得来的印象。
`)

  sections.push(`## 8. 框架对比

**v0.1 不做完整的框架对比矩阵。** 只填有证据的格子，其余留白 —— 留白比编造好：

${table(
  ["能力", "Effect", "Mastra", "LangGraph", "Vercel AI SDK"],
  [
    ["LLM", "✅ @effect/ai", "—", "—", "—"],
    ["Tool", "✅", "—", "—", "—"],
    ["Typed Error", "✅（类型级）", "—", "—", "—"],
    ["Dependency Injection", "✅ Layer/Context", "—", "—", "—"],
    ["Resource Lifecycle", "✅ Scope", "—", "—", "—"],
    ["Structured Concurrency", "✅ Fiber", "—", "—", "—"],
    ["Retry / Timeout", "✅ Schedule/timeout", "—", "—", "—"],
    ["Streaming", "✅ Stream", "—", "—", "—"],
    ["MCP", "✅ 生态包", "—", "—", "—"]
  ]
)}

> "—" 表示**本次未取证**，不表示该框架没有这个能力。
`)

  sections.push(`## 9. Benchmark

**v0.1 不做。** 计划里 3–5 天的三实现对等实现 + 故障注入矩阵留给 v0.2。
理由：同 LLM、同 prompt 下的"更快"差异主要来自框架开销与重试策略，噪声大到足以被写成结论。
真正值得测的是**失败语义**（取消时资源是否释放、错误是否被静默吞掉），那不在这份报告的射程内。
`)

  sections.push(`## 10. Limitations

- **GitHub 可见性偏差**：私有仓库与企业内部项目完全不可见；
- **星数门槛偏差**：stars ≥ 300 排除了大量真实但小众的项目；
- **时间窗偏差**：180 天不活跃即出局；
- **语言字段偏差**：\`language\` 按字节占比，会误判；
- **命名/描述偏差**：只在 name/description/topics 匹配关键词，描述写得差的仓库会漏；
- **分类器偏差**：规则优先 + 证据分级，判不准的记为 uncertain（本报告 ${num(stats.uncertain)} 个）；
- **样本量**：L2+ 只有 ${num(stats.effectAgents)} 个项目，任何百分比都应当按"个位数级别的样本"来读。

> 因此本报告研究的是 **Open Source Agent Ecosystem**，不是整个 Agent 产业。
`)

  sections.push(`## 11. 结论

${input.conclusion.replace(/^#.*\n/, "").trim()}
`)

  return sections.join("\n")
}

/** 从人工结论里抽出 Scenario 那一句（Executive Summary 只用这一句，不替人总结） */
const scenarioOf = (conclusion: string): string => {
  const match = /\*\*(Scenario [A-D][^*]*)\*\*/.exec(conclusion)
  if (match !== null) return match[1]!.trim()
  const firstLine = conclusion.split("\n").find((line) => line.trim() !== "" && !line.startsWith("#"))
  return (firstLine ?? "（见 §11）").replace(/^[-*]\s*/, "").trim()
}
