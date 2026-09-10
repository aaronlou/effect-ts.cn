/**
 * 代码块一致性校验器单测。
 *
 * 断言的是**能力**：译文偷改代码必须被抓到；上游工具元数据 / 整体缩进变化不许误报。
 * 尤其注意「围栏元数据」与「未闭合围栏」两组：前者决定门禁会不会天天狼来了，
 * 后者决定遇到半成品草稿时工具是给结论还是崩溃。
 */
import { describe, expect, it } from "vitest"
import {
  compareCodeBlocks,
  compareHeadings,
  extractCodeBlocks,
  normalizeFenceInfo
} from "../src/code-parity.js"

describe("extractCodeBlocks", () => {
  it("解析反引号围栏：info 与 body（无尾部换行）", () => {
    const blocks = extractCodeBlocks("前言\n\n```ts\nconst a = 1\nconst b = 2\n```\n结尾\n")
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.info).toBe("ts")
    expect(blocks[0]?.body).toBe("const a = 1\nconst b = 2")
  })

  it("解析波浪号围栏", () => {
    const blocks = extractCodeBlocks("~~~python\nprint(1)\n~~~\n")
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.info).toBe("python")
    expect(blocks[0]?.body).toBe("print(1)")
  })

  it("围栏可带缩进；块内按最小公共缩进 dedent（放进列表/组件不算改动）", () => {
    const nested = ["- 列表项：", "", "  ```ts", "  const x = 1", "  if (x) {", "    log(x)", "  }", "  ```"].join(
      "\n"
    )
    const blocks = extractCodeBlocks(nested)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.info).toBe("ts")
    expect(blocks[0]?.body).toBe("const x = 1\nif (x) {\n  log(x)\n}")
  })

  it("未闭合围栏不崩溃：把剩余内容当作一个块", () => {
    const blocks = extractCodeBlocks("```ts\nconst a = 1")
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.body).toBe("const a = 1")
  })

  it("闭合围栏长度必须 >= 开启围栏；不同字符不能闭合", () => {
    const doc = "````md\n```ts\nconst a = 1\n```\n````\n"
    const blocks = extractCodeBlocks(doc)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.body).toBe("```ts\nconst a = 1\n```")
  })

  it("空 info 与空 body 不炸", () => {
    const blocks = extractCodeBlocks("```\n```\n")
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.info).toBe("")
    expect(blocks[0]?.body).toBe("")
  })
})

describe("normalizeFenceInfo", () => {
  it("剥掉 twoslash / showLineNumbers / name=，只留语言标记", () => {
    expect(normalizeFenceInfo('ts twoslash import.meta.vitest name="why-effect-1"')).toBe("ts")
    expect(normalizeFenceInfo("text showLineNumbers=false")).toBe("text")
    expect(normalizeFenceInfo("ts showLineNumbers")).toBe("ts")
  })

  it("上游 Expressive Code 注解（title= / collapse= / 行高亮 / 单词高亮）也视为工具元数据", () => {
    // 本站没有 Expressive Code，这些注解只会变成死元数据；译文约定是一律剥掉。
    expect(normalizeFenceInfo('json title="package.json"')).toBe("json")
    expect(normalizeFenceInfo("ts twoslash collapse={3-15}")).toBe("ts")
    expect(normalizeFenceInfo("ts {3} showLineNumbers=false")).toBe("ts")
    expect(normalizeFenceInfo('diff lang="tsx" title="src/App.tsx"')).toBe("diff")
    expect(normalizeFenceInfo('text showLineNumbers=false "Error"')).toBe("text")
  })

  it("带空格的引号注解（Expressive Code 单词高亮）整段视为工具元数据", () => {
    // 关键回归：`"Config | Logger"` 不能被空白切词切成三个 token，否则会误报
    expect(normalizeFenceInfo('ts showLineNumbers=false "Config | Logger"')).toBe("ts")
    expect(normalizeFenceInfo('ts twoslash "<Buffer, Error>"')).toBe("ts")
    expect(normalizeFenceInfo('ts twoslash "Config | Logger" import.meta.vitest name="x"')).toBe("ts")
  })

  it("其余 token 保留并归一顺序 / 空白（大小写敏感）", () => {
    expect(normalizeFenceInfo("ts   foo    bar")).toBe("bar foo ts")
    expect(normalizeFenceInfo("Foo bar")).toBe("Foo bar")
    expect(normalizeFenceInfo("")).toBe("")
  })
})

