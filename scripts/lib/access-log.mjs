/**
 * 访问日志解析（**共享**给 traffic-report 与 usage-report）。
 *
 * 为什么抽出来：周报要同时回答"有多少人来了"（访问日志）与"AI 被用了多少次、答得准不准"
 * （用量账本）。两个脚本各自实现一遍 Caddy 字段映射，早晚会出现"同一份日志两个数字"。
 * 字段映射与探针/扫描器/爬虫的判据只允许有一份。
 *
 * 日志格式：Caddy 的结构化 JSON（`d.request` 那一层），见 infra/Caddyfile.effect-ts.cn。
 */

/** 健康检查与探针：它们会以固定频率打首页，会把"页面浏览"整体带偏 */
export const isProbe = (ua, path) =>
  /^(Wget|curl|kube-probe|ELB-HealthChecker|GoogleHC|UptimeRobot)/i.test(ua ?? "") ||
  path === "/api/health" ||
  path === "/healthz"

/**
 * **漏洞扫描器**（不是搜索引擎爬虫，是来找 `.env`、`.git/config`、`phpmyadmin` 的）。
 *
 * 公开站点被扫是常态，不是事故 —— 但如果不识别，`/.env`、`/.git/config` 这类路径
 * 会把"页面浏览 Top"占满，让报表看起来比实际糟得多。
 * 所以**不隐藏，而是单独计数**：被扫了多少次本身是有用信息。
 */
export const isScan = (path) =>
  /^\/\.(env|git|aws|ssh|npmrc|netrc|docker|travis|svn|hg|bash_history|DS_Store|well-known\/security)/i.test(
    path
  ) ||
  /(wp-login|wp-admin|xmlrpc|phpmyadmin|phpunit|actuator|cgi-bin|vendor\/phpunit|solr\/admin|console\/login|druid|jenkins|gitlab-runner|config\.toml|docker-compose\.ya?ml|ci\.env|\.gitlab-ci)/i.test(
    path
  )

/**
 * 常见爬虫与**脚本/扫描器**（粗判，够用即可：报表里单独列一行，不计入"访客"）。
 *
 * 后一组是实测补上的：生产日志里被判成"人类访客"的请求中，出现频率最高的几类
 * 其实是机器 —— `fasthttp`（Go 的 HTTP 库，浏览器不用它）、`Mozlila/5.0`
 * （**Mozilla 的经典拼错**，扫描器指纹）、`okhttp`。
 * 不补它们，报表会显示"43 个独立访客"，而真实的读者只有个位数 ——
 * **一个把 3 个人报成 43 个人的仪表盘比没有仪表盘更糟**。
 */
export const isBot = (ua) =>
  /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|python-requests|headlesschrome|Go-http-client|axios|node-fetch|Deno|fasthttp|Mozlila|okhttp|libwww|zgrab|masscan|nmap|Censys|ShadowServer|InternetMeasurement/i.test(
    ua ?? ""
  )

export const normalizePath = (u) => {
  const p = u.split("?")[0]
  // 把文档页归一到目录形式，避免 /docs/x 与 /docs/x/ 被算成两个页面
  if (/^\/docs\/[^.]+\/?$/.test(p) && !p.endsWith("/")) return `${p}/`
  return p
}

export const isStatic = (p) =>
  /^\/_astro\//.test(p) || /\.(css|js|mjs|png|jpe?g|svg|webp|avif|ico|woff2?|ttf|map)$/i.test(p)

/**
 * 把**两种**访问日志统一成报表内部的形状。
 *
 * 为什么不只用一种：两份日志各有各的用处，而且都不是可选项 ——
 *   · **Caddy（宿主）**：站点最外层，看到真实客户端 IP；**不随容器重建消失**；自带轮转。
 *   · **nginx（容器 stdout）**：容器一重建就清零，但调试反代链路时有用。
 */
export const fromCaddy = (d) =>
  d.request !== undefined
    ? {
        t: new Date((d.ts ?? 0) * 1000).toISOString(),
        ip: d.request.client_ip ?? d.request.remote_ip ?? "",
        m: d.request.method ?? "",
        u: d.request.uri ?? "",
        s: d.status ?? 0,
        b: d.size ?? 0,
        rt: d.duration ?? 0,
        ref: d.request.headers?.Referer?.[0] ?? "",
        ua: d.request.headers?.["User-Agent"]?.[0] ?? "",
        host: d.request.host ?? ""
      }
    : d

export const emptyStats = () => ({
  total: 0,
  human: 0,
  probe: 0,
  scan: 0,
  bot: 0,
  pages: new Map(),
  status: new Map(),
  referrers: new Map(),
  ips: new Map(),
  ai: { ask: 0, explain: 0, stats: 0 },
  /** Agent 面：静态语料端点被取了多少次（"被 Agent 消费"的粗指标） */
  agent: { llms: 0, llmsFull: 0, docsMd: 0, cite: 0 },
  slow: []
})

const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1)

/**
 * 遍历日志行 → 统计。
 *
 * 传入的应当是**行流**（`AsyncIterable<string>`）：生产日志可能几十万行，
 * 一次性读进内存不是个好习惯。
 */
export async function summarize(lines) {
  const stats = emptyStats()

  for await (const line of lines) {
    const start = line.indexOf("{")
    if (start < 0) continue
    let raw
    try {
      raw = JSON.parse(line.slice(start))
    } catch {
      continue // 非 JSON 行（例如容器启动日志）直接跳过
    }
    const e = fromCaddy(raw)
    const path = normalizePath(e.u ?? "")
    const ua = e.ua ?? ""
    stats.total += 1
    bump(stats.status, String(e.s))

    // AI 调用**先记账再过滤**：它直接对应 token 成本，**不管调用者是浏览器、爬虫还是脚本**
    // （Agent 用 curl 调也是花钱的）。放进"人类访客"之后再数，就会漏掉真实成本。
    if (path === "/api/knowledge/ask") stats.ai.ask += 1
    if (path === "/api/knowledge/explain") stats.ai.explain += 1
    if (path === "/api/knowledge/stats") stats.ai.stats += 1

    // Agent 面同理：这几类端点的消费者本来就是机器
    if (path === "/llms.txt") stats.agent.llms += 1
    if (path === "/llms-full.txt") stats.agent.llmsFull += 1
    if (/^\/docs\/.+\.md$/.test(path)) stats.agent.docsMd += 1
    if (path.startsWith("/cite/")) stats.agent.cite += 1

    if (isProbe(ua, path)) {
      stats.probe += 1
      continue
    }
    if (isScan(path)) {
      stats.scan += 1
      continue
    }
    if (isBot(ua)) {
      stats.bot += 1
      continue
    }
    stats.human += 1

    if (!isStatic(path) && !path.startsWith("/api/")) {
      bump(stats.pages, path)
      if (e.ip) bump(stats.ips, e.ip)
    }
    if (e.ref && !/effect-ts\.cn/.test(e.ref)) bump(stats.referrers, e.ref)
    if (Number(e.rt) > 2) stats.slow.push({ path, rt: Number(e.rt), s: e.s })
  }

  return stats
}

export const top = (map, n = 15) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
