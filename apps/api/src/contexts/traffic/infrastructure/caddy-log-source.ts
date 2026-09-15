/**
 * Traffic 上下文 · infrastructure：从宿主 Caddy 日志读访问事件。
 *
 * ── 接法 ────────────────────────────────────────────────────────────────
 * api 容器以 root 运行，compose 里把宿主日志目录**只读**挂进来即可读到：
 *   volumes: - /var/log/caddy:/var/log/caddy:ro
 * 容器里的 `ADMIN_TRAFFIC_LOG_DIR` 指向它（默认 /var/log/caddy）。
 *
 * ── 为什么读宿主的日志，而不是站点容器的 stdout ────────────────────────
 * 站内 nginx 的日志走 docker json-file 驱动，**容器一重建就清零** —— 每次部署都会。
 * 只有宿主上的 Caddy 日志是持久的、自带轮转的，是唯一可信的访问记录。
 *
 * ── 判据从哪来 ──────────────────────────────────────────────────────────
 * 探针 / 漏洞扫描 / 爬虫 / 静态资源的判据**不在这里**，在 `scripts/lib/access-log.mjs`
 * （CLI 报表与周报共用），通过 `access-log-rules.ts` 引用。本文件只做三件它不做的事：
 * 按时间窗流式读取、给爬虫命名、把 IP 换成哈希。
 */
import { createReadStream } from "node:fs"
import { readdir } from "node:fs/promises"
import { createHash } from "node:crypto"
import { createInterface } from "node:readline"
import path from "node:path"
import { Effect, Layer } from "effect"
import type { TrafficEvent, VisitorKind } from "../domain/traffic-event.js"
import { classifySource, nameCrawler } from "../domain/classify.js"
import { TrafficLog, TrafficLogUnavailable } from "../application/ports/traffic-log.js"
import { fromCaddy, isBot, isProbe, isScan, isStatic, normalizePath } from "./access-log-rules.js"

export interface CaddyLogSourceOptions {
  readonly logDir: string
  /** 日志文件名前缀；默认 effect-ts.cn.log */
  readonly filePrefix: string
  /** IP 哈希用的盐 —— 换掉它会让历史与新的访客 ID 对不上，别频繁改 */
  readonly ipSalt: string
}

/** 只保留哈希前缀：够区分访客，不够反推 IP */
export function hashVisitor(ip: string, salt: string): string {
  if (ip === "") return "unknown"
  return createHash("sha256").update(`${salt}\u0000${ip}`).digest("hex").slice(0, 12)
}

export const makeCaddyLogSource = (options: CaddyLogSourceOptions) =>
  Layer.succeed(TrafficLog)({
    readSince: (since: Date) =>
      Effect.tryPromise({
        try: () => readEvents(options, since),
        catch: (cause) =>
          new TrafficLogUnavailable({
            message: `读取访问日志失败（${options.logDir}）：${cause instanceof Error ? cause.message : String(cause)}`
          })
      })
  })

async function readEvents(
  options: CaddyLogSourceOptions,
  since: Date
): Promise<{ events: TrafficEvent[]; logFiles: number }> {
  const files = await logFiles(options)
  const sinceSeconds = since.getTime() / 1000
  const events: TrafficEvent[] = []

  for (const file of files) {
    const stream = createReadStream(file, { encoding: "utf8" })
    const reader = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })
    try {
      for await (const line of reader) {
        const event = parseLine(line, sinceSeconds, options)
        if (event !== undefined) events.push(event)
      }
    } finally {
      reader.close()
      stream.destroy()
    }
  }

  return { events, logFiles: files.length }
}

/**
 * 列出要读的日志文件。
 *
 * 含轮转备份：Caddy 的 `roll_keep 5` 会产生若干 `.log.*`，只读当前那个会**静默丢掉
 * 轮转前的历史** —— 表现是"报表里某天的数据凭空少了"，很难查。
 */
async function logFiles(options: CaddyLogSourceOptions): Promise<string[]> {
  const entries = await readdir(options.logDir).catch((cause: unknown) => {
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new Error(
      `${options.logDir} 读不到 —— 容器里挂载了吗？（compose 需要 ` +
        `${options.logDir}:${options.logDir}:ro）：${reason}`
    )
  })

  return entries
    .filter((name) => name.startsWith(options.filePrefix))
    .sort()
    .map((name) => path.join(options.logDir, name))
}

function parseLine(
  line: string,
  sinceSeconds: number,
  options: CaddyLogSourceOptions
): TrafficEvent | undefined {
  // 容器启动日志之类会混进来；Caddy 写的都是纯 JSON，但容错一下不亏
  const start = line.indexOf("{")
  if (start < 0) return undefined

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(line.slice(start)) as Record<string, unknown>
  } catch {
    return undefined // 轮转瞬间可能截断最后一行
  }

  const e = fromCaddy(raw) as {
    t?: string
    ip?: string
    m?: string
    u?: string
    s?: number
    b?: number
    rt?: number
    ref?: string
    ua?: string
  }

  const ts = Date.parse(e.t ?? "")
  if (Number.isNaN(ts) || ts / 1000 < sinceSeconds) return undefined

  const rawPath = e.u ?? ""
  const queryIndex = rawPath.indexOf("?")
  const pathOnly = queryIndex >= 0 ? rawPath.slice(0, queryIndex) : rawPath
  const pagePath = normalizePath(rawPath)
  const ua = e.ua ?? ""

  const kind: VisitorKind = isProbe(ua, pagePath)
    ? "probe"
    : isScan(pagePath)
      ? "scanner"
      : isBot(ua)
        ? "crawler"
        : "human"

  const source = classifySource(e.ref ?? "")

  return {
    at: new Date(ts),
    method: e.m ?? "",
    path: pagePath,
    status: Number(e.s ?? 0),
    durationSeconds: Number(e.rt ?? 0),
    bytes: Number(e.b ?? 0),
    visitor: hashVisitor(e.ip ?? "", options.ipSalt),
    kind,
    crawlerName: kind === "crawler" ? nameCrawler(ua) : null,
    source: source.kind,
    sourceHost: source.host,
    referer: e.ref ?? "",
    // 与 scripts/lib/access-log.mjs 的"页面"口径保持一致：
    // 静态资源与 /api/ 不算页面浏览
    isPageView: !isStatic(pagePath) && !pathOnly.startsWith("/api/")
  }
}
