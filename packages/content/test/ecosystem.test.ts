import { describe, expect, it } from "vitest"
import { detectVendoredEffect } from "../src/ecosystem-collect.js"
import {
  MAINLINE_STARS,
  type EcosystemFile,
  type PackageObservation,
  extractEffectDeps,
  fileUsesEffect,
  isIncidentalPath,
  scanFile,
  summarizeCapabilities,
  summarizeCentrality,
  validateEcosystem
} from "../src/ecosystem.js"

// 夹具取自真实观测（见 ecosystem-collect 的采集结果）——反例都来自实际踩到的假阳性
const pkg = (path: string, runtime: string[], dev: string[] = []): PackageObservation => ({ path, runtime, dev })

describe("extractEffectDeps：判据只看依赖清单", () => {
  it("认出 effect 与 @effect/* 的运行时依赖，忽略其它包", () => {
    const deps = extractEffectDeps(
      JSON.stringify({ dependencies: { effect: "^3.22.2", "@effect/platform-node": "^0.108.2", zod: "^3" }, devDependencies: { vitest: "^3" } })
    )
    expect(deps?.runtime).toEqual(["@effect/platform-node", "effect"])
    expect(deps?.dev).toEqual([])
  })

  it("只出现在 devDependencies 的不算运行时依赖（zod 的 bench 就是这种）", () => {
    const deps = extractEffectDeps(JSON.stringify({ devDependencies: { effect: "^3" } }))
    expect(deps?.runtime).toEqual([])
    expect(deps?.dev).toEqual(["effect"])
  })

  it("同时在 dependencies 与 devDependencies 时按运行时算，不重复计入 dev", () => {
    const deps = extractEffectDeps(JSON.stringify({ dependencies: { effect: "^3" }, devDependencies: { effect: "^3" } }))
    expect(deps?.runtime).toEqual(["effect"])
    expect(deps?.dev).toEqual([])
  })

  it("peerDependencies 也算运行时（库的常见写法）", () => {
    expect(extractEffectDeps(JSON.stringify({ peerDependencies: { effect: "^3" } }))?.runtime).toEqual(["effect"])
  })

  it("不把名字相近的包误判成 effect（effects / @effect-ts/x / effect-ts）", () => {
    const deps = extractEffectDeps(
      JSON.stringify({ dependencies: { effects: "^1", "effect-ts": "^1", "@effect-ts/core": "^1", "my-effect": "^1" } })
    )
    expect(deps?.runtime).toEqual([])
  })

  it("坏 JSON 返回 undefined 而不是抛异常", () => {
    expect(extractEffectDeps("{ not json")).toBeUndefined()
    expect(extractEffectDeps("null")).toBeUndefined()
    expect(extractEffectDeps('"a string"')).toBeUndefined()
  })
})

describe("边角路径：这些目录里的依赖不能证明项目主体用 Effect", () => {
  it.each([
    "packages/bench/package.json",
    "examples/ai-functions/package.json",
    "site/agents/package.json",
    "apps/docs/package.json",
    "test/fixtures/package.json",
    "benchmarks/x/package.json"
  ])("%s 判为边角", (p) => expect(isIncidentalPath(p)).toBe(true))

  it.each(["packages/core/package.json", "apps/server/package.json", "packages/llm/package.json", "package.json"])(
    "%s 不算边角",
    (p) => expect(isIncidentalPath(p)).toBe(false)
  )
})

describe("中心度：Effect 是骨架还是边角", () => {
  it("只有一个 devDependency（zod 43,930★ 的实际情况）⇒ incidental", () => {
    const c = summarizeCentrality(9, [pkg("packages/bench/package.json", [], ["effect"])])
    expect(c.verdict).toBe("incidental")
    expect(c.runtimePackages).toEqual([])
    expect(c.devOnlyPackages).toEqual(["packages/bench/package.json"])
  })

  it("只在 examples 里运行时依赖（vercel/ai 的实际情况）⇒ incidental", () => {
    const c = summarizeCentrality(125, [pkg("examples/ai-functions/package.json", ["effect"])])
    expect(c.verdict).toBe("incidental")
    expect(c.incidentalPackages).toEqual(["examples/ai-functions/package.json"])
    expect(c.runtimePackages).toEqual([])
  })

  it("主体 20/40 个包运行时依赖（opencode 的实际情况）⇒ core", () => {
    const obs = Array.from({ length: 20 }, (_, i) => pkg(`packages/p${i}/package.json`, ["effect"]))
    const c = summarizeCentrality(40, obs)
    expect(c.verdict).toBe("core")
    expect(c.ratio).toBe(0.5)
  })

  it("只有 2/55 个包（teable 的实际情况）⇒ partial，但仍在榜（页面显示渗透度）", () => {
    const c = summarizeCentrality(55, [pkg("apps/nestjs-backend/package.json", ["effect"]), pkg("packages/v2/devtools/package.json", ["effect"])])
    expect(c.verdict).toBe("partial")
    expect(c.ratio).toBe(0.036)
  })

  it("主体包一个都没有、只有边角 ⇒ incidental（哪怕边角里是运行时依赖）", () => {
    expect(summarizeCentrality(107, [pkg("site/agents/package.json", ["effect"])]).verdict).toBe("incidental")
  })

  it("3 个以上运行时包即便比例很低也算 core（避免大仓库被比例稀释）", () => {
    const obs = [1, 2, 3].map((i) => pkg(`packages/p${i}/package.json`, ["effect"]))
    expect(summarizeCentrality(500, obs).verdict).toBe("core")
  })
})

