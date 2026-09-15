#!/usr/bin/env node
/**
 * IndexNow 推送：把站点的 URL 主动告知参与 IndexNow 的搜索引擎
 * （Bing / Yandex / Seznam / Naver 等，见 https://www.indexnow.org/searchengines）。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 * 2026-09-15 查生产 Caddy 访问日志（`scripts/traffic-prod.sh` 的同一份数据）：
 *   Googlebot 299 次 / 245 个唯一 URL（整站抓完，294×200）
 *   GPTBot    701 次 / 307 个唯一 URL
 *   Applebot、DuckDuckBot、Baiduspider 都来过
 *   **Bingbot 0 次**
 * 于是 Bing 里搜不到这个站 —— 而 DuckDuckGo 与 ChatGPT 的联网检索都在用 Bing 索引，
 * 这条线断掉等于丢掉一大块"AI 怎么回答中文 Effect 问题"的入口。
 *
 * 之前从没提交过任何搜索引擎，也没做过外链建设，Bing 自然无从发现。
 * IndexNow 是**唯一一个不需要注册账号**的主动提交渠道：在站点根目录放一个
 * `<key>.txt`（内容就是 key）即完成归属证明，然后 POST 一批 URL 即可。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────
 *   pnpm indexnow              # 提交 sitemap 里的全部 URL
 *   pnpm indexnow -- --dry     # 只打印，不发请求
 *   pnpm indexnow -- --url https://effect-ts.cn/errors/   # 只提交一条
 *
 * 注意顺序：**先部署再推送**。搜索引擎收到通知后会去抓
 * `https://<host>/<key>.txt` 验证归属；key 文件还没上线就会被判 403。
 */
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PUBLIC_DIR = path.join(ROOT, "apps/site/public")
const SITEMAP = path.join(ROOT, "apps/site/dist/sitemap-0.xml")
const ENDPOINT = "https://api.indexnow.org/indexnow"
const MAX_PER_POST = 10000

const argv = process.argv.slice(2)
const dry = argv.includes("--dry")
// 注意 indexOf 找不到时返回 -1：不判这个就会把 argv[0]（可能是 --dry）当成 --url 的值
const urlFlag = argv.indexOf("--url")
const single = urlFlag === -1 ? undefined : argv[urlFlag + 1]
if (urlFlag !== -1 && (single === undefined || single.startsWith("--"))) {
  console.error("✘ --url 后面要跟一个完整 URL")
  process.exit(2)
}

/**
 * 找 IndexNow key：公开目录下文件名是 8–128 位十六进制、且文件内容等于文件名
 * 的那个 .txt。这样 key 只有一份事实来源（那个文件本身），不会和脚本里的常量漂移。
 */
function findKey() {
  const candidates = readdirSync(PUBLIC_DIR).filter((name) => /^[0-9a-fA-F-]{8,128}\.txt$/.test(name))
  for (const name of candidates) {
    const value = name.replace(/\.txt$/, "")
    if (readFileSync(path.join(PUBLIC_DIR, name), "utf8").trim() === value) return value
  }
  throw new Error(`在 ${PUBLIC_DIR} 里找不到合法的 IndexNow key 文件（<key>.txt 且内容等于文件名）`)
}

/** 从构建产物里取 URL —— sitemap 是站点自己的"完整页面清单"，比手写列表可靠 */
function sitemapUrls() {
  let xml
  try {
    xml = readFileSync(SITEMAP, "utf8")
  } catch {
    throw new Error(`读不到 ${SITEMAP}：请先 \`pnpm --filter @ecn/site build\`（IndexNow 提交的是最终产物里的 URL）`)
  }
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim())
}

const key = findKey()
const urls = single !== undefined ? [single] : sitemapUrls()
const host = new URL(urls[0]).host
const keyLocation = `https://${host}/${key}.txt`

console.log(`  IndexNow 主机：${host}`)
console.log(`  key 文件：${keyLocation}`)
console.log(`  待提交 URL：${urls.length} 条`)
if (dry) {
  console.log("  --dry：不发送请求。前 5 条：")
  for (const url of urls.slice(0, 5)) console.log(`    ${url}`)
  process.exit(0)
}

/** IndexNow 的状态码语义（见官方文档）：只有 200/202 算成功，其余要人看一眼 */
const EXPLAIN = {
  200: "OK，已接收",
  202: "已接收，key 校验待定",
  400: "请求格式错误",
  403: "key 无效（key 文件没上线，或内容与 key 不一致）",
  422: "URL 不属于该 host，或 key 不符合规范",
  429: "提交过于频繁"
}

let failed = 0
for (let offset = 0; offset < urls.length; offset += MAX_PER_POST) {
  const urlList = urls.slice(offset, offset + MAX_PER_POST)
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key, keyLocation, urlList })
  })
  const note = EXPLAIN[response.status] ?? "未预期的状态码"
  console.log(`  批次 ${offset / MAX_PER_POST + 1}（${urlList.length} 条）→ HTTP ${response.status} · ${note}`)
  if (response.status !== 200 && response.status !== 202) failed += 1
}

if (failed > 0) {
  console.error(`✘ ${failed} 个批次提交失败`)
  process.exit(1)
}
console.log("✔ 提交完成。搜索引擎收到通知后才会安排抓取 —— 这不是「立刻收录」，是「请来看」。")
