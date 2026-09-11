/**
 * 内容门禁单测：用临时目录构造译文，覆盖错误/警告/忽略规则。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { checkDocs, stripCode } from "../src/check.js"
import type { DocsNav } from "../src/nav.js"
import type { Glossary } from "../src/check.js"

const NAV: DocsNav = {
  generatedFrom: { repo: "Effect-TS/website", dir: "apps/web/src/content/docs", head: null, generatedAt: "" },
  versions: {
    v4: [
      {
        key: "getting-started",
        label: "快速上手",
        order: 0,
        items: [
          {
            slug: "v4/getting-started/why-effect",
            label: "Why Effect?",
            order: 0,
            upstreamPath: "v4/getting-started/why-effect.mdx"
          }
        ]
      }
    ]
  }
}

const GLOSSARY: Glossary = {
  forbidden: [
    { term: "纤维", preferred: "Fiber" },
    { term: "图层", preferred: "Layer" }
  ]
}

const VALID_FRONTMATTER = [
  "title: 为什么选择 Effect？",
  "status: reviewing",
  "upstreamPath: v4/getting-started/why-effect.mdx",
  "upstreamCommit: 16b1646850ded8b32b8b86bbdd941092d55d8f24",
  "translators: [tester]",
  "reviewers: []"
].join("\n")

const doc = (frontmatter: string, body = "这是中文正文，讲的是 Effect 的核心理念。"): string =>
  `---\n${frontmatter}\n---\n\n${body}\n`

const dirs: Array<string> = []

async function makeDocs(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ecn-check-"))
  dirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content, "utf8")
  }
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("checkDocs", () => {
  it("合法译文：无错误", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc(VALID_FRONTMATTER)
    })
    const result = await checkDocs({ docsDir: dir, nav: NAV, glossary: GLOSSARY })
    expect(result.total).toBe(1)
    expect(result.errors).toEqual([])
  })

  it("缺少 title / status / 基线：逐条报错", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc("description: 无标题无状态")
    })
    const result = await checkDocs({ docsDir: dir, nav: NAV, glossary: GLOSSARY })
    const messages = result.errors.map((issue) => issue.message).join("\n")
    expect(messages).toContain("title")
    expect(messages).toContain("status")
    expect(messages).toContain("upstreamPath")
    expect(messages).toContain("upstreamCommit")
  })

  it("upstreamPath 不在官方导航清单中：报错", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc(
        VALID_FRONTMATTER.replace(
          "v4/getting-started/why-effect.mdx",
          "v4/getting-started/typo-path.mdx"
        )
      )
    })
    const result = await checkDocs({ docsDir: dir, nav: NAV, glossary: GLOSSARY })
    expect(result.errors.some((issue) => issue.message.includes("不在官方导航清单"))).toBe(true)
    // 同时也会因为本地路径与 upstreamPath 不一致而报错
    expect(result.errors.some((issue) => issue.message.includes("镜像"))).toBe(true)
  })

  it("published 但无审校：报错", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc(
        VALID_FRONTMATTER.replace("status: reviewing", "status: published")
      )
    })
    const result = await checkDocs({ docsDir: dir, nav: NAV, glossary: GLOSSARY })
    expect(result.errors.some((issue) => issue.message.includes("reviewers"))).toBe(true)
  })

  it("术语黑名单命中：报错（行内代码不算）", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc(VALID_FRONTMATTER, "你说的“纤维”其实指 `纤维`。"),
      // 行内代码中的同名词不应命中
      "v4/getting-started/only-inline.mdx": doc(
        VALID_FRONTMATTER.replace("why-effect.mdx", "only-inline.mdx"),
        "这里出现 `纤维` 只是代码。"
      )
    })
    const result = await checkDocs({ docsDir: dir, nav: NAV, glossary: GLOSSARY })
    const hits = result.errors.filter((issue) => issue.message.includes("术语禁用词"))
    expect(hits).toHaveLength(1)
    expect(hits[0]?.file).toBe("v4/getting-started/why-effect.mdx")
  })

  it("代码围栏残留 twoslash：报错", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc(
        VALID_FRONTMATTER,
        "```ts twoslash import.meta.vitest\nconst a = 1\n```"
      )
    })
    const result = await checkDocs({ docsDir: dir, nav: NAV, glossary: GLOSSARY })
    expect(result.errors.some((issue) => issue.message.includes("twoslash"))).toBe(true)
  })

  it("代码块外的长英文段落：告警但不阻断", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc(
        VALID_FRONTMATTER,
        "This paragraph was left untranslated and contains many consecutive English words indeed.\n\n```ts\nconst msg = \"this long english string in code should be ignored completely\"\n```"
      )
    })
    const result = await checkDocs({ docsDir: dir, nav: NAV, glossary: GLOSSARY })
    expect(result.errors).toEqual([])
    expect(result.warnings.some((issue) => issue.message.includes("疑似未翻译"))).toBe(true)
  })

  it("残留官方 Starlight 导入：报错（保留组件标签则合法）", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc(
        VALID_FRONTMATTER,
        'import { Aside } from "@astrojs/starlight/components"\n\n<Aside type="note">提示</Aside>'
      ),
      "v4/getting-started/only-inline.mdx": doc(
        VALID_FRONTMATTER.replace("why-effect.mdx", "only-inline.mdx"),
        '<Aside type="note">只有标签没有 import，应当合法</Aside>'
      )
    })
    const result = await checkDocs({ docsDir: dir, nav: NAV, glossary: GLOSSARY })
    const hits = result.errors.filter((issue) => issue.message.includes("@astrojs/starlight"))
    expect(hits).toHaveLength(1)
    expect(hits[0]?.file).toBe("v4/getting-started/why-effect.mdx")
  })

  it("页内英文锚点未固定：告警（用显式锚点固定后不告警）", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc(
        VALID_FRONTMATTER,
        '[divide](#why-not-throw-errors)\n\n<span id="why-not-throw-errors" />\n\n## 为什么不抛出错误？'
      ),
      "v4/getting-started/only-inline.mdx": doc(
        VALID_FRONTMATTER.replace("why-effect.mdx", "only-inline.mdx"),
        "[divide](#not-pinned)\n\n## 为什么不抛出错误？"
      )
    })
    const result = await checkDocs({ docsDir: dir, nav: NAV, glossary: GLOSSARY })
    const anchors = result.warnings.filter((issue) => issue.message.includes("页内锚点"))
    expect(anchors).toHaveLength(1)
    expect(anchors[0]?.message).toContain("#not-pinned")
  })

  it("含长 URL 的中文段落：不误报漏译", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc(
        VALID_FRONTMATTER,
        "详见 [MDN 文档](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Increment#postfix_increment) 的说明。"
      )
    })
    const result = await checkDocs({ docsDir: dir, nav: NAV, glossary: GLOSSARY })
    expect(result.warnings.filter((issue) => issue.message.includes("疑似未翻译"))).toEqual([])
  })

  it("疑似漏译告警使用文件真实行号（含 frontmatter 偏移）", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc(
        VALID_FRONTMATTER,
        "This paragraph was left untranslated and contains many consecutive English words indeed."
      )
    })
    const result = await checkDocs({ docsDir: dir, nav: NAV, glossary: GLOSSARY })
    const warning = result.warnings.find((issue) => issue.message.includes("疑似未翻译"))
    expect(warning?.message).toContain("第 10 行")
  })

  it("忽略 _ 前缀文件（与内容集合规则一致）", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc(VALID_FRONTMATTER),
      "_README.md": "# 说明文件，不参与集合",
      "v4/_draft.mdx": "没有 frontmatter 也不该被收录"
    })
    const result = await checkDocs({ docsDir: dir, nav: NAV, glossary: GLOSSARY })
    expect(result.total).toBe(1)
    expect(result.errors).toEqual([])
  })
})

/**
 * 治理不变量：Agent 起草的页面可以进仓库，但**不能自己宣布"已人工审校"**。
 *
 * `ecn-review` 的含义是"机器可复核"（代码块/术语/锚点自动校验），不是人类精读。
 * 默认不阻断（站点现状就是全站机器可复核），但维护者可以一键收紧。
 */
