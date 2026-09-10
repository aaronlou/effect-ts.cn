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
  buildCitationRecords,
  composeAnswer,
  corpus,
  createCorpusIndex,
  createTopicRouter,
  findCitationRecord,
  type AskResult,
  type CorpusPage
} from "@ecn/knowledge"

const PROTOCOL_VERSION = "2024-11-05"
const SERVER_INFO = { name: "effect-ts-cn", version: "0.1.0" }

const index = createCorpusIndex(corpus)
const router = createTopicRouter(corpus.pages, corpus.pending)
const citations = buildCitationRecords(corpus)
const pagesBySlug = new Map(corpus.pages.map((page) => [page.slug, page]))

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
  },
  {
    name: "cite",
    description:
      "解析并核验一条引用：给出规范化引用 ID、可解引用地址（/cite/<digest>.json）、原文片段、内容指纹、上游基线与官方原文地址。用途：独立核对某条引用是否仍成立、是否已漂移 —— 不要凭记忆判断引用是否过期。",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "引用 key：digest、`slug#anchor`、或完整 citationId（如 ecn:v4/error-management/unexpected-errors@16b1646#catchdefect）"
        }
      },
      required: ["key"]
    }
  }
] as const

/** 资源：把"可读内容"直接暴露成可订阅的地址，而不是只能靠工具调用 */
const RESOURCES = [
  ...corpus.pages.map((page) => ({
    uri: `effect-cn://docs/${page.slug}`,
    name: page.slug,
    title: `《${page.title}》（中文译文，基线 ${page.upstreamCommit?.slice(0, 7) ?? "未标注"}）`,
    mimeType: "text/markdown",
    description: `镜像官方 ${page.upstreamPath ?? page.slug}；站内 ${page.url}`
  })),
  {
    uri: "effect-cn://citations",
    name: "citations",
    title: `引用索引（${citations.length} 条可解引用证据）`,
    mimeType: "application/json",
    description:
      "本站全部可引用证据的清单：每条含 citationId、/cite/<digest>.json 地址、页面与小节锚点。"
  }
] as const

/** 提示词：把"这个社区的工作流"固化成可复用指令，而不是让每个 Agent 自己猜 */
const PROMPTS = [
  {
    name: "translate_page",
    description:
      "把某一页官方文档译成中文，并产出**可审阅的提案**（写入 .proposals/），而不是直接落盘发布。",
    arguments: [
      { name: "slug", description: "官方页面路径，如 v4/error-management/fallback", required: true }
    ]
  },
  {
    name: "answer_with_evidence",
    description:
      "用本站中文文档回答问题：必须带可核验引用（citationId + citeUrl），没有依据就拒答。",
    arguments: [{ name: "question", description: "要问的问题", required: true }]
  },
  {
    name: "review_proposal",
    description: "审阅一条提案：核对代码块逐字一致、术语、引用锚点，并给出可执行的修改意见。",
    arguments: [{ name: "id", description: "提案 id（.proposals/<id>.json）", required: false }]
  }
] as const

function text(content: string): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: "text", text: content }] }
}

/** 页面 → Markdown（带 provenance 头）；get_page 工具与资源读取共用同一份输出 */
function pageMarkdown(page: CorpusPage): string {
  return [
    `# ${page.title}`,
    "",
    `<!-- 上游：${page.upstreamPath ?? "未标注"} · 基线：${page.upstreamCommit ?? "未标注"} · 状态：${page.status} -->`,
    `<!-- 站内：https://effect-ts.cn${page.url} · 官方原文：${page.officialUrl} -->`,
    "",
    page.markdown
  ].join("\n")
}

