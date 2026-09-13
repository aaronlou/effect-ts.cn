/**
 * 报错解释（S2 v0）质量门禁：
 * - 能从真实报错里提取检索锚点；
 * - 有相关文档时给出引用（不臆测）；
 * - 未翻译主题诚实拒答并给英文原文；
 * - 完全无关的报错不得硬答。
 */
import { describe, expect, it } from "vitest"
import {
  composeExplanation,
  corpus,
  createCorpusIndex,
  createTopicRouter,
  extractIdentifiers,
  type CorpusPendingPage
} from "../src/index.js"

const index = createCorpusIndex(corpus)
const router = createTopicRouter(corpus.pages, corpus.pending)

/**
 * 合成"未翻译页面"：站点 234 页已全部译完，真实 pending 为空，
 * 因此这条"未翻译 → 拒答 + 给英文原文"的路径必须用合成语料才能持续验证。
 * 主题词 `zygo` 在已译语料里不存在，保证不会误判为已翻译。
 */
const syntheticPending: ReadonlyArray<CorpusPendingPage> = [
  {
    slug: "v4/schema/zygo-design",
    version: "v4",
    title: "Zygo Schema Design",
    sectionLabel: "Schema",
    upstreamPath: "v4/schema/zygo-design.mdx",
    officialUrl: "https://effect.website/docs/v4/schema/zygo-design"
  }
]
const syntheticRouter = createTopicRouter(corpus.pages, syntheticPending)

const explain = (errorText: string) =>
  composeExplanation({
    errorText,
    okHits: index.search(
      extractIdentifiers(errorText).join(" ") !== "" ? extractIdentifiers(errorText).join(" ") : errorText.slice(0, 200),
      { limit: 5 }
    ),
    pending: corpus.pending,
    router
  })

describe("extractIdentifiers", () => {
  it("提取模块限定 API、包名、错误码与错误类型", () => {
    const ids = extractIdentifiers(
      "TS2345: Argument of type 'Effect<number, never, never>' ... Effect.runPromise ... @effect/schema ... TypeError ... Layer.Layer<Foo, never, never>"
    )
    expect(ids).toContain("Effect.runPromise")
    expect(ids).toContain("@effect/schema")
    expect(ids).toContain("TS2345")
    expect(ids).toContain("TypeError")
    expect(ids).toContain("Layer.Layer")
  })

  it("无关文本不产生锚点（避免乱检索）", () => {
    expect(extractIdentifiers("The quick brown fox jumps over the lazy dog")).toEqual([])
  })
})

describe("composeExplanation", () => {
  it("报错涉及已译文 API → 给出引用，且不把它说成诊断结论", () => {
    const result = explain(
      "TS2345: Argument of type 'Effect<number, never, never>' is not assignable to parameter of type 'number'. Did you mean to call Effect.runPromise?"
    )
    expect(result.refused).toBe(false)
    expect(result.identifiers.length).toBeGreaterThan(0)
    expect(result.citations.length).toBeGreaterThan(0)
    expect(result.answer).toContain("最相关")
    expect(result.disclaimer).toContain("不是自动诊断结论")
  })

  it("报错涉及已翻译主题（Layer）→ 引用到《Layer 与依赖注入》", () => {
    const result = explain(
      "Type 'Layer.Layer<Database, never, never>' is not assignable to type 'Layer.Layer<never, never, never>'"
    )
    expect(result.refused).toBe(false)
    expect(result.citations.some((item) => item.slug.includes("requirements-management/layers"))).toBe(true)
  })

  it("报错涉及未翻译主题 → 拒答 + 官方英文原文（合成 pending 语料）", () => {
    const result = composeExplanation({
      // 带中文的真实形态报错（纯英文且无锚点会先被"不硬答"守卫拦下，那是另一条路径）
      errorText:
        "报错：类型不匹配 —— Type 'Zygo.Zygo<string>' is not assignable to type 'Zygo.Zygo<number>'",
      okHits: [],
      pending: syntheticPending,
      router: syntheticRouter
    })
    expect(result.refused).toBe(true)
    expect(result.citations).toEqual([])
    expect(result.refusal?.reason).toBe("untranslated")
    expect(result.refusal?.suggestions?.some((item) => item.slug.startsWith("v4/schema/"))).toBe(true)
  })

  it("完全无关的报错 → no-match 拒答并给出行动出口", () => {
    const result = explain("The quick brown fox jumps over the lazy dog")
    expect(result.refused).toBe(true)
    expect(result.refusal?.reason).toBe("no-match")
    expect(result.refusal?.message).toContain("Issue")
  })
})