describe("requireHumanReviewer（默认关闭，维护者可收紧）", () => {
  const published = (reviewers: string): string =>
    [
      "title: 为什么选择 Effect？",
      "status: published",
      "upstreamPath: v4/getting-started/why-effect.mdx",
      "upstreamCommit: 16b1646850ded8b32b8b86bbdd941092d55d8f24",
      "translators: [ecn-agent]",
      `reviewers: [${reviewers}]`
    ].join("\n")

  it("默认（不传开关）：只有机器审校者也放行 —— 不替维护者做发布决定", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc(published("ecn-review"))
    })
    const result = await checkDocs({ docsDir: dir, nav: NAV, glossary: GLOSSARY })
    expect(result.errors).toEqual([])
  })

  it("开启开关：只有机器审校者 → 报错并点名机器身份", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc(published("ecn-review"))
    })
    const result = await checkDocs({
      docsDir: dir,
      nav: NAV,
      glossary: GLOSSARY,
      requireHumanReviewer: true
    })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toContain("ecn-review")
    expect(result.errors[0]?.message).toContain("人工精读")
  })

  it("开启开关：维护者补上自己的名字后放行", async () => {
    const dir = await makeDocs({
      "v4/getting-started/why-effect.mdx": doc(published("ecn-review, aaronlou"))
    })
    const result = await checkDocs({
      docsDir: dir,
      nav: NAV,
      glossary: GLOSSARY,
      requireHumanReviewer: true
    })
    expect(result.errors).toEqual([])
  })
})

describe("stripCode", () => {
  it("移除围栏代码与行内代码", () => {
    const body = "正文 `纤维` 行内\n```ts\n纤维\n```\n结尾"
    const stripped = stripCode(body)
    expect(stripped).not.toContain("纤维")
    expect(stripped).toContain("正文")
  })
})
