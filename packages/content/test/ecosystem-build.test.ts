import { describe, expect, it } from "vitest"
import { mergeEcosystem, pathIsEvidenced, type AnnotationsFile } from "../src/ecosystem-build.js"
import type { ObservationFile, RepoObservation } from "../src/ecosystem-collect.js"

const effectPaths = [
  "packages/core/src/service.ts",
  "packages/llm/src/provider/openai.ts",
  "packages/tui/src/app.tsx"
]

const obs = (repo: string, over: Partial<RepoObservation> = {}): RepoObservation =>
  ({
    repo,
    stars: 5000,
    license: "MIT",
    homepage: null,
    pushedAt: "2026-09-01T00:00:00Z",
    totalPackages: 4,
    observations: [{ path: "packages/core/package.json", runtime: ["effect"], dev: [] }],
    readFailures: 0,
    centrality: { totalPackages: 4, runtimePackages: ["packages/core/package.json"], devOnlyPackages: [], incidentalPackages: [], ratio: 0.25, verdict: "core" },
    deps: ["effect"],
    scannedFiles: 100,
    effectFiles: effectPaths.length,
    effectFilePaths: effectPaths,
    capabilities: { counts: { gen: 3 }, present: ["gen"], topFiles: [{ path: effectPaths[0]!, capabilities: ["gen"], hits: 9 }] },
    via: ["keyword-sweep"],
    tarballBytes: 1024,
    ...over
  }) as RepoObservation

const observations = (list: RepoObservation[]): ObservationFile => ({
  collectedAt: "2026-09-12T00:00:00.000Z",
  channels: ["keyword-sweep"],
  candidateCount: list.length,
  observations: list,
  unreadable: []
})

const annotations = (entries: AnnotationsFile["entries"]): AnnotationsFile => ({ entries })

const note = {
  summary: "一个用来测试的 Effect 项目，够长就不会被门禁拦下。",
  category: "coding-agent" as const,
  level: "进阶" as const,
  reading: [{ path: "packages/core/src/service.ts", why: "看 Effect 服务怎么组装起来" }]
}

describe("pathIsEvidenced：点评指向的文件必须真的被观测到", () => {
  it("精确命中", () => expect(pathIsEvidenced("packages/core/src/service.ts", effectPaths)).toBe(true))
  it("指向目录（其下有命中文件）也算", () => expect(pathIsEvidenced("packages/core/src", effectPaths)).toBe(true))
  it("目录前缀不能靠字符串前缀蒙混（packages/core/srcX 不算）", () =>
    expect(pathIsEvidenced("packages/core/srcX", effectPaths)).toBe(false))
  it("不存在的文件判否", () => expect(pathIsEvidenced("packages/nope/src/a.ts", effectPaths)).toBe(false))
  it("末尾斜杠归一化", () => expect(pathIsEvidenced("packages/core/src/", effectPaths)).toBe(true))
  it("空字符串判否", () => expect(pathIsEvidenced("", effectPaths)).toBe(false))
})

describe("mergeEcosystem：机器给事实，人给解释", () => {
  it("正常合并，观测到的字段来自机器，点评字段来自人", () => {
    const r = mergeEcosystem(observations([obs("a/b")]), annotations({ "a/b": note }), { checkedAt: "2026-09-12" })
    expect(r.problems).toEqual([])
    const e = r.file.entries[0]!
    expect(e.stars).toBe(5000)
    expect(e.deps).toEqual(["effect"])
    expect(e.evidence).toEqual({ scannedFiles: 100, effectFiles: 3 })
    expect(e.summary).toBe(note.summary)
    expect(e.checkedAt).toBe("2026-09-12")
    expect(r.file.labels.capabilities["gen"]).toBe("Effect.gen 组合")
  })

  it("点评指向观测里不存在的文件 ⇒ 门禁失败（防止凭印象编造路径）", () => {
    const bad = { ...note, reading: [{ path: "packages/core/src/imaginary.ts", why: "看这里" }] }
    const r = mergeEcosystem(observations([obs("a/b")]), annotations({ "a/b": bad }), { checkedAt: "2026-09-12" })
    expect(r.problems.join("\n")).toContain("在观测里不存在")
  })

  it("没有点评的观测被列为待点评，且不入榜", () => {
    const r = mergeEcosystem(observations([obs("a/b"), obs("c/d")]), annotations({ "a/b": note }), { checkedAt: "2026-09-12" })
    expect(r.unannotated).toEqual(["c/d"])
    expect(r.file.entries.map((e) => e.repo)).toEqual(["a/b"])
  })

  it("点评了但观测里没有（仓库改名/被淘汰）会被列出，不静默丢弃", () => {
    const r = mergeEcosystem(observations([obs("a/b")]), annotations({ "a/b": note, "gone/repo": note }), { checkedAt: "2026-09-12" })
    expect(r.unmatchedAnnotations).toEqual(["gone/repo"])
  })

  it("星数分层由 star 决定，不由人指定", () => {
    const r = mergeEcosystem(observations([obs("big/one"), obs("small/one", { stars: 500 })]), annotations({ "big/one": note, "small/one": note }), {
      checkedAt: "2026-09-12"
    })
    expect(r.file.entries.map((e) => e.repo)).toEqual(["big/one", "small/one"])
    expect(r.file.entries[1]!.stars).toBeLessThan(r.file.mainlineStars)
  })
})
