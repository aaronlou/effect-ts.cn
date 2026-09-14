/**
 * Dataset 导出的纯逻辑测试。
 *
 * 重点在两处容易出错、又没人会去核对的地方：
 * 1. **CSV 转义** —— 仓库描述里带逗号/引号/换行是常态，转义错了整张表就错位；
 * 2. **比例的分母** —— "Effect Agent 占 TypeScript Agent 的比例"这个数字会被反复引用，
 *    分母写错（比如把 uncertain 也算进 agent）会让结论整体偏移。
 */
import { describe, expect, it } from "vitest"
import type { AgentClassification } from "../src/agent-classify.js"
import type { Candidate } from "../src/candidate.js"
import type { EffectScanEntry } from "../src/effect-scan.js"
import { buildDataset, buildTables, computeStats, csvCell, toCsv } from "../src/dataset.js"
import { splitCsv } from "./csv-helper.js"

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  repo: "acme/agent",
  owner: "acme",
  name: "agent",
  stars: 500,
  forks: 10,
  githubLanguage: "TypeScript",
  description: "an agent",
  topics: ["ai"],
  pushedAt: "2026-09-01T00:00:00Z",
  createdAt: "2025-01-01T00:00:00Z",
  archived: false,
  fork: false,
  license: "MIT",
  openIssues: 3,
  via: ["TypeScript:agent"],
  ...overrides
})

const classification = (overrides: Partial<AgentClassification> = {}): AgentClassification => ({
  repo: "acme/agent",
  isAgent: true,
  verdict: "agent",
  agentType: "single-agent",
  confidence: 0.9,
  evidenceTier: "manifest",
  evidence: ["manifest:openai"],
  hasLlm: true,
  hasAgentLoop: true,
  hasToolCalling: true,
  hasMcp: false,
  hasWorkflow: false,
  hasMultiAgent: false,
  hasMemory: false,
  hasStreaming: false,
  isThinWrapper: false,
  looksLikeTutorial: false,
  ...overrides
})

const effect = (overrides: Partial<EffectScanEntry> = {}): EffectScanEntry => ({
  repo: "acme/agent",
  stars: 500,
  language: "TypeScript",
  via: ["TypeScript:agent"],
  depth: "L3",
  evidenceLevel: "tarball",
  packageCount: 3,
  manifestFailures: 0,
  deps: ["effect"],
  runtimePackages: ["packages/core/package.json"],
  centrality: "core",
  ratio: 0.5,
  scannedFiles: 100,
  effectFiles: 20,
  evidence: ["src/agent/loop.ts"],
  capabilities: ["gen", "service", "error", "stream"],
  usesAi: false,
  ...overrides
})

describe("CSV 转义", () => {
  it("逗号 / 引号 / 换行都要加引号并转义", () => {
    expect(csvCell("a,b")).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"')
    expect(csvCell(42)).toBe("42")
    expect(csvCell(["a", "b"])).toBe("a|b")
  })

  it("表头与数据行的**列数一致**（列数错位是 CSV 最典型的静默错误）", () => {
    const dataset = buildDataset({
      snapshotDate: "2026-09-14",
      version: "0.1",
      // 刻意塞进逗号/引号/换行，验证转义之后列数仍然对齐
      candidates: [candidate({ description: 'an "agent", with commas\nand a newline' })],
      classifications: [classification()],
      effectScans: [effect()]
    })
    const csv = toCsv(dataset.rows)
    const header = csv.split("\n")[0]!
    const row = csv.slice(header.length + 1)
    expect(splitCsv(header).length).toBeGreaterThan(25)
    expect(splitCsv(row).length).toBe(splitCsv(header).length)
  })
})

describe("Dataset 组装", () => {
  it("把候选、分类、Effect 三份数据按 repo 合并", () => {
    const dataset = buildDataset({
      snapshotDate: "2026-09-14",
      version: "0.1",
      candidates: [candidate()],
      classifications: [classification()],
      effectScans: [effect()]
    })
    const row = dataset.rows[0]!
    expect(row.isAgent).toBe(true)
    expect(row.agentType).toBe("single-agent")
    expect(row.effectDepth).toBe("L3")
    expect(row.effectCapabilities).toContain("service")
  })

  it("缺扫描结果的仓库标 not-scanned，而不是假装 L0", () => {
    const dataset = buildDataset({
      snapshotDate: "2026-09-14",
      version: "0.1",
      candidates: [candidate({ repo: "python/x", githubLanguage: "Python" })],
      classifications: [classification({ repo: "python/x" })],
      effectScans: []
    })
    expect(dataset.rows[0]!.effectDepth).toBe("not-scanned")
    expect(dataset.rows[0]!.effectEvidence).toBe("not-scanned")
  })

  it("按 star 降序输出（同样的输入得到同样的产物）", () => {
    const dataset = buildDataset({
      snapshotDate: "2026-09-14",
      version: "0.1",
      candidates: [candidate({ repo: "a/low", owner: "a", name: "low", stars: 10 }), candidate({ repo: "b/high", owner: "b", name: "high", stars: 900 })],
      classifications: [],
      effectScans: []
    })
    expect(dataset.rows.map((row) => row.repo)).toEqual(["b/high", "a/low"])
  })
})