function askToText(result: AskResult): string {
  if (result.refused) {
    const lines = [`【拒答】${result.refusal?.reason === "untranslated" ? "该主题的中文译文尚未提供" : "站内没有找到依据"}`, "", result.refusal?.message ?? ""]
    for (const suggestion of result.refusal?.suggestions ?? []) {
      lines.push(`- ${suggestion.title}: ${suggestion.officialUrl} (${suggestion.slug})`)
    }
    const related = result.refusal?.relatedPages ?? []
    if (related.length > 0) {
      lines.push("", "最接近的站内页面（不构成引用，仅供参考）：")
      for (const page of related) {
        lines.push(`- 《${page.title}》 ${page.url}`)
      }
    }
    return lines.join("\n")
  }
  const lines = [result.answer, "", "引用："]
  for (const citation of result.citations) {
    const anchor = citation.anchor !== undefined ? `#${citation.anchor}` : ""
    lines.push(`- 《${citation.title}》 ${citation.url}${anchor}（基线 ${citation.commit?.slice(0, 7) ?? "未标注"}）`)
    // 让引用**可引用、可核验**：ID 写进你的回答，地址用来独立核对
    lines.push(`  引用 ID：${citation.citationId}`)
    if (citation.citeUrl !== undefined) {
      lines.push(`  核验地址：${citation.citeUrl}（含原文片段、内容指纹与上游文件）`)
    }
    lines.push(`  原文：${citation.quote}`)
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
      const page = pagesBySlug.get(slug)
      if (page === undefined) {
        const pending = corpus.pending.find((candidate) => candidate.slug === slug)
        return pending !== undefined
          ? `该页尚无中文译文。官方原文：${pending.officialUrl}`
          : `未找到页面：${slug}`
      }
      return pageMarkdown(page)
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
    case "cite": {
      const key = String(args["key"] ?? "")
      const record = findCitationRecord(citations, key)
      if (record === undefined) {
        return [
          `未找到引用：${key}`,
          "",
          `可用 key 形式：digest、\`slug#anchor\`、或完整 citationId。`,
          `也可读取资源 effect-cn://citations 拿到全部 ${citations.length} 条可解引用证据。`
        ].join("\n")
      }
      const lines = [
        `# ${record.citationId}`,
        "",
        `- 可解引用地址：${record.citeUrl}`,
        `- 站内深链：${record.deepLink}`,
        `- 官方原文：${record.officialUrl}`
      ]
      if (record.upstreamRawUrl !== undefined) {
        lines.push(`- 该基线的上游文件（逐字核对用）：${record.upstreamRawUrl}`)
      }
      lines.push(
        `- 上游基线：${record.upstreamCommit ?? "未标注"}${record.stale ? "　⚠ 译文落后上游，结论可能已过时" : ""}`,
        `- 内容指纹：${record.contentHash ?? "无"}`,
        "",
        "## 原文片段（引用必须是它的逐字子串）",
        "",
        record.chunkText
      )
      return lines.join("\n")
    }
    default:
      return `未知工具：${name}`
  }
}

/** 读取一个资源（`effect-cn://docs/<slug>` 或 `effect-cn://citations`） */
function readResource(
  uri: string
): { uri: string; mimeType: string; text: string } | undefined {
  if (uri === "effect-cn://citations") {
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        {
          schemaVersion: 1,
          count: citations.length,
          staleCount: citations.filter((record) => record.stale).length,
          usage: {
            verifyQuote: "record.chunkText.includes(quote)",
            detectDrift: "record.upstreamCommit 与引用时的基线不同 ⇒ 译文已更新，结论可能过时",
            retrieveSource: "record.upstreamRawUrl 是该基线下的官方原文（可逐字核对）"
          },
          citations: citations.map((record) => ({
            citationId: record.citationId,
            citeUrl: record.citeUrl,
            slug: record.slug,
            anchor: record.anchor,
            title: record.title,
            stale: record.stale
          }))
        },
        null,
        2
      )
    }
  }
  const prefix = "effect-cn://docs/"
  if (uri.startsWith(prefix)) {
    const page = pagesBySlug.get(uri.slice(prefix.length))
    if (page === undefined) return undefined
    return { uri, mimeType: "text/markdown", text: pageMarkdown(page) }
  }
  return undefined
}

/**
 * 提示词：把社区的工作流固化成可复用指令。
 *
 * 价值在于**把规则写在能被执行的地方**：译文规范、治理不变量（不许自我发布）、
 * 引用必须可核验 —— 这些本该由每个 Agent 猜的东西，现在是一个可调用的 prompt。
 */