/**
 * 回归：**带堆栈帧的真实报错曾经被拒答**。
 *
 * 实测事故：用户从终端复制的报错几乎一定带堆栈，而"模块限定 API"的正则会把
 * `.../node_modules/effect/src/Effect.ts:5:1` 里的 `Effect.ts` 当成 API 名提取出来，
 * 于是查询里混进一个不存在的话题，话题路由器据此判成"只有未翻译页面拥有它"而拒答：
 *
 *   裸消息 → 3 条引用 ｜ 加堆栈帧 → 拒答 0 引用
 *
 * 也就是说 `/debug` 最主要的使用场景此前是坏的。文件名不可能是 API 名，必须排除；
 * 但堆栈里的**真 API 名**（`at Layer.succeed (...)`）要保留 —— 它是有用的检索锚点。
 */
describe("报错标识符：带堆栈帧的真实报错不能被误伤", () => {
  const message =
    "TS2345: Argument of type 'Effect<number, never, never>' is not assignable to parameter of type 'number'. Did you mean to call Effect.runPromise?"

  it("不把堆栈里的文件名当成 API 名", () => {
    const ids = extractIdentifiers(
      `${message}\n  at /Users/bob/node_modules/effect/src/Effect.ts:5:1`
    )
    expect(ids).not.toContain("Effect.ts")
    expect(ids).toContain("Effect.runPromise")
  })

  it("但堆栈里的真 API 名要保留（它是有用的检索锚点）", () => {
    const ids = extractIdentifiers(`${message}\n  at Layer.succeed (/x/Layer.js:2:1)`)
    expect(ids).toContain("Layer.succeed")
    expect(ids).not.toContain("Layer.js")
  })

  it("各种文件扩展名都不算 API 名", () => {
    const ids = extractIdentifiers("Effect.ts Effect.tsx Effect.js Effect.mjs Effect.d.ts Effect.json Effect.map")
    for (const file of ["Effect.ts", "Effect.tsx", "Effect.js", "Effect.mjs", "Effect.d.ts", "Effect.json"]) {
      expect(ids).not.toContain(file)
    }
    // `Effect.map` 是真实 API，必须保留
    expect(ids).toContain("Effect.map")
  })
})

/**
 * 回归：**纯类型报错此前一律拒答**。
 *
 * 背景：`extractIdentifiers` 原先只认「带点的运行时 API」（Effect.gen）与错误码，
 * 不认**类型位置的裸名字**（`Effect<number, never, never>`）。而 Effect 最出名的
 * 恰恰就是类型报错 —— 这类报错的正文里常常一个带点的 API 都没有。
 *
 * 实测：5 个真实 tsc 报错（算术误用 / 忘 yield* / 缺 Layer / Schema 类型不符 / Stream 当 Effect）
 * 修复前**全部拒答**，只有提到 `Stream` 的那个能答 —— 因为 `stream` 恰好不是查询停用词。
 */
describe("报错标识符：纯类型报错必须能提取出类型名", () => {
  it("抽出类型位置的裸类型名（Effect / Stream / Layer）", () => {
    expect(
      extractIdentifiers("error TS2365: Operator '+' cannot be applied to types 'Effect<number, never, never>' and 'number'.")
    ).toContain("Effect")
    expect(
      extractIdentifiers("error TS2488: Type 'Stream<number, never, never>' must have a '[Symbol.iterator]()' method")
    ).toContain("Stream")
    expect(
      extractIdentifiers("error TS2345: Argument of type 'Effect<string, never, Database>' is not assignable")
    ).toContain("Effect")
  })

  it("带点的 API 仍然优先于裸类型名（前者的区分度高得多）", () => {
    const ids = extractIdentifiers(
      "error TS2345: Effect.gen 返回的 Effect<string, never, Database> 与 Layer.succeed 不匹配"
    )
    expect(ids).toContain("Effect.gen")
    expect(ids).toContain("Layer.succeed")
  })
})

/**
 * 回归：**查询词在语料里一个都不存在时，不该白跑一遍再拒答**。
 *
 * 「TS2345 Effect」这串查询里，错误码在文档里必然不存在、`effect` 又是查询停用词 ——
 * 于是零词汇命中，打分无从谈起。退到标题匹配（类型名是高精度信号）之后，
 * 两个真实报错从"拒答"变成"给出《为什么选择 Effect？》"。
 */
describe("零词汇命中时退到标题匹配", () => {
  it("只含错误码与停用词的报错查询仍能定位（不再直接拒答）", () => {
    const hits = index.search("TS2365 Effect", { limit: 3 })
    expect(hits.length).toBeGreaterThan(0)
  })

  it("但无关查询仍然无结果（兜底不能变成硬凑）", () => {
    for (const query of ["how to cook pasta with tomato sauce", "TS2304 foobarbaz", "今天北京的天气怎么样？"]) {
      expect(index.search(query, { limit: 3 }), `「${query}」不该有命中`).toEqual([])
    }
  })
})
