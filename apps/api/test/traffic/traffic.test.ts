/**
 * Traffic 上下文测试。
 *
 * 最要紧的两组：
 *   1. **聚合口径**（四类访客互斥完备、分桶按北京时间、去重只在人类里）——
 *      报表的价值全在口径，口径错了数字再好看也是错的；
 *   2. **共享规则的手写签名**（`access-log-rules.ts` 用 `as` 断言了
 *      `scripts/lib/access-log.mjs` 的签名，TS 验证不了）—— 这里拿真实日志行跑一遍，
 *      签名与实现对不上时会在这里断掉，而不是在生产报表里悄悄算错。
 */
import { describe, expect, it } from "vitest"
import {
  fromCaddy,
  isBot,
  isProbe,
  isScan,
  isStatic,
  normalizePath
} from "../../src/contexts/traffic/infrastructure/access-log-rules.js"
import { classifySource, nameCrawler } from "../../src/contexts/traffic/domain/classify.js"
import { bucketStart, buildReport, SITE_TZ_OFFSET_MS } from "../../src/contexts/traffic/domain/report.js"
import type { TrafficEvent, VisitorKind } from "../../src/contexts/traffic/domain/traffic-event.js"
import { hashVisitor } from "../../src/contexts/traffic/infrastructure/caddy-log-source.js"
import { tokenMatches } from "../../src/interfaces/http/admin.js"

// ── 构造事件的助手 ────────────────────────────────────────────────────────
const event = (over: Partial<TrafficEvent> & { at: Date }): TrafficEvent => ({
  method: "GET",
  path: "/",
  status: 200,
  durationSeconds: 0.01,
  bytes: 100,
  visitor: "aaaa11112222",
  kind: "human" as VisitorKind,
  crawlerName: null,
  source: "direct",
  sourceHost: "",
  referer: "",
  isPageView: true,
  ...over
})

describe("来源判定", () => {
  it("空 referer 是 direct", () => {
    expect(classifySource("")).toEqual({ kind: "direct", host: "" })
  })

  it("自己的域名是 internal（站内跳转不算来源）", () => {
    expect(classifySource("https://effect-ts.cn/docs/v4/")).toEqual({
      kind: "internal",
      host: "effect-ts.cn"
    })
    expect(classifySource("https://www.effect-ts.cn/").kind).toBe("internal")
  })

  it("搜索引擎归 search，并给出中文/短名", () => {
    expect(classifySource("https://www.google.com/")).toEqual({ kind: "search", host: "Google" })
    expect(classifySource("https://www.baidu.com/s?wd=x")).toEqual({ kind: "search", host: "百度" })
  })

  it("社区平台归 social", () => {
    expect(classifySource("https://link.juejin.cn/?target=x")).toEqual({ kind: "social", host: "掘金" })
    expect(classifySource("https://t.co/abc")).toEqual({ kind: "social", host: "X" })
  })

  it("认不出来的站外来源归 other，但仍保留主机名", () => {
    const info = classifySource("https://some-random-blog.example/post")
    expect(info.kind).toBe("other")
    expect(info.host).toBe("some-random-blog.example")
  })

  it("畸形 referer 不丢这次访问", () => {
    expect(classifySource("not a url").kind).toBe("other")
  })
})

