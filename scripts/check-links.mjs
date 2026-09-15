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
 *
 * ── 为什么还要查 Markdown 产物 ─────────────────────────────────────────
 * `/llms-full.txt` 与 `/docs/<slug>.md` 是 robots.txt 里**主动推荐给 Agent 的入口**。
 * 它们直接倾倒译文原始 Markdown，不走 rehype 改写，于是曾经留着一批站内死链
 * （官方 API 参考 `/docs/v3/api`、`/docs/v4/api` 等）—— 生产 Caddy 日志里
 * GPTBot 照着 `/llms-full.txt` 里的链接抓过，拿到 404。
 * 所以这里对 Markdown 产物跑同一套可达性判断。
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { markdownLinkTargets } from "../apps/site/docs-links.mjs"

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

/** 站内链接是否指向构建产物里确实存在的路径 */
const reachable = (url) => {
  if (!isInternal(url) || url.startsWith("/_astro/")) return true
  const clean = url.split(/[#?]/)[0]
  if (clean === "") return true
  return exists.has(clean) || exists.has(`${clean.replace(/\/$/, "")}/`)
}

const broken = new Map()
for (const file of files) {
  if (!file.endsWith(".html")) continue
  const page = "/" + path.relative(DIST, file).split(path.sep).join("/")
  // 去掉 <script>…</script>：里面的 href 是模板字符串，不是静态链接
  const html = readFileSync(file, "utf8").replace(/<script[\s\S]*?<\/script>/gi, "")
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const url = match[1]
    if (reachable(url)) continue
    const clean = url.split(/[#?]/)[0]
    if (!broken.has(clean)) broken.set(clean, page)
  }
}

// Markdown 产物：/llms-full.txt 与 /docs/<slug>.md
const markdownFiles = files.filter((f) => f.endsWith(".md") || path.basename(f) === "llms-full.txt")
const mdBroken = new Map()
let mdLinks = 0
for (const file of markdownFiles) {
  const page = "/" + path.relative(DIST, file).split(path.sep).join("/")
  for (const target of markdownLinkTargets(readFileSync(file, "utf8"))) {
    if (!isInternal(target) || target.startsWith("/_astro/")) continue
    mdLinks += 1
    if (reachable(target)) continue
    const clean = target.split(/[#?]/)[0]
    if (!mdBroken.has(clean)) mdBroken.set(clean, page)
  }
}

const report = (label, map) => {
  if (map.size === 0) return false
  console.error(`✘ ${label}：${map.size} 个断链`)
  for (const [url, page] of map) console.error(`  · ${url}  （首个出现于 ${page}）`)
  return true
}

const htmlPages = files.filter((f) => f.endsWith(".html")).length
const htmlFailed = report("HTML 站内链接审计失败", broken)
const mdFailed = report("Markdown 产物站内链接审计失败", mdBroken)
if (htmlFailed || mdFailed) process.exit(1)
console.log(
  `✔ 站内链接审计通过（${htmlPages} 个页面 + ${markdownFiles.length} 个 Markdown 产物，` +
    `检查 ${mdLinks} 条 Markdown 链接，无断链）`
)
