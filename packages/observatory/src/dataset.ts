/**
 * Dataset v0.1 导出（计划 §44）。
 *
 * 设计要点：**报告里的每个数字都从这份 dataset 现算**，而不是手抄。
 * 手抄数字是这类研究最典型的失信方式 —— 一旦某处口径改了，正文里没人再去核实那几张表。
 *
 * CSV 是自己拼的（不引依赖），所以必须自己处理引号/逗号/换行 —— 见 `csvCell`。
 */
import type { AgentClassification } from "./agent-classify.js"
import type { Candidate } from "./candidate.js"
import type { EffectScanEntry } from "./effect-scan.js"

export interface DatasetRow {
  // ── Repository（计划 §11）──
  readonly repo: string
  readonly owner: string
  readonly name: string
  readonly url: string
  readonly description: string
  readonly stars: number
  readonly forks: number
  readonly openIssues: number
  /** GitHub 的 language 字段（参考口径，已知按字节占比会误判 TS） */
  readonly githubLanguage: string
  readonly createdAt: string
  readonly pushedAt: string
  readonly license: string
  readonly topics: ReadonlyArray<string>
  /** 命中它的查询（可回溯） */
  readonly via: ReadonlyArray<string>
  // ── AgentClassification（计划 §11）──
  readonly isAgent: boolean
  readonly agentVerdict: AgentClassification["verdict"]
  readonly agentType: AgentClassification["agentType"]
  readonly agentConfidence: number
  readonly agentEvidenceTier: AgentClassification["evidenceTier"]
  readonly hasLlm: boolean
  readonly hasAgentLoop: boolean
  readonly hasToolCalling: boolean
  readonly hasMcp: boolean
  readonly hasWorkflow: boolean
  readonly hasMultiAgent: boolean
  readonly hasMemory: boolean
  readonly hasStreaming: boolean
  // ── EffectUsage（计划 §11；非 TS 语言为 unknown）──
  readonly effectDepth: EffectScanEntry["depth"] | "not-scanned"
  readonly effectEvidence: EffectScanEntry["evidenceLevel"] | "not-scanned"
  readonly effectDeps: ReadonlyArray<string>
  readonly effectCapabilities: ReadonlyArray<string>
  readonly usesAi: boolean
  readonly effectRatio: number
  readonly effectFiles: number
}

export interface Dataset {
  readonly version: string
  readonly snapshotDate: string
  readonly generatedAt: string
  readonly rows: ReadonlyArray<DatasetRow>
}

export function buildDataset(input: {
  readonly snapshotDate: string
  readonly version: string
  readonly candidates: ReadonlyArray<Candidate>
  readonly classifications: ReadonlyArray<AgentClassification>
  readonly effectScans: ReadonlyArray<EffectScanEntry>
}): Dataset {
  const byRepo = new Map(input.classifications.map((entry) => [entry.repo, entry]))
  const effectByRepo = new Map(input.effectScans.map((entry) => [entry.repo, entry]))

  const rows = input.candidates.map((candidate): DatasetRow => {
    const classification = byRepo.get(candidate.repo)
    const effect = effectByRepo.get(candidate.repo)
    return {
      repo: candidate.repo,
      owner: candidate.owner,
      name: candidate.name,
      url: `https://github.com/${candidate.repo}`,
      description: candidate.description ?? "",
      stars: candidate.stars,
      forks: candidate.forks,
      openIssues: candidate.openIssues,
      githubLanguage: candidate.githubLanguage ?? "",
      createdAt: candidate.createdAt,
      pushedAt: candidate.pushedAt,
      license: candidate.license ?? "",
      topics: candidate.topics,
      via: candidate.via,
      isAgent: classification?.isAgent ?? false,
      agentVerdict: classification?.verdict ?? "uncertain",
      agentType: classification?.agentType ?? "uncertain",
      agentConfidence: classification?.confidence ?? 0,
      agentEvidenceTier: classification?.evidenceTier ?? "none",
      hasLlm: classification?.hasLlm ?? false,
      hasAgentLoop: classification?.hasAgentLoop ?? false,
      hasToolCalling: classification?.hasToolCalling ?? false,
      hasMcp: classification?.hasMcp ?? false,
      hasWorkflow: classification?.hasWorkflow ?? false,
      hasMultiAgent: classification?.hasMultiAgent ?? false,
      hasMemory: classification?.hasMemory ?? false,
      hasStreaming: classification?.hasStreaming ?? false,
      effectDepth: effect?.depth ?? "not-scanned",
      effectEvidence: effect?.evidenceLevel ?? "not-scanned",
      effectDeps: effect?.deps ?? [],
      effectCapabilities: effect?.capabilities ?? [],
      usesAi: effect?.usesAi ?? false,
      effectRatio: effect?.ratio ?? 0,
      effectFiles: effect?.effectFiles ?? 0
    }
  })

  return {
    version: input.version,
    snapshotDate: input.snapshotDate,
    generatedAt: new Date().toISOString(),
    rows: rows.sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo))
  }
}

