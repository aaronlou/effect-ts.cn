/**
 * 浏览器内检索（静态托管降级路径）的质量门禁。
 *
 * 它必须满足两条：
 * - 中文自然问句能命中正确**页面**（此前 ⌘K 是整串子串匹配，中文问句全空）；
 * - 无关问题不许硬凑（同样的覆盖率门禁），否则降级路径会变成"看起来很懂的胡说"。
 */
import { describe, expect, it } from "vitest"
import {
  buildClientSearchIndex,
  excerptAround,
  extractErrorQuery,
  type ClientSearchEntry
} from "../src/client-search.js"

const entry = (
  title: string,
  url: string,
  text: string,
  section = ""
): ClientSearchEntry => ({ type: "doc", title, url, section, translated: true, text })

const index = buildClientSearchIndex([
  entry(
    "安装",
    "/docs/v4/getting-started/installation/",
    "安装 Effect 需要 Node.js 22 以上。可以使用 npm、pnpm、yarn 或 bun 安装 effect 包。"
  ),
  entry(
    "管理 Layer",
    "/docs/v4/requirements-management/layers/",
    "Layer 用来描述依赖关系。通过 Layer 组合服务，并在程序入口注入依赖。依赖注入让测试更容易。"
  ),
  entry(
    "运行 Effect",
    "/docs/v4/getting-started/running-effects/",
    "runSync 会同步执行 Effect 并返回结果，runPromise 返回 Promise。运行时需要提供所需依赖。"
  ),
  entry("Effect 的两种错误类型", "/docs/v4/error-management/two-error-types/", "Effect 区分预期错误与缺陷。")
])

describe("中文自然问句能命中页面", () => {
  it("「怎么安装 Effect？」→ 安装页", () => {
    expect(index.search("怎么安装 Effect？", 3)[0]?.entry.url).toBe("/docs/v4/getting-started/installation/")
  })

  it("「Layer 怎么做依赖注入？」→ Layer 页", () => {
    expect(index.search("Layer 怎么做依赖注入？", 3)[0]?.entry.url).toBe(
      "/docs/v4/requirements-management/layers/"
    )
  })

  it("「runSync 和 runPromise 有什么区别？」→ 运行页", () => {
    expect(index.search("runSync 和 runPromise 有什么区别？", 3)[0]?.entry.url).toBe(
      "/docs/v4/getting-started/running-effects/"
    )
  })
})

describe("无关问题不硬凑（降级路径同样要诚实）", () => {
  it("「今天北京的天气怎么样？」→ 无结果", () => {
    expect(index.search("今天北京的天气怎么样？", 5)).toEqual([])
  })

  // 回归：英文无关问句曾经靠"含 ≥3 字符英文词"通过话题判定而硬凑出结果。
  // 静态索引是"没有后端时"的降级路径，诚实性要求与服务端一致。
  const UNRELATED_ENGLISH: ReadonlyArray<string> = [
    "how to cook pasta",
    "who is the president of the united states",
    "the quick brown fox jumps over the lazy dog",
    "best pizza in town"
  ]
  for (const question of UNRELATED_ENGLISH) {
    it(`「${question}」→ 无结果`, () => {
      expect(index.search(question, 5)).toEqual([])
    })
  }

  it("空查询 → 无结果", () => {
    expect(index.search("   ", 5)).toEqual([])
  })
})

describe("摘录与报错提词", () => {
  it("摘录以命中词为中心", () => {
    const text = "前缀".repeat(60) + "依赖注入让测试更容易。" + "后缀".repeat(60)
    const excerpt = excerptAround(text, "依赖注入", 40)
    expect(excerpt).toContain("依赖注入")
  })

  it("从 TS 报错里提取 API 名与错误码", () => {
    const query = extractErrorQuery(
      "TS2345: Type 'Schema.Schema<string, never, never>' is not assignable to 'Layer.Layer<never, never, never>'"
    )
    expect(query).toContain("TS2345")
    expect(query).toContain("Schema.Schema")
    expect(query).toContain("Layer.Layer")
  })

  it("提取不到标识符时退回原文片段（不做无意义的空检索）", () => {
    expect(extractErrorQuery("the quick brown fox")).toBe("the quick brown fox")
  })
})

describe("已翻译内容优先于未翻译条目（静态索引里未翻译页只有英文标题）", () => {
  const mixed = buildClientSearchIndex([
    { type: "doc", title: "Layer Memoization", url: "/docs/v4/requirements-management/layer-memoization/", section: "v4 · Requirements Management", translated: false, text: "" },
    { type: "doc", title: "Managing Layers", url: "/docs/v4/requirements-management/managing-layers/", section: "v4 · Requirements Management", translated: false, text: "" },
    { type: "doc", title: "管理 Layer", url: "/docs/v4/requirements-management/layers/", section: "", translated: true, text: "Layer 用来描述依赖关系，通过依赖注入把服务组合起来。" }
  ])

  it("「Layer 怎么做依赖注入？」→ 已翻译的《管理 Layer》排第一", () => {
    const hits = mixed.search("Layer 怎么做依赖注入？", 3)
    expect(hits[0]?.entry.url).toBe("/docs/v4/requirements-management/layers/")
  })
})

describe("标题即话题（《安装》《Fiber》这类页面）", () => {
  it("「怎么安装 Effect？」→ 标题为《安装》的页面排第一", () => {
    const own = buildClientSearchIndex([
      entry(
        "导入 Effect",
        "/docs/v4/getting-started/importing-effect/",
        "通常只要安装包就能开始。安装之后即可导入。安装方式很多，安装很简单。"
      ),
      entry("安装", "/docs/v4/getting-started/installation/", "安装 Effect 需要 Node.js 22 以上。")
    ])
    expect(own.search("怎么安装 Effect？", 3)[0]?.entry.url).toBe("/docs/v4/getting-started/installation/")
  })
})
