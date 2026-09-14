/**
 * 候选与去重的纯逻辑测试（零网络）。
 *
 * 这一层是整条流水线的**判据侧**，错了会让报告里的每个数字都错，
 * 所以它必须能在没有 GitHub 配额、没有网络的环境里被完整验证 ——
 * 与生态榜"判据与网络分离"的取舍一致。
 */
import { describe, expect, it } from "vitest"
import { dedupe, formatBand, normalizeRepoName, starBands, type Candidate } from "../src/candidate.js"
import { buildQueries, buildSearchQuery, LANGUAGES, type QueryOptions } from "../src/queries.js"
import { summarize } from "../src/snapshot.js"
import type { DiscoveryResult } from "../src/discover.js"

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  repo: "acme/agent",
  owner: "acme",
  name: "agent",
  stars: 500,
  forks: 20,
  githubLanguage: "TypeScript",
  description: "an AI agent",
  topics: ["ai", "agent"],
  pushedAt: "2026-09-01T00:00:00Z",
  createdAt: "2025-01-01T00:00:00Z",
  archived: false,
  fork: false,
  license: "MIT",
  openIssues: 5,
  via: ["TypeScript:agent"],
  ...overrides
})

describe("去重（计划 §14：fork / archived / 重复 / 疑似同项目）", () => {
  it("同一 owner/name 被多条查询命中 ⇒ 合并 via，而不是当成两个项目", () => {
    const result = dedupe([
      candidate({ via: ["TypeScript:agent"] }),
      candidate({ via: ["TypeScript:mcp"], stars: 520 })
    ])
    expect(result.kept).toHaveLength(1)
    expect(result.merged).toBe(1)
    expect(result.kept[0]?.via).toEqual(["TypeScript:agent", "TypeScript:mcp"])
    // star 取较大值：并发快照下同一仓库可能略有差异
    expect(result.kept[0]?.stars).toBe(520)
  })

  it("fork 排除（fork 的 star 数会污染规模统计）", () => {
    const result = dedupe([candidate(), candidate({ repo: "other/agent", owner: "other", fork: true })])
    expect(result.kept.map((entry) => entry.repo)).toEqual(["acme/agent"])
    expect(result.droppedForks).toEqual(["other/agent"])
  })

  it("archived 排除出主集，但留在名单里（计划要求'除非有历史重要性'⇒ 得让人看得见）", () => {
    const result = dedupe([candidate({ repo: "dead/agent", owner: "dead", archived: true })])
    expect(result.kept).toHaveLength(0)
    expect(result.droppedArchived).toEqual(["dead/agent"])
  })

  it("同名不同 owner ⇒ **只标记不丢弃**（误丢真实项目比多留一条更贵）", () => {
    const result = dedupe([
      candidate({ repo: "acme/agent", owner: "acme" }),
      candidate({ repo: "globex/agent", owner: "globex" })
    ])
    expect(result.kept).toHaveLength(2)
    expect(result.possibleDuplicates).toEqual([["acme/agent", "globex/agent"]])
  })

  it("名字归一化：`agent`、`Agent.js`、`agent-ts` 会被看成同一组", () => {
    expect(normalizeRepoName("Agent.js")).toBe(normalizeRepoName("agent"))
    expect(normalizeRepoName("agent-ts")).toBe(normalizeRepoName("agent"))
    expect(normalizeRepoName("agentic")).not.toBe(normalizeRepoName("agent"))
  })

  it("按 star 降序输出，保证同一份输入得到同一份产物", () => {
    const result = dedupe([
      candidate({ repo: "a/x", owner: "a", name: "x", stars: 10 }),
      candidate({ repo: "b/y", owner: "b", name: "y", stars: 900 })
    ])
    expect(result.kept.map((entry) => entry.repo)).toEqual(["b/y", "a/x"])
  })
})