describe("能力扫描：必须先真的 import 了 effect", () => {
  it("没有 import effect 的文件一律不统计（否则 Stream./Schema. 会撞同名库）", () => {
    expect(fileUsesEffect('import { Stream } from "rxjs"')).toBe(false)
    expect(scanFile("a.ts", 'import { Stream } from "rxjs"\nStream.of(1)')).toBeUndefined()
  })

  it("认出 effect 与 @effect/* 的 import（含子路径）", () => {
    expect(fileUsesEffect('import { Effect } from "effect"')).toBe(true)
    expect(fileUsesEffect('import * as Layer from "effect/Layer"')).toBe(true)
    expect(fileUsesEffect('import { NodeHttpServer } from "@effect/platform-node"')).toBe(true)
  })

  it("统计到能力与命中次数", () => {
    const src = `
      import { Effect, Layer, Schema } from "effect"
      export const run = Effect.gen(function* () {
        yield* Effect.logInfo("hi")
        return 1
      })
      export const L = Layer.succeed(Foo, run)
      export const S = Schema.Struct({ a: Schema.String })
    `
    const e = scanFile("packages/core/src/x.ts", src)
    expect(e?.capabilities).toEqual(expect.arrayContaining(["gen", "service", "schema", "observability"]))
    expect(e?.hits).toBeGreaterThan(0)
  })

  it("汇总：能力出现文件数 + 按密度排序的入口文件", () => {
    const a = scanFile("a.ts", 'import { Effect } from "effect"\nEffect.gen(function*(){}); Effect.fork(Effect.void)')
    const b = scanFile("b.ts", 'import { Schema } from "effect"\nSchema.String')
    const c = scanFile("c.ts", 'import { Effect } from "effect"\nEffect.gen(function*(){})')
    const s = summarizeCapabilities([a!, b!, c!], 2)
    expect(s.counts["gen"]).toBe(2)
    expect(s.counts["schema"]).toBe(1)
    expect(s.topFiles).toHaveLength(2)
    expect(s.topFiles[0]!.path).toBe("a.ts")
  })
})

