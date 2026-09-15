/**
 * `docs-links.mjs` 的回归测试。
 *
 * 这些断言存在的直接原因：改写后的链接曾经粘上数字后缀
 * （`…/HashSet#empty14`）—— 把 title 捕获组改成非捕获之后仍在取 `title`，
 * 拿到的是 replace 回调的 offset 数字。链接审计**抓不到**这种错误，
 * 因为改写完成后它已经是外链、直接跳过检查。
 *
 * 用 Node 内置 test runner：Apps/site 没有 vitest，不值得为几行纯函数引入一个。
 */
import { test } from "node:test"
import assert from "node:assert/strict"

import { makeExternalHref, markdownLinkTargets, rewriteMarkdownLinks } from "../docs-links.mjs"

const known = new Set(["v4/getting-started/creating-effects", "v3/stream/introduction"])
const href = makeExternalHref(known)
const rewrite = (markdown) => rewriteMarkdownLinks(markdown, href)

test("站内已有的 /docs 链接保持不动", () => {
  const source = "见 [创建 Effect](/docs/v4/getting-started/creating-effects)。"
  assert.equal(rewrite(source), source)
})

test("站内没有的 /docs 链接改写到官方站点，且不粘 offset 数字", () => {
  // 末尾的 `26` 就是当初那个 bug 的形状：它是 match 在整段文本里的偏移量
  const actual = rewrite("[Effect](/docs/v4/api/effect/Effect)")
  assert.equal(actual, "[Effect](https://effect.website/docs/v4/api/effect/Effect)")
  assert.doesNotMatch(actual, /\d\)$/)
})

test("表格里的链接（真实触发场景）", () => {
  const row = "| 构造器 | [empty](/docs/v4/api/effect/HashSet#empty) | 创建一个空 HashSet | O(1) |"
  const actual = rewrite(row)
  assert.match(actual, /\]\(https:\/\/effect\.website\/docs\/v4\/api\/effect\/HashSet#empty\)/)
  assert.doesNotMatch(actual, /#empty\d/)
})

test("保留 Markdown 链接的 title", () => {
  assert.equal(
    rewrite('[x](/docs/v4/api/effect/HashSet "官方参考")'),
    '[x](https://effect.website/docs/v4/api/effect/HashSet "官方参考")'
  )
})

test("官方专属路径改写到 effect.website", () => {
  assert.equal(rewrite("[Playground](/play)"), "[Playground](https://effect.website/play)")
})

test("行内其它站内链接不受影响", () => {
  const source = "见 [报错百科](/errors/) 与 [博客](/blog/)。"
  assert.equal(rewrite(source), source)
})

test("代码围栏里的 /docs 链接必须原样保留（译文与上游逐字节一致）", () => {
  const source = ["```ts", 'const doc = "/docs/v4/api/effect/Effect"', "```"].join("\n")
  assert.equal(rewrite(source), source)
})

test("行内代码里的 /docs 链接必须原样保留", () => {
  const source = "路径是 `/docs/v4/api/effect/Effect` 这样。"
  assert.equal(rewrite(source), source)
})

test("裸 HTML 链接也会被改写", () => {
  assert.equal(
    rewrite('<a href="/docs/v4/api/effect/Effect">类</a>'),
    '<a href="https://effect.website/docs/v4/api/effect/Effect">类</a>'
  )
})

test("markdownLinkTargets 返回纯目标，不带 offset", () => {
  const targets = markdownLinkTargets("[a](/docs/v4/api/effect/Effect) 和 [b](/errors/)")
  assert.deepEqual(targets, ["/docs/v4/api/effect/Effect", "/errors/"])
})

test("markdownLinkTargets 跳过代码块", () => {
  const source = ["```sh", "curl /docs/v4/api/effect/Effect", "```", "[真链接](/errors/)"].join("\n")
  assert.deepEqual(markdownLinkTargets(source), ["/errors/"])
})