describe("星段切片（GitHub 每条 query 硬上限 1000）", () => {
  it("低位段窄、高位段几何增长（重尾分布的切法）", () => {
    const bands = starBands(300)
    expect(bands[0]).toEqual({ low: 300, high: 600 })
    expect(bands[1]).toEqual({ low: 600, high: 900 })
    expect(bands[2]).toEqual({ low: 900, high: 1200 })
    expect(bands[3]).toEqual({ low: 1200, high: 2400 })
  })

  it("**一定会终止**，且顶段无上界（回归：初版 doubling 会溢出成 1e308）", () => {
    const bands = starBands(300)
    expect(bands.length).toBeLessThan(20)
    const last = bands.at(-1)!
    expect(last.high).toBeUndefined()
    expect(last.low).toBeGreaterThan(300)
    // 段与段必须首尾相接，不能有洞
    for (let index = 1; index < bands.length; index += 1) {
      expect(bands[index]!.low).toBe(bands[index - 1]!.high)
    }
  })

  it("给定切片上界时到此为止：顶段无上界，但**必须覆盖整条尾巴**（不能留洞）", () => {
    const bands = starBands(300, 900)
    expect(bands).toEqual([{ low: 300, high: 600 }, { low: 600 }])
    // 覆盖性：最后一段是 >=600，包含 900 以上的一切
    expect(formatBand(bands.at(-1)!)).toBe("stars:>=600")
  })

})

describe("查询集（口径写在代码里）", () => {
  it("覆盖计划 §12.1 的 5 种语言", () => {
    expect([...LANGUAGES]).toEqual(["TypeScript", "Python", "Rust", "Go", "Java"])
  })

  it("语言 × (方向词 + 短语) 全展开，且每条都带 in:name,description,topics", () => {
    const queries = buildQueries(["TypeScript"], ["agent"], ['"AI agent"'])
    expect(queries).toHaveLength(2)
    const options: QueryOptions = { minStars: 300, pushedSince: "2026-03-18" }
    const query = buildSearchQuery(queries[0]!, options)
    expect(query).toContain("language:typescript")
    expect(query).toContain("stars:>=300")
    expect(query).toContain("pushed:>=2026-03-18")
    expect(query).toContain("in:name,description,topics")
    // 短语查询保持引号
    expect(buildSearchQuery(queries[1]!, options)).toContain('"AI agent"')
  })
})

describe("汇总（报告里的 Q1–Q3 就来自这里）", () => {
  const result = (candidates: ReadonlyArray<Candidate>): DiscoveryResult => ({
    frame: {
      snapshotDate: "2026-09-14",
      minStars: 300,
      pushedSince: "2026-03-18",
      languages: ["TypeScript"],
      keywordCount: 1,
      queryCount: 1,
      statement: "test"
    },
    candidates,
    dedupe: { kept: candidates, merged: 0, droppedForks: [], droppedArchived: [], possibleDuplicates: [] },
    calls: [],
    truncatedSlices: [],
    raisedFloors: [],
    api: { cacheHits: 0, networkCalls: 0, waits: 0 }
  })

  it("语言分布、中位数、活跃度都对得上", () => {
    const summary = summarize(
      result([
        candidate({ repo: "a/1", owner: "a", name: "1", stars: 100, githubLanguage: "TypeScript" }),
        candidate({ repo: "b/2", owner: "b", name: "2", stars: 300, githubLanguage: "Python" }),
        candidate({ repo: "c/3", owner: "c", name: "3", stars: 500, githubLanguage: "TypeScript" }),
        candidate({
          repo: "d/4",
          owner: "d",
          name: "4",
          stars: 700,
          githubLanguage: "TypeScript",
          pushedAt: "2020-01-01T00:00:00Z"
        })
      ]),
      new Date("2026-09-14T00:00:00Z")
    )
    expect(summary.totalCandidates).toBe(4)
    expect(summary.byGithubLanguage[0]).toEqual({ language: "TypeScript", count: 3 })
    expect(summary.typeScriptCandidates).toBe(3)
    expect(summary.stars.median).toBe(400)
    expect(summary.stars.max).toBe(700)
    expect(summary.active90d).toBe(3) // d/4 是 2020 年的
  })

  it("空池不炸（跑 --max-queries 1 时可能只命中很少）", () => {
    const summary = summarize(result([]))
    expect(summary.totalCandidates).toBe(0)
    expect(summary.stars.median).toBe(0)
    expect(summary.byGithubLanguage).toEqual([])
  })
})