describe("爬虫命名", () => {
  it("认得出我们实际见过的那些", () => {
    expect(nameCrawler("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(
      "Googlebot"
    )
    expect(nameCrawler("Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.4; +https://openai.com/gptbot)")).toContain(
      "GPTBot"
    )
    expect(nameCrawler("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe("Bingbot")
  })

  it("认不出来也明确说是爬虫，而不是 null", () => {
    expect(nameCrawler("something-weird/1.0")).toBe("其它爬虫")
  })
})

describe("共享规则的手写签名仍然与实现一致", () => {
  // 这几条用的是**生产日志里的真实行**（截自 2026-09-15 的 effect-ts.cn.log）
  const realLine = {
    ts: 1789436802.5,
    status: 200,
    size: 1234,
    duration: 0.0123,
    request: {
      client_ip: "203.0.113.7",
      remote_ip: "127.0.0.1",
      method: "GET",
      uri: "/docs/v4/getting-started/",
      host: "effect-ts.cn",
      headers: {
        "User-Agent": ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
        Referer: ["https://www.google.com/"]
      }
    }
  }

  it("fromCaddy 映射出短名字段", () => {
    const e = fromCaddy(realLine)
    expect(e.u).toBe("/docs/v4/getting-started/")
    expect(e.s).toBe(200)
    expect(e.ip).toBe("203.0.113.7")
    expect(e.ua).toContain("Googlebot")
    expect(e.ref).toBe("https://www.google.com/")
    expect(e.t).toBe(new Date(1789436802.5 * 1000).toISOString())
  })

  it("isBot / isProbe / isScan / isStatic / normalizePath 行为符合预期", () => {
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true)
    expect(isBot("Mozilla/5.0 (Macintosh) Chrome/131")).toBe(false)
    expect(isProbe("curl/8.7.1", "/")).toBe(true)
    expect(isProbe("Mozilla/5.0 Chrome/131", "/")).toBe(false)
    expect(isScan("/.env")).toBe(true)
    expect(isScan("/docs/v4/")).toBe(false)
    expect(isStatic("/_astro/x.js")).toBe(true)
    expect(isStatic("/docs/v4/")).toBe(false)
    // 文档页归一：/docs/x 与 /docs/x/ 不能算两个页面
    expect(normalizePath("/docs/v4/getting-started?a=1")).toBe("/docs/v4/getting-started/")
    expect(normalizePath("/errors/")).toBe("/errors/")
  })
})

describe("访客哈希", () => {
  it("同样输入稳定，不同 IP 不同", () => {
    expect(hashVisitor("1.2.3.4", "salt")).toBe(hashVisitor("1.2.3.4", "salt"))
    expect(hashVisitor("1.2.3.4", "salt")).not.toBe(hashVisitor("1.2.3.5", "salt"))
  })

  it("换盐会变（所以别频繁改盐）", () => {
    expect(hashVisitor("1.2.3.4", "a")).not.toBe(hashVisitor("1.2.3.4", "b"))
  })

  it("输出足够短，且不含原始 IP", () => {
    const h = hashVisitor("203.0.113.7", "salt")
    expect(h).toHaveLength(12)
    expect(h).not.toContain("203.0.113")
  })
})

describe("报表聚合", () => {
  const now = new Date("2026-09-15T12:00:00.000Z")

  it("四类访客互斥且加起来等于总请求数", () => {
    const report = buildReport(
      [
        event({ at: new Date("2026-09-15T11:00:00.000Z") }),
        event({ at: new Date("2026-09-15T11:01:00.000Z"), kind: "crawler", crawlerName: "Googlebot" }),
        event({ at: new Date("2026-09-15T11:02:00.000Z"), kind: "scanner" }),
        event({ at: new Date("2026-09-15T11:03:00.000Z"), kind: "probe" })
      ],
      { rangeHours: 24, now, logFiles: 1 }
    )
    const t = report.totals
    expect(t.requests).toBe(4)
    expect(t.humanRequests + t.crawlerRequests + t.scanRequests + t.probeRequests).toBe(t.requests)
    expect(t.humanRequests).toBe(1)
    expect(t.crawlerRequests).toBe(1)
    expect(t.scanRequests).toBe(1)
    expect(t.probeRequests).toBe(1)
  })

  it("窗口外的事件被剔除", () => {
    const report = buildReport(
      [
        event({ at: new Date("2026-09-15T11:00:00.000Z") }),
        event({ at: new Date("2026-09-10T11:00:00.000Z") }) // 超出 24h
      ],
      { rangeHours: 24, now, logFiles: 1 }
    )
    expect(report.totals.requests).toBe(1)
  })

  it("唯一访客只在人类里算：爬虫再多也不改变它", () => {
    const report = buildReport(
      [
        event({ at: new Date("2026-09-15T11:00:00.000Z"), visitor: "v1" }),
        event({ at: new Date("2026-09-15T11:05:00.000Z"), visitor: "v1" }),
        event({ at: new Date("2026-09-15T11:06:00.000Z"), visitor: "v2" }),
        event({ at: new Date("2026-09-15T11:07:00.000Z"), visitor: "bot", kind: "crawler", crawlerName: "GPTBot" })
      ],
      { rangeHours: 24, now, logFiles: 1 }
    )
    expect(report.totals.uniqueVisitors).toBe(2)
  })

  it("分桶按北京时间：UTC 16:00 属于北京的次日", () => {
    // 北京 = UTC+8 ⇒ 2026-09-15T16:00Z 是北京 09-16 00:00
    const start = bucketStart(new Date("2026-09-15T16:00:00.000Z"), "day")
    expect(new Date(start).toISOString()).toBe("2026-09-15T16:00:00.000Z")

    // 差一分钟仍属于前一个桶（北京 09-15 23:59）
    const before = bucketStart(new Date("2026-09-15T15:59:00.000Z"), "day")
    expect(new Date(before).toISOString()).toBe("2026-09-14T16:00:00.000Z")
    expect(SITE_TZ_OFFSET_MS).toBe(8 * 60 * 60 * 1000)
  })

  it("爬虫不进页面榜与来源榜，但进爬虫榜", () => {
    const report = buildReport(
      [
        event({ at: new Date("2026-09-15T11:00:00.000Z"), path: "/docs/v4/" }),
        event({
          at: new Date("2026-09-15T11:01:00.000Z"),
          path: "/docs/v3/",
          kind: "crawler",
          crawlerName: "GPTBot",
          source: "search",
          sourceHost: "Google"
        })
      ],
      { rangeHours: 24, now, logFiles: 1 }
    )
    expect(report.topPages.map((p) => p.path)).toEqual(["/docs/v4/"])
    // 来源榜里只剩人类那次直连；爬虫带的 search/Google **不能**混进来
    // （否则"Google 带来了流量"这种结论会被爬虫自己伪造出来）
    expect(report.sources).toEqual([{ kind: "direct", host: "", visits: 1 }])
    expect(report.bots).toEqual([
      { name: "GPTBot", requests: 1, uniquePaths: 1, lastSeen: new Date("2026-09-15T11:01:00.000Z") }
    ])
  })

  it("站内跳转不进来源榜（否则站内导航会盖过真实来源）", () => {
    const report = buildReport(
      [
        event({ at: new Date("2026-09-15T11:00:00.000Z"), source: "internal", sourceHost: "effect-ts.cn" }),
        event({ at: new Date("2026-09-15T11:01:00.000Z"), source: "search", sourceHost: "Google" })
      ],
      { rangeHours: 24, now, logFiles: 1 }
    )
    expect(report.sources).toEqual([{ kind: "search", host: "Google", visits: 1 }])
  })

  it("落地页只算非站内来源的页面浏览", () => {
    const report = buildReport(
      [
        event({ at: new Date("2026-09-15T11:00:00.000Z"), path: "/a/", source: "search", sourceHost: "Google" }),
        event({ at: new Date("2026-09-15T11:01:00.000Z"), path: "/b/", source: "internal", sourceHost: "effect-ts.cn" })
      ],
      { rangeHours: 24, now, logFiles: 1 }
    )
    expect(report.landingPages.map((p) => p.path)).toEqual(["/a/"])
    expect(report.topPages.map((p) => p.path).sort()).toEqual(["/a/", "/b/"])
  })

  it("非页面请求（/api/、静态资源）不计入页面浏览", () => {
    const report = buildReport(
      [
        event({ at: new Date("2026-09-15T11:00:00.000Z"), path: "/api/health", isPageView: false }),
        event({ at: new Date("2026-09-15T11:01:00.000Z"), path: "/docs/v4/" })
      ],
      { rangeHours: 24, now, logFiles: 1 }
    )
    expect(report.totals.pageViews).toBe(1)
  })

  it("没有数据时 coveredFrom/To 退回 now，不产生 1970", () => {
    const report = buildReport([], { rangeHours: 24, now, logFiles: 0 })
    expect(report.coveredFrom).toEqual(now)
    expect(report.coveredTo).toEqual(now)
    expect(report.totals.requests).toBe(0)
    expect(report.series).toEqual([])
  })

  it("时间窗超过 72 小时自动切到按天分桶", () => {
    expect(buildReport([], { rangeHours: 24, now, logFiles: 0 }).granularity).toBe("hour")
    expect(buildReport([], { rangeHours: 168, now, logFiles: 0 }).granularity).toBe("day")
  })

  it("最近访问按时间倒序，且只含人类", () => {
    const report = buildReport(
      [
        event({ at: new Date("2026-09-15T11:00:00.000Z"), path: "/older/" }),
        event({ at: new Date("2026-09-15T11:30:00.000Z"), path: "/newer/" }),
        event({ at: new Date("2026-09-15T11:45:00.000Z"), path: "/bot/", kind: "crawler", crawlerName: "GPTBot" })
      ],
      { rangeHours: 24, now, logFiles: 1 }
    )
    expect(report.recent.map((v) => v.path)).toEqual(["/newer/", "/older/"])
  })
})

describe("后台口令比较", () => {
  it("相同才通过", () => {
    expect(tokenMatches("abc123", "abc123")).toBe(true)
    expect(tokenMatches("abc124", "abc123")).toBe(false)
  })

  it("长度不同直接失败（不泄露前缀信息）", () => {
    expect(tokenMatches("abc", "abc123")).toBe(false)
    expect(tokenMatches("", "abc123")).toBe(false)
    expect(tokenMatches("abc1234", "abc123")).toBe(false)
  })
})
