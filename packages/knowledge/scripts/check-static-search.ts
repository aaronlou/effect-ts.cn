/**
 * 静态索引的金标门禁（CI，在 `pnpm build` 之后运行）。
 *
 * 为什么单独有这一道：站点的默认部署形态是静态托管，⌘K 搜索与"无后端时的问答降级"
 * 都吃 `/search-index.json`。服务端有 recall@3 评测，构建产物也必须有一份 ——
 * 否则"索引截断 / 未翻译页压过已翻译页"这类问题只会在用户那里被发现。
 *
 * 用法：
 *   pnpm --filter @ecn/knowledge exec tsx scripts/check-static-search.ts \
 *     --index apps/site/dist/search-index.json
 */
import { readFileSync } from "node:fs"
import process from "node:process"
import { buildClientSearchIndex, type ClientSearchEntry } from "../src/client-search.js"

interface Golden {
  readonly question: string
  readonly expectedUrl: string
  readonly why: string
}

const GOLDEN: ReadonlyArray<Golden> = [
  {
    question: "怎么安装 Effect？",
    expectedUrl: "/docs/v4/getting-started/installation/",
    why: "标题即话题：安装"
  },
  {
    question: "Layer 怎么做依赖注入？",
    expectedUrl: "/docs/v4/requirements-management/layers/",
    why: "已翻译页必须压过未翻译的英文标题页"
  },
  { question: "Fiber 是什么？", expectedUrl: "/docs/v4/concurrency/fibers/", why: "已翻译的并发基础页" },
  {
    question: "Effect 的错误分哪两类？",
    expectedUrl: "/docs/v4/error-management/two-error-types/",
    why: "错误管理章节已翻译"
  },
  {
    question: "runSync 和 runPromise 有什么区别？",
    expectedUrl: "/docs/v4/getting-started/running-effects/",
    why: "英文 API 名也能命中"
  }
]

/** 必须诚实：这些问句在站内没有依据，静态索引同样不许硬凑 */
const MUST_BE_EMPTY: ReadonlyArray<string> = ["今天北京的天气怎么样？", "推荐一部科幻电影"]

const argIndex = process.argv.indexOf("--index")
const indexFile = argIndex >= 0 ? process.argv[argIndex + 1] : "apps/site/dist/search-index.json"
if (indexFile === undefined) {
  console.error("用法：tsx scripts/check-static-search.ts --index <path>")
  process.exit(2)
}

const entries = JSON.parse(readFileSync(indexFile, "utf8")) as ReadonlyArray<ClientSearchEntry>
const translated = entries.filter((entry) => entry.translated)

if (translated.length < 10) {
  console.error(`静态索引里只有 ${translated.length} 篇已翻译内容，疑似索引生成异常`)
  process.exit(1)
}

const index = buildClientSearchIndex(entries)
const failures: Array<string> = []

for (const { question, expectedUrl, why } of GOLDEN) {
  const hits = index.search(question, 3)
  const urls = hits.map((hit) => hit.entry.url)
  if (!urls.includes(expectedUrl)) {
    failures.push(`「${question}」未进前三（${why}）\n    期望：${expectedUrl}\n    实际：${urls.join(", ") || "（无结果）"}`)
  }
}

for (const question of MUST_BE_EMPTY) {
  const hits = index.search(question, 3)
  if (hits.length > 0) {
    failures.push(`「${question}」不该有结果，实际：${hits.map((hit) => hit.entry.url).join(", ")}`)
  }
}

if (failures.length > 0) {
  console.error("静态检索门禁未通过：\n- " + failures.join("\n- "))
  process.exit(1)
}

const totalChars = translated.reduce((sum, entry) => sum + entry.text.length, 0)
console.log(
  `静态检索门禁通过 ✔（${translated.length} 篇已翻译 / ${entries.length} 条索引 / 正文 ${Math.round(
    totalChars / 1000
  )}k 字符；${GOLDEN.length} 个金标问句 + ${MUST_BE_EMPTY.length} 个必须无结果的问句）`
)
