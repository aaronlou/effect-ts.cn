/**
 * Effect 中文知识层 · MCP Server（stdio 传输）
 *
 * 为什么手写 JSON-RPC 而不引第三方 SDK：
 * - MCP 的 stdio 传输就是"按行分隔的 JSON-RPC 2.0"，我们需要的方法只有
 *   initialize / tools/list / tools/call / ping —— 约 150 行即可，且**完全可测**；
 * - 少一个依赖，Agent 侧 `npx` 更轻、更快；Effect v4 稳定后可直接换成官方 McpServer。
 *
 * 工具集刻意与 HTTP `/api/knowledge/*` 对齐：同一份语料、同一套引用与拒答语义。
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  composeAnswer,
  corpus,
  createCorpusIndex,
  createTopicRouter,
  type AskResult
} from "@ecn/knowledge"

const PROTOCOL_VERSION = "2024-11-05"
const SERVER_INFO = { name: "effect-ts-cn", version: "0.1.0" }

const index = createCorpusIndex(corpus)
const router = createTopicRouter(corpus.pages, corpus.pending)

interface JsonRpcRequest {
  readonly jsonrpc: "2.0"
  readonly id?: string | number | null
  readonly method: string
  readonly params?: Record<string, unknown>
}

interface JsonRpcResponse {
  readonly jsonrpc: "2.0"
  readonly id: string | number | null
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string }
}

const TOOLS = [
  {
    name: "search_docs",
    description:
      "在 effect-ts.cn 的**中文** Effect 文档中做关键词检索，返回最相关的页面与小节（含官方原文链接）。未翻译的官方页面也会被列出。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "中文或英文关键词，例如「Layer 依赖注入」或「Effect.gen」" },
        limit: { type: "number", description: "返回条数，默认 5" },
        version: { type: "string", enum: ["v3", "v4"], description: "限定版本，默认 v4 优先" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_page",
    description:
      "取回某一页中文译文的完整 Markdown（含上游文件路径与基线 commit）。slug 形如 v4/getting-started/installation。",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"]
    }
  },
  {
    name: "ask",
    description:
      "就中文 Effect 文档提问。返回带引用的回答；若站内没有依据或该页尚未翻译，会明确拒答（citations 为空）。",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        scope: { type: "string", description: "限定到某一页（可选），如 v4/getting-started/installation" }
      },
      required: ["question"]
    }
  },
  {
    name: "glossary",
    description: "返回社区术语表：哪些术语保留英文、以及 CI 门禁禁止的译法。",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "translation_status",
    description:
      "查询某页或全部页面的翻译状态（已翻译/未翻译、上游基线、是否落后）。不传 slug 则返回总体统计。",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string", description: "可选；省略则返回总体统计" } }
    }
  }
] as const

function text(content: string): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: "text", text: content }] }
}

function askToText(result: AskResult): string {
  if (result.refused) {
    const lines = [`【拒答】${result.refusal?.reason === "untranslated" ? "该主题的中文译文尚未提供" : "站内没有找到依据"}`, "", result.refusal?.message ?? ""]
    for (const suggestion of result.refusal?.suggestions ?? []) {
      lines.push(`- ${suggestion.title}: ${suggestion.officialUrl} (${suggestion.slug})`)
    }
    return lines.join("\n")
  }
  const lines = [result.answer, "", "引用："]
  for (const citation of result.citations) {
    const anchor = citation.anchor !== undefined ? `#${citation.anchor}` : ""
    lines.push(`- 《${citation.title}》 ${citation.url}${anchor}（基线 ${citation.commit?.slice(0, 7) ?? "未标注"}）`)
  }
  lines.push("", result.disclaimer)
  return lines.join("\n")
}

async function glossaryText(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "docs/glossary.json"),
    path.resolve(process.cwd(), "../../docs/glossary.json"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/glossary.json")
  ]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await readFile(candidate, "utf8")) as {
        forbidden?: ReadonlyArray<{ term: string; preferred?: string; note?: string }>
      }
      const lines = ["# 术语门禁（禁用译法）"]
      for (const rule of parsed.forbidden ?? []) {
        lines.push(`- ${rule.term} → ${rule.preferred ?? "保留英文"}${rule.note !== undefined ? `（${rule.note}）` : ""}`)
      }
      lines.push("", "# 原则", "核心术语保留英文（Effect / Layer / Fiber / Schema / Stream 等），首次出现可加中文解释。")
      return lines.join("\n")
    } catch {
      // 继续尝试下一个候选路径
    }
  }
  return "# 术语门禁\n- 纤维 → Fiber\n- 图层 → Layer\n- 效果系统 → Effect"
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "search_docs": {
      const query = String(args["query"] ?? "")
      const limit = typeof args["limit"] === "number" ? args["limit"] : 5
      const version = typeof args["version"] === "string" ? args["version"] : undefined
      const hits = index.search(query, {
        limit,
        ...(version !== undefined ? { version } : {})
      })
      if (hits.length === 0) {
        // 与 HTTP 侧一致：用话题归属判断"是没内容，还是中文还没翻译"
        const routed = router.route(query)
        if (routed.kind === "pending") {
          return [
            "中文文档中没有匹配；但官方有以下相关页面（中文尚未翻译）：",
            ...routed.pages.map((page) => `- ${page.title}: ${page.officialUrl}`)
          ].join("\n")
        }
        return "中文文档中没有匹配结果。可尝试：换用更具体的 API 名（如 Effect.gen / Layer），或用 ask 工具直接提问。"
      }
      return hits
        .map((hit) => {
          const section = hit.chunk.headingPath.filter((part) => part.length > 0).join(" › ")
          const anchor = hit.chunk.anchor !== undefined ? `#${hit.chunk.anchor}` : ""
          return `- 《${hit.page.title}》${section !== "" ? ` › ${section}` : ""} ${hit.page.url}${anchor}\n  官方原文：${hit.page.officialUrl}`
        })
        .join("\n")
    }
    case "get_page": {
      const slug = String(args["slug"] ?? "")
      const page = corpus.pages.find((candidate) => candidate.slug === slug)
      if (page === undefined) {
        const pending = corpus.pending.find((candidate) => candidate.slug === slug)
        return pending !== undefined
          ? `该页尚无中文译文。官方原文：${pending.officialUrl}`
          : `未找到页面：${slug}`
      }
      return [
        `# ${page.title}`,
        "",
        `<!-- 上游：${page.upstreamPath ?? "未标注"} · 基线：${page.upstreamCommit ?? "未标注"} · 状态：${page.status} -->`,
        `<!-- 站内：https://effect-ts.cn${page.url} · 官方原文：${page.officialUrl} -->`,
        "",
        page.markdown
      ].join("\n")
    }
    case "ask": {
      const question = String(args["question"] ?? "")
      const scope = typeof args["scope"] === "string" ? args["scope"] : undefined
      const routed = router.route(question)
      const hits = index.search(question, {
        limit: 5,
        maxPerPage: scope !== undefined ? 3 : 1,
        ...(scope !== undefined ? { scopeSlug: scope } : {}),
        ...(routed.kind === "translated" ? { boostSlugs: routed.slugs } : {})
      })
      return askToText(
        composeAnswer({ question, hits, pending: corpus.pending, options: { router } })
      )
    }
    case "glossary":
      return glossaryText()
    case "translation_status": {
      const slug = typeof args["slug"] === "string" ? args["slug"] : undefined
      if (slug === undefined) {
        return [
          `已翻译：${corpus.stats.pages} 篇 / ${corpus.stats.chunks} 个切片`,
          `未翻译：${corpus.stats.pendingPages} 个官方页面`,
          `上游基线：${corpus.stats.upstreamHead ?? "未标注"}`,
          `语料生成时间：${corpus.generatedAt}`
        ].join("\n")
      }
      const page = corpus.pages.find((candidate) => candidate.slug === slug)
      if (page !== undefined) {
        return `已翻译：《${page.title}》状态=${page.status}，基线=${page.upstreamCommit ?? "未标注"}，站内 ${page.url}`
      }
      const pending = corpus.pending.find((candidate) => candidate.slug === slug)
      return pending !== undefined
        ? `未翻译：${pending.title}（${pending.sectionLabel}）官方原文 ${pending.officialUrl}`
        : `未找到页面：${slug}`
    }
    default:
      return `未知工具：${name}`
  }
}

/** 处理单条 JSON-RPC 消息；通知（无 id）返回 undefined */
export async function handleMessage(message: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
  const id = message.id ?? null
  switch (message.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO
        }
      }
    case "notifications/initialized":
    case "notifications/cancelled":
      return undefined
    case "ping":
      return { jsonrpc: "2.0", id, result: {} }
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } }
    case "tools/call": {
      const params = message.params ?? {}
      const name = String(params["name"] ?? "")
      const args = (params["arguments"] as Record<string, unknown> | undefined) ?? {}
      const output = await callTool(name, args)
      return { jsonrpc: "2.0", id, result: text(output) }
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${message.method}` } }
  }
}

/** 逐行读取 JSON-RPC 并把响应写回；返回一个可等待的 Promise（stdin 结束时 resolve） */
export function serveStdio(options?: {
  readonly input?: NodeJS.ReadableStream
  readonly output?: NodeJS.WritableStream
}): Promise<void> {
  const input = options?.input ?? process.stdin
  const output = options?.output ?? process.stdout
  let buffer = ""

  return new Promise<void>((resolve) => {
    input.setEncoding?.("utf8")
    input.on("data", (chunk: string) => {
      buffer += chunk
      let newlineIndex = buffer.indexOf("\n")
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf("\n")
        if (line === "") continue
        void (async () => {
          try {
            const parsed = JSON.parse(line) as JsonRpcRequest
            const response = await handleMessage(parsed)
            if (response !== undefined) output.write(`${JSON.stringify(response)}\n`)
          } catch (error) {
            output.write(
              `${JSON.stringify({
                jsonrpc: "2.0",
                id: null,
                error: { code: -32700, message: `Parse error: ${String(error)}` }
              })}\n`
            )
          }
        })()
      }
    })
    input.on("end", () => resolve())
  })
}