/** CSV 单元格：转义引号、必要时加引号（值里可能有逗号、引号、换行） */
export const csvCell = (value: string | number | boolean | ReadonlyArray<string>): string => {
  const text = Array.isArray(value) ? value.join("|") : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const COLUMNS: ReadonlyArray<{ readonly header: string; readonly value: (row: DatasetRow) => string | number | boolean | ReadonlyArray<string> }> = [
  { header: "repo", value: (r) => r.repo },
  { header: "url", value: (r) => r.url },
  { header: "stars", value: (r) => r.stars },
  { header: "forks", value: (r) => r.forks },
  { header: "open_issues", value: (r) => r.openIssues },
  { header: "github_language", value: (r) => r.githubLanguage },
  { header: "created_at", value: (r) => r.createdAt },
  { header: "pushed_at", value: (r) => r.pushedAt },
  { header: "license", value: (r) => r.license },
  { header: "topics", value: (r) => r.topics },
  { header: "via", value: (r) => r.via },
  { header: "description", value: (r) => r.description },
  { header: "is_agent", value: (r) => r.isAgent },
  { header: "agent_verdict", value: (r) => r.agentVerdict },
  { header: "agent_type", value: (r) => r.agentType },
  { header: "agent_confidence", value: (r) => r.agentConfidence },
  { header: "agent_evidence_tier", value: (r) => r.agentEvidenceTier },
  { header: "has_llm", value: (r) => r.hasLlm },
  { header: "has_agent_loop", value: (r) => r.hasAgentLoop },
  { header: "has_tool_calling", value: (r) => r.hasToolCalling },
  { header: "has_mcp", value: (r) => r.hasMcp },
  { header: "has_workflow", value: (r) => r.hasWorkflow },
  { header: "has_multi_agent", value: (r) => r.hasMultiAgent },
  { header: "has_memory", value: (r) => r.hasMemory },
  { header: "has_streaming", value: (r) => r.hasStreaming },
  { header: "effect_depth", value: (r) => r.effectDepth },
  { header: "effect_evidence", value: (r) => r.effectEvidence },
  { header: "effect_deps", value: (r) => r.effectDeps },
  { header: "effect_capabilities", value: (r) => r.effectCapabilities },
  { header: "uses_effect_ai", value: (r) => r.usesAi },
  { header: "effect_files", value: (r) => r.effectFiles }
]

export function toCsv(rows: ReadonlyArray<DatasetRow>): string {
  const header = COLUMNS.map((column) => column.header).join(",")
  const body = rows.map((row) => COLUMNS.map((column) => csvCell(column.value(row))).join(","))
  return [header, ...body].join("\n")
}

/** 计划 §44 的四张表 + dataset.json */
export function buildTables(dataset: Dataset): {
  readonly agents: string
  readonly typeScriptAgents: string
  readonly effectAgents: string
  readonly frameworks: string
} {
  const agents = dataset.rows.filter((row) => row.isAgent)
  const typeScriptAgents = agents.filter((row) => row.githubLanguage === "TypeScript")
  const effectAgents = typeScriptAgents.filter((row) => row.effectDepth === "L2" || row.effectDepth === "L3" || row.effectDepth === "L4")
  const frameworkRows = agents.filter((row) => row.agentType === "agent-framework")
  return {
    agents: toCsv(agents),
    typeScriptAgents: toCsv(typeScriptAgents),
    effectAgents: toCsv(effectAgents),
    frameworks: toCsv(frameworkRows)
  }
}

export interface EcosystemStats {
  readonly total: number
  readonly agents: number
  readonly uncertain: number
  readonly notAgent: number
  readonly byLanguage: ReadonlyArray<{ readonly language: string; readonly total: number; readonly agents: number }>
  readonly byType: ReadonlyArray<{ readonly type: string; readonly count: number }>
  readonly typeScriptAgents: number
  readonly effectAgents: number
  /** Q5：Effect Agent 占 TypeScript Agent 的比例 */
  readonly effectShareOfTypeScriptAgents: number
  readonly effectByDepth: ReadonlyArray<{ readonly depth: string; readonly count: number }>
  readonly capabilityFrequency: ReadonlyArray<{ readonly capability: string; readonly count: number }>
  readonly starsMedianAgents: number
  readonly starsMedianAll: number
}

const median = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle]!
}

