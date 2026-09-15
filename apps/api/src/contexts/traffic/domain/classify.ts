/**
 * Traffic 上下文 · domain：来源判定与爬虫命名。
 *
 * 判据本身（探针 / 漏洞扫描 / 爬虫 / 静态资源）**不在这里** —— 它们只有一份，
 * 在 `scripts/lib/access-log.mjs`，由 CLI 报表与周报共用，本上下文通过
 * `infrastructure/access-log-rules.ts` 那个薄壳引用。
 * 这里只负责两件 CLI 不需要、而报表需要的事：
 *   1. 把 referer 归成可读的来源类别（搜索 / 社区 / 站内 / 直连 / 其它）；
 *   2. 给爬虫**起名字** —— "GPTBot 抓了 307 个页面" 和 "有 701 次爬虫请求"
 *      是完全不同的两条信息。
 */
import type { SourceKind } from "./traffic-event.js"

/** 搜索引擎：命中即说明"我们被这个引擎的索引收录着" */
const SEARCH_ENGINES: Readonly<Record<string, string>> = {
  "www.google.com": "Google",
  "google.com": "Google",
  "www.google.com.hk": "Google",
  "www.google.cn": "Google",
  "www.baidu.com": "百度",
  "m.baidu.com": "百度",
  "www.bing.com": "Bing",
  "cn.bing.com": "Bing",
  "duckduckgo.com": "DuckDuckGo",
  "www.sogou.com": "搜狗",
  "yandex.com": "Yandex",
  "search.brave.com": "Brave",
  "www.ecosia.org": "Ecosia",
  "www.startpage.com": "Startpage",
  "search.marcia.cc": "MarciA"
}

/** 社区/平台：内容分发带来的访问 */
const COMMUNITIES: Readonly<Record<string, string>> = {
  "link.juejin.cn": "掘金",
  "juejin.cn": "掘金",
  "www.zhihu.com": "知乎",
  "zhuanlan.zhihu.com": "知乎",
  "zhihu.com": "知乎",
  "t.co": "X",
  "x.com": "X",
  "twitter.com": "X",
  "www.reddit.com": "Reddit",
  "reddit.com": "Reddit",
  "news.ycombinator.com": "Hacker News",
  "github.com": "GitHub",
  "gitee.com": "Gitee",
  "jishuzhan.net": "技术站",
  "www.jianshu.com": "简书",
  "segmentfault.com": "SegmentFault",
  "cloud.tencent.cn": "腾讯云社区",
  "cloud.tencent.com": "腾讯云社区",
  "blog.csdn.net": "CSDN",
  "www.cnblogs.com": "博客园",
  "v2ex.com": "V2EX",
  "www.v2ex.com": "V2EX",
  "mcp.so": "mcp.so",
  "smithery.ai": "Smithery",
  "glama.ai": "Glama",
  "www.pulsemcp.com": "PulseMCP",
  "mcpfind.org": "MCPFind",
  "www.npmjs.com": "npm",
  "registry.modelcontextprotocol.io": "MCP Registry"
}

/** 本站在日志里可能出现的所有主机名（含 www 与裸域） */
const SITE_HOSTS = new Set(["effect-ts.cn", "www.effect-ts.cn"])

export interface SourceInfo {
  readonly kind: SourceKind
  /** 展示用主机名：搜索引擎/社区给中文名，其它给原始 host，直连为空串 */
  readonly host: string
}

/**
 * 判定一次访问的来源。
 *
 * referer 为空 → `direct`。**注意这不等于"用户直接输入网址"**：
 * 隐私设置、App 内打开、HTTPS→HTTP 跳转、以及 Google 的 origin-only
 * referrer 策略都会把 referer 抹掉 —— 所以 `direct` 是"来源不可知"，不是"没有来源"。
 */
export function classifySource(referer: string): SourceInfo {
  if (referer === "") return { kind: "direct", host: "" }

  // 日志里**真的存在没有 scheme 的 referer**（实测有 `www.google.com` 这种形态），
  // 而 `new URL("www.google.com")` 会直接抛 —— 早先因此把搜索引擎的访问全判成了 `other`。
  // 补一次带 scheme 的解析，别让一个格式问题吞掉"我们被 Google 收录着"这条信息。
  const parsed = parseReferer(referer)
  if (parsed === undefined) {
    // 彻底解析不了（畸形值）——归到 other，但不要因此丢掉这次访问
    return { kind: "other", host: referer.slice(0, 60) }
  }

  const host = parsed.hostname.toLowerCase()
  if (SITE_HOSTS.has(host)) return { kind: "internal", host }

  const engine = SEARCH_ENGINES[host]
  if (engine !== undefined) return { kind: "search", host: engine }

  const community = COMMUNITIES[host]
  if (community !== undefined) return { kind: "social", host: community }

  return { kind: "other", host }
}

/** 解析 referer；没有 scheme 时补 `https://` 再试一次 */
function parseReferer(referer: string): URL | undefined {
  try {
    return new URL(referer)
  } catch {
    try {
      return new URL(`https://${referer}`)
    } catch {
      return undefined
    }
  }
}

/** 爬虫命名表：**顺序有意义**，先匹配更具体的（Googlebot 早于通用 bot 判据） */
const CRAWLER_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/Googlebot-Image/i, "Googlebot-Image"],
  [/Googlebot/i, "Googlebot"],
  [/GoogleOther/i, "GoogleOther"],
  [/Google-InspectionTool|Google-InspectionTool-Desktop/i, "Google 检查工具"],
  [/Storebot-Google/i, "Storebot"],
  [/bingbot/i, "Bingbot"],
  [/Baiduspider/i, "Baiduspider"],
  [/YandexBot/i, "YandexBot"],
  [/DuckDuckBot/i, "DuckDuckBot"],
  [/Applebot/i, "Applebot"],
  [/GPTBot/i, "GPTBot（OpenAI 训练）"],
  [/OAI-SearchBot/i, "OAI-SearchBot（ChatGPT 检索）"],
  [/ChatGPT-User/i, "ChatGPT-User"],
  [/ClaudeBot|Claude-Web|anthropic-ai/i, "ClaudeBot"],
  [/PerplexityBot/i, "PerplexityBot"],
  [/Bytespider/i, "Bytespider"],
  [/Amazonbot/i, "Amazonbot"],
  [/meta-externalagent/i, "Meta"],
  [/MJ12bot/i, "MJ12bot"],
  [/AhrefsBot/i, "AhrefsBot"],
  [/SemrushBot/i, "SemrushBot"],
  [/DotBot/i, "DotBot"],
  [/Sogou web spider/i, "Sogou"],
  [/360Spider|HaosouSpider/i, "360Spider"]
]

/**
 * 给爬虫起个名字；认不出来就给个兜底名，而不是 null ——
 * 报表里出现一堆"未知爬虫"时，应该能一眼看出它确实是个爬虫。
 */
export function nameCrawler(userAgent: string): string {
  for (const [pattern, name] of CRAWLER_NAMES) {
    if (pattern.test(userAgent)) return name
  }
  return "其它爬虫"
}