function promptOf(
  name: string,
  args: Record<string, unknown>
): {
  readonly description: string
  readonly messages: ReadonlyArray<{
    readonly role: "user"
    readonly content: { readonly type: "text"; readonly text: string }
  }>
} | undefined {
  const user = (value: string) => ({
    role: "user" as const,
    content: { type: "text" as const, text: value }
  })

  switch (name) {
    case "translate_page": {
      const slug = String(args["slug"] ?? "")
      return {
        description: `把官方页面 ${slug} 译成中文，并以提案形式提交（不直接发布）`,
        messages: [
          user(
            [
              `你是 Effect 中文社区（effect-ts.cn）的译者。请翻译官方页面：${slug}`,
              "",
              "硬性规则（CI 会机械校验，违反即失败）：",
              "1. 代码块与上游**逐字节一致**：剥掉 `twoslash` / `import.meta.vitest` / `showLineNumbers` / `name=\"...\"`；",
              "   删掉 `@astrojs/starlight` 之类的 import 行，但**保留** `<Aside>` / `<Steps>` / `<Tabs>` / `<TabItem>` 标签。",
              "2. 核心术语保留英文（Effect / Layer / Fiber / Schema / Stream / defect / Effect.gen）；禁用译法见 glossary 工具。",
              `3. 本地路径必须镜像上游：apps/site/src/content/docs/${slug}.mdx。`,
              "4. frontmatter 必填：title、status、upstreamPath、upstreamCommit（40 位小写 hex）、translators、reviewers。",
              "5. **status 只能是 reviewing，reviewers 必须为空** —— 你是起草者，不是发布者。",
              "",
              "交付方式（重要）：**不要直接写进内容目录**。写一条提案到 `.proposals/<id>.json`，",
              "然后跑 `pnpm --filter @ecn/content proposals:check` 自检；通过后由人类审阅并 apply。",
              "提案结构见 `.proposals/README.md` 与模板 `.proposals/_template.translation.json`。",
              "",
              `上游英文原文路径（官方仓库）：apps/web/src/content/docs/${slug}.mdx`,
              `官方站点：https://effect.website/docs/${slug}`
            ].join("\n")
          )
        ]
      }
    }
    case "answer_with_evidence": {
      const question = String(args["question"] ?? "")
      return {
        description: "带可核验引用地回答中文 Effect 问题；没有依据就拒答",
        messages: [
          user(
            [
              `用 effect-ts.cn 的中文文档回答：「${question}」`,
              "",
              "步骤：",
              "1. 调 `ask` 工具拿答案与引用；",
              "2. 若 `citations` 为空，**不要**用模型记忆补齐 —— 直接说明站内没有依据，",
              "   并区分 `untranslated`（官方有、中文未译）与 `no-match`（站内没有）；",
              "3. 每条引用都带上 `citationId` 与 `citeUrl`；",
              "4. 你有责任核验：用 `cite` 工具（或直接 GET `citeUrl`）确认",
              "   引用原文确实是记录里 `chunkText` 的逐字子串；",
              "5. 若 `cite` 返回 `stale: true`，或记录的 `upstreamCommit` 与你引用时的基线不一致，",
              "   必须显式提示「该页译文已更新或落后上游，结论可能过时」。"
            ].join("\n")
          )
        ]
      }
    }
    case "review_proposal": {
      const id = args["id"] === undefined ? "（最新一条待审提案）" : String(args["id"])
      return {
        description: "审阅一条提案，输出可执行的修改意见",
        messages: [
          user(
            [
              `审阅 effect-ts.cn 的提案：${id}`,
              "",
              "逐条核对并给出结论（每条附具体位置）：",
              "1. 代码块是否与上游逐字一致（工具元数据是否剥干净、框架 import 是否删掉）；",
              "2. 术语是否违反 glossary 的禁用译法；",
              "3. 引用与页内锚点是否真实存在（可用 cite / get_page 核对）；",
              "4. **治理不变量**：content.status 是否只是 reviewing、reviewers 是否为空 —— 若 Agent 自我发布或自我背书，直接拒绝；",
              "5. 内容是否真的对得上 target.upstreamCommit 那次上游版本。",
              "",
              "最后给出：通过 / 需修改（列出具体改动），以及",
              "落地步骤 `proposals:apply <id>` → `pnpm content:check` → `pnpm build && pnpm corpus:build`。"
            ].join("\n")
          )
        ]
      }
    }
    default:
      return undefined
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
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: SERVER_INFO,
          instructions:
            "effect-ts.cn 中文 Effect 知识层。引用必须可核验：调用 ask/search_docs 拿到的每条引用都带 citationId 与 citeUrl；用 cite 工具可独立核对引用是否为原文子串、以及译文基线是否已漂移。若 citations 为空，请视为「站内没有依据」，不要用模型记忆补齐。"
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
    case "resources/list":
      return { jsonrpc: "2.0", id, result: { resources: RESOURCES } }
    case "resources/read": {
      const uri = String((message.params ?? {})["uri"] ?? "")
      const content = readResource(uri)
      if (content === undefined) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown resource: ${uri}` } }
      }
      return { jsonrpc: "2.0", id, result: { contents: [content] } }
    }
    case "prompts/list":
      return { jsonrpc: "2.0", id, result: { prompts: PROMPTS } }
    case "prompts/get": {
      const params = message.params ?? {}
      const prompt = promptOf(
        String(params["name"] ?? ""),
        (params["arguments"] as Record<string, unknown> | undefined) ?? {}
      )
      if (prompt === undefined) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Unknown prompt: ${String(params["name"] ?? "")}` }
        }
      }
      return { jsonrpc: "2.0", id, result: prompt }
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