describe("榜单诚实性门禁", () => {
  const goodEntry = {
    repo: "anomalyco/opencode",
    stars: 206767,
    checkedAt: "2026-09-12",
    category: "coding-agent" as const,
    level: "硬核" as const,
    summary: "最火的开源编码 Agent，整个核心用 Effect 重写，可当作大型 Effect 工程范本。",
    centrality: { ratio: 0.5, verdict: "core" as const, runtimePackages: ["packages/core/package.json"], totalPackages: 2 },
    deps: ["effect", "@effect/platform-node"],
    capabilities: ["gen", "service"],
    evidence: { scannedFiles: 120, effectFiles: 40 },
    reading: [{ path: "packages/core/src/index.ts", why: "看 Effect 服务如何组装" }],
    via: ["keyword-sweep"]
  }
  const file = (entries: unknown[]): EcosystemFile =>
    ({ generatedAt: "2026-09-12T00:00:00.000Z", method: "test", mainlineStars: MAINLINE_STARS, entries }) as unknown as EcosystemFile

  it("合规条目零问题", () => expect(validateEcosystem(file([goodEntry]))).toEqual([]))

  it("边角依赖不许进榜", () => {
    const bad = { ...goodEntry, centrality: { ...goodEntry.centrality, runtimePackages: [], verdict: "incidental" as const } }
    const problems = validateEcosystem(file([bad]))
    expect(problems.join("\n")).toContain("没有任何运行时依赖")
    expect(problems.join("\n")).toContain("incidental")
  })

  it("ratio 必须与 runtimePackages/totalPackages 自洽（防止手改数字）", () => {
    const bad = { ...goodEntry, centrality: { ...goodEntry.centrality, ratio: 0.9 } }
    expect(validateEcosystem(file([bad])).join("\n")).toContain("ratio 与")
  })

  it("重复收录被发现（大小写不敏感）", () => {
    expect(validateEcosystem(file([goodEntry, { ...goodEntry, repo: "Anomalyco/OpenCode" }])).join("\n")).toContain("重复收录")
  })

  it("分类 / 难度必须在白名单内", () => {
    expect(validateEcosystem(file([{ ...goodEntry, category: "cool" }])).join("\n")).toContain("分类不在白名单")
    expect(validateEcosystem(file([{ ...goodEntry, level: "神级" }])).join("\n")).toContain("难度不在白名单")
  })

  it("「该读这里」必须写出为什么，且路径形态合法", () => {
    expect(validateEcosystem(file([{ ...goodEntry, reading: [] }])).join("\n")).toContain("没有「该读这里」")
    expect(validateEcosystem(file([{ ...goodEntry, reading: [{ path: "/abs/x.ts", why: "看这里" }] }])).join("\n")).toContain("形态非法")
    expect(validateEcosystem(file([{ ...goodEntry, reading: [{ path: "a/b.ts", why: "短" }] }])).join("\n")).toContain("why 太短")
  })

  it("占位符式的 summary 会被拦下", () => {
    expect(validateEcosystem(file([{ ...goodEntry, summary: "TODO" }])).join("\n")).toContain("summary 太短")
  })

  it("未知能力 id 会被拦下（拼错 capability 不该静默通过）", () => {
    expect(validateEcosystem(file([{ ...goodEntry, capabilities: ["gen", "quantum"] }])).join("\n")).toContain("未知能力 id")
  })

  it("空榜单直接失败", () => expect(validateEcosystem(file([])).join("\n")).toContain("榜单为空"))

  it("声明了依赖但全仓没人 import ⇒ 不许进榜（supermemory-mcp 的实际情况）", () => {
    const bad = { ...goodEntry, evidence: { scannedFiles: 9, effectFiles: 0 } }
    expect(validateEcosystem(file([bad])).join("\n")).toContain("声明≠使用")
  })

  it("测试文件照样计入能力，但排序时沉底（opencode 榜首曾是 *.test.ts）", () => {
    const t = scanFile("packages/core/test/x.test.ts", 'import { Effect } from "effect"\nEffect.gen(function*(){});Effect.fork(Effect.void);Effect.gen(function*(){})')
    const src = scanFile("packages/core/src/x.ts", 'import { Effect } from "effect"\nEffect.gen(function*(){})')
    const s2 = summarizeCapabilities([t!, src!], 2)
    expect(s2.counts["gen"]).toBe(2)
    expect(s2.topFiles[0]!.path).toBe("packages/core/src/x.ts")
  })
})

describe("识别仓库里内置的 Effect 源码", () => {
  it("识别 .context/effect 这类 vendor 目录（maple / hazel 的实际情况）", () => {
    const r = detectVendoredEffect({
      "packages/app/package.json": JSON.stringify({ name: "@maple/app" }),
      ".context/effect/packages/effect/package.json": JSON.stringify({ name: "effect" }),
      ".context/effect/packages/ai/openai/package.json": JSON.stringify({ name: "@effect/ai-openai" })
    })
    expect(r.roots).toEqual([".context/effect/"])
    expect(r.isEffectLibrary).toBe(false)
  })

  it("识别 repos/effect（foldkit / lalph 的实际情况）", () => {
    expect(detectVendoredEffect({ "repos/effect/packages/effect/package.json": '{"name":"effect"}' }).roots).toEqual([
      "repos/effect/"
    ])
  })

  it("仓库本身就是 Effect（effect-smol）⇒ isEffectLibrary，不该进「用 Effect 写的项目」榜", () => {
    const r = detectVendoredEffect({ "packages/effect/package.json": '{"name":"effect"}' })
    expect(r.isEffectLibrary).toBe(true)
    expect(r.roots).toEqual([])
  })

  it("只认源码检出（…/packages/effect），不把装好的 node_modules/effect 与同名包当 vendor", () => {
    const r = detectVendoredEffect({
      // 装出来的依赖不是「内置源码」，而且 node_modules 本来就被 SKIP_DIR 排除
      "node_modules/effect/package.json": '{"name":"effect"}',
      "packages/x/package.json": '{"name":"my-effect"}'
    })
    expect(r.roots).toEqual([])
    expect(r.isEffectLibrary).toBe(false)
  })

  it("坏 JSON 不抛异常", () => {
    expect(detectVendoredEffect({ "packages/effect/package.json": "{ 坏" }).isEffectLibrary).toBe(false)
  })
})