describe("四张 CSV（计划 §44）", () => {
  const dataset = buildDataset({
    snapshotDate: "2026-09-14",
    version: "0.1",
    candidates: [
      candidate({ repo: "ts/effect-agent", owner: "ts", name: "effect-agent" }),
      candidate({ repo: "py/agent", owner: "py", name: "agent", githubLanguage: "Python" }),
      candidate({ repo: "ts/plain", owner: "ts", name: "plain" })
    ],
    classifications: [
      classification({ repo: "ts/effect-agent" }),
      classification({ repo: "py/agent" }),
      classification({ repo: "ts/plain", isAgent: false, verdict: "not-agent", agentType: "llm-app" })
    ],
    effectScans: [effect({ repo: "ts/effect-agent" })]
  })

  it("agents / typeScriptAgents / effectAgents 三层集合是包含关系", () => {
    const tables = buildTables(dataset)
    const agentRows = tables.agents.split("\n").length - 1
    const tsRows = tables.typeScriptAgents.split("\n").length - 1
    const effectRows = tables.effectAgents.split("\n").length - 1
    expect(agentRows).toBe(2)
    expect(tsRows).toBe(1)
    expect(effectRows).toBe(1)
    expect(tables.effectAgents).toContain("ts/effect-agent")
  })
})

describe("生态统计（Q4/Q5 的来源）", () => {
  const dataset = buildDataset({
    snapshotDate: "2026-09-14",
    version: "0.1",
    candidates: [
      candidate({ repo: "ts/a", owner: "ts", name: "a" }),
      candidate({ repo: "ts/b", owner: "ts", name: "b" }),
      candidate({ repo: "ts/c", owner: "ts", name: "c" }),
      candidate({ repo: "py/d", owner: "py", name: "d", githubLanguage: "Python" })
    ],
    classifications: [
      classification({ repo: "ts/a" }),
      classification({ repo: "ts/b" }),
      // 判不准的**不算** agent（否则比例会虚高）
      classification({ repo: "ts/c", isAgent: false, verdict: "uncertain", agentType: "uncertain", confidence: 0.5 }),
      classification({ repo: "py/d" })
    ],
    effectScans: [
      effect({ repo: "ts/a", depth: "L4" }),
      effect({ repo: "ts/b", depth: "L0", deps: [], capabilities: [], effectFiles: 0 }),
      effect({ repo: "ts/c", depth: "L3" })
    ]
  })

  it("Effect Agent 占 TypeScript Agent 的比例，分母只算判定为 agent 且语言为 TS 的", () => {
    const stats = computeStats(dataset)
    expect(stats.typeScriptAgents).toBe(2) // ts/a 与 ts/b
    expect(stats.effectAgents).toBe(1) // 只有 ts/a（ts/c 是 uncertain，不进分母）
    expect(stats.effectShareOfTypeScriptAgents).toBe(0.5)
  })

  it("语言分布同时给总数与 agent 数", () => {
    const stats = computeStats(dataset)
    const ts = stats.byLanguage.find((row) => row.language === "TypeScript")!
    expect(ts.total).toBe(3)
    expect(ts.agents).toBe(2)
  })

  it("Effect 能力频次来自 L2+ 项目", () => {
    const stats = computeStats(dataset)
    expect(stats.capabilityFrequency.find((row) => row.capability === "service")?.count).toBe(1)
  })

  it("空数据集不炸", () => {
    const empty = buildDataset({ snapshotDate: "2026-09-14", version: "0.1", candidates: [], classifications: [], effectScans: [] })
    const stats = computeStats(empty)
    expect(stats.total).toBe(0)
    expect(stats.effectShareOfTypeScriptAgents).toBe(0)
  })
})