describe("compareCodeBlocks", () => {
  const upstream = ["```ts", "const a = 1", "const b = 2", "```", "", "```sh", "pnpm test", "```"].join(
    "\n"
  )

  it("完全一致 → ok，块数正确", () => {
    const result = compareCodeBlocks(upstream, upstream)
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.upstreamCount).toBe(2)
    expect(result.translatedCount).toBe(2)
  })

  it("块数不同 → 报错并给出两侧数量", () => {
    const translated = ["```ts", "const a = 1", "```"].join("\n")
    const result = compareCodeBlocks(upstream, translated)
    expect(result.ok).toBe(false)
    expect(result.upstreamCount).toBe(2)
    expect(result.translatedCount).toBe(1)
    expect(result.issues.join("\n")).toContain("代码块数量不一致")
  })

  it("块内改动一个字符 → 报错，定位到块号与行号并给出两侧内容", () => {
    const translated = upstream.replace("const b = 2", "const b = 3")
    const result = compareCodeBlocks(upstream, translated)
    expect(result.ok).toBe(false)
    const message = result.issues.join("\n")
    expect(message).toContain("第 1 个代码块正文第 2 行不一致")
    expect(message).toContain("const b = 2")
    expect(message).toContain("const b = 3")
  })

  it("围栏元数据差异（twoslash / showLineNumbers / name=）→ 视为一致", () => {
    const translated = ["```ts", "const a = 1", "const b = 2", "```", "", "```sh", "pnpm test", "```"].join(
      "\n"
    )
    const annotated = upstream
      .replace("```ts", '```ts twoslash import.meta.vitest name="x"')
      .replace("```sh", "```sh showLineNumbers=false")
    const result = compareCodeBlocks(annotated, translated)
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it("带空格的引号注解差异 → 视为一致（真实上游就有 `\"Config | Logger\"`）", () => {
    const annotated = '```ts showLineNumbers=false "Config | Logger"\nconst a = 1\n```'
    expect(compareCodeBlocks(annotated, "```ts\nconst a = 1\n```").ok).toBe(true)
  })

  it("缩进差异（整块挪进列表 / 组件）→ 视为一致", () => {
    const translated = upstream
      .split("\n")
      .map((line) => (line === "" ? "" : `  ${line}`))
      .join("\n")
    const result = compareCodeBlocks(upstream, translated)
    expect(result.ok).toBe(true)
  })

  it("未闭合围栏不崩溃", () => {
    const unclosed = "```ts\nconst a = 1"
    expect(() => compareCodeBlocks(unclosed, unclosed)).not.toThrow()
    expect(compareCodeBlocks(unclosed, "```ts\nconst a = 1\n```").ok).toBe(true)
  })

  it("差异信息截断到 120 字符内", () => {
    const long = "x".repeat(500)
    const translated = `\`\`\`ts\nconst a = "${long}"\n\`\`\``
    const result = compareCodeBlocks("```ts\nconst a = 1\n```", translated)
    expect(result.ok).toBe(false)
    const message = result.issues.join("\n")
    // 两侧内容各自截断：既不该出现完整长串，也要留省略号提示被截断
    expect(message).not.toContain(long)
    expect(message).toContain("...")
  })
})

describe("compareHeadings", () => {
  const upstream = ["# 标题", "", "## 一", "", "### 一之一", "", "## 二", "", "```md", "## 代码里的不算", "```"].join(
    "\n"
  )

  it("## / ### 数量一致 → ok（# 与 #### 不计，代码块内不计）", () => {
    const translated = ["# 标题（中文）", "", "## 甲", "", "### 甲一", "", "## 乙", "", "#### 更深", "", "```md", "## 不算", "```"].join(
      "\n"
    )
    const result = compareHeadings(upstream, translated)
    expect(result.ok).toBe(true)
    expect(result.upstreamCount).toBe(3)
    expect(result.translatedCount).toBe(3)
  })

  it("数量不一致 → 报错", () => {
    const translated = ["## 一", "", "## 二"].join("\n")
    const result = compareHeadings(upstream, translated)
    expect(result.ok).toBe(false)
    expect(result.upstreamCount).toBe(3)
    expect(result.translatedCount).toBe(2)
  })
})