export function computeStats(dataset: Dataset): EcosystemStats {
  const rows = dataset.rows
  const agents = rows.filter((row) => row.isAgent)

  const languages = new Map<string, { total: number; agents: number }>()
  for (const row of rows) {
    const key = row.githubLanguage === "" ? "(未知)" : row.githubLanguage
    const bucket = languages.get(key) ?? { total: 0, agents: 0 }
    bucket.total += 1
    if (row.isAgent) bucket.agents += 1
    languages.set(key, bucket)
  }

  const typeCounts = new Map<string, number>()
  for (const row of agents) typeCounts.set(row.agentType, (typeCounts.get(row.agentType) ?? 0) + 1)

  const typeScriptAgents = agents.filter((row) => row.githubLanguage === "TypeScript")
  const effectAgents = typeScriptAgents.filter((row) => ["L2", "L3", "L4"].includes(row.effectDepth))

  const depthCounts = new Map<string, number>()
  for (const row of typeScriptAgents) depthCounts.set(row.effectDepth, (depthCounts.get(row.effectDepth) ?? 0) + 1)

  const capabilityCounts = new Map<string, number>()
  for (const row of effectAgents) {
    for (const capability of row.effectCapabilities) {
      capabilityCounts.set(capability, (capabilityCounts.get(capability) ?? 0) + 1)
    }
  }

  return {
    total: rows.length,
    agents: agents.length,
    uncertain: rows.filter((row) => row.agentVerdict === "uncertain").length,
    notAgent: rows.filter((row) => row.agentVerdict === "not-agent").length,
    byLanguage: [...languages.entries()]
      .map(([language, value]) => ({ language, total: value.total, agents: value.agents }))
      .sort((a, b) => b.total - a.total),
    byType: [...typeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    typeScriptAgents: typeScriptAgents.length,
    effectAgents: effectAgents.length,
    effectShareOfTypeScriptAgents:
      typeScriptAgents.length === 0 ? 0 : Number((effectAgents.length / typeScriptAgents.length).toFixed(4)),
    effectByDepth: [...depthCounts.entries()]
      .map(([depth, count]) => ({ depth, count }))
      .sort((a, b) => a.depth.localeCompare(b.depth)),
    capabilityFrequency: [...capabilityCounts.entries()]
      .map(([capability, count]) => ({ capability, count }))
      .sort((a, b) => b.count - a.count),
    starsMedianAgents: median(agents.map((row) => row.stars)),
    starsMedianAll: median(rows.map((row) => row.stars))
  }
}
