#!/usr/bin/env node
/**
 * 站内链接审计：构建产物里不允许出现指向不存在路径的内部链接。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 * 实测抓到过一处：首页「接进你的 Agent →」指向 `/docs/agent-integration.md`，
 * 而那个路由**从来就不存在** —— 因为站点的 `.md` 端点由 `getStaticPaths` 从内容集合生成，
 * 只覆盖译文页；而 `docs/agent-integration.md` 是**仓库里的工程文档**，
 * 站点 Dockerfile 根本没 COPY `docs/` 目录。于是首页上挂着一个 404。
 *
 * 这类问题人工点不出来（首页链接太多），但脚本一秒就能扫完。
 *
 * ── 两个刻意的取舍 ──────────────────────────────────────────────────────
 * 1. **只查站内链接**（`/` 开头）。外链要联网、会 flaky，不适合放进 CI。
 * 2. **跳过 `<script>` 内容**。客户端 JS 里会有模板字符串（`/errors/${sig}/`），
 *    它不是静态链接 —— 第一版脚本把它当断链报了，是误报。
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DIST = path.join(ROOT, "apps/site/dist")

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const files = walk(DIST)

/** 产物里存在的路径集合（含目录形式与 .md 端点） */
const exists = new Set()
for (const file of files) {
  const rel = "/" + path.relative(DIST, file).split(path.sep).join("/")
  exists.add(rel)
  if (rel.endsWith("/index.html")) exists.add(rel.slice(0, -"index.html".length))
}
const isInternal = (url) => url.startsWith("/") && !url.startsWith("//")

const broken = new Map()
for (const file of files) {
  if (!file.endsWith(".html")) continue
  const page = "/" + path.relative(DIST, file).split(path.sep).join("/")
  // 去掉 <script>…</script>：里面的 href 是模板字符串，不是静态链接
  const html = readFileSync(file, "utf8").replace(/<script[\s\S]*?<\/script>/gi, "")
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const url = match[1]
    if (!isInternal(url) || url.startsWith("/_astro/")) continue
    const clean = url.split(/[#?]/)[0]
    if (clean === "" || exists.has(clean) || exists.has(`${clean.replace(/\/$/, "")}/`)) continue
    if (!broken.has(clean)) broken.set(clean, page)
  }
}

if (broken.size > 0) {
  console.error(`✘ 站内链接审计失败：${broken.size} 个断链`)
  for (const [url, page] of broken) console.error(`  · ${url}  （首个出现于 ${page}）`)
  process.exit(1)
}
console.log(`✔ 站内链接审计通过（${files.filter((f) => f.endsWith(".html")).length} 个页面，无断链）`)
