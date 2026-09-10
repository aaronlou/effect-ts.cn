/**
 * MCP Server 测试：直接走 JSON-RPC 协议层（不依赖任何外部 SDK），
 * 包含一次真正的 stdio 端到端（PassThrough 模拟 stdin/stdout）。
 */
import { PassThrough } from "node:stream"
import { describe, expect, it } from "vitest"
import { corpus } from "@ecn/knowledge"
import { handleMessage, serveStdio } from "../src/server.js"

const call = (method: string, params?: Record<string, unknown>, id: number = 1) =>
  handleMessage({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) })

describe("MCP 协议", () => {
  it("initialize：返回协议版本与 serverInfo", async () => {
    const response = await call("initialize")
    const result = response?.result as { protocolVersion: string; serverInfo: { name: string } }
    expect(result.protocolVersion.length).toBeGreaterThan(0)
    expect(result.serverInfo.name).toBe("effect-ts-cn")
  })

  it("tools/list：暴露 6 个知识工具（含引用核验）", async () => {
    const response = await call("tools/list")
    const result = response?.result as { tools: ReadonlyArray<{ name: string }> }
    const names = result.tools.map((tool) => tool.name)
    expect(names).toEqual([
      "search_docs",
      "get_page",
      "ask",
      "glossary",
      "translation_status",
      "cite"
    ])
  })

  it("initialize：声明 tools / resources / prompts 三种能力", async () => {
    const response = await call("initialize")
    const result = response?.result as {
      capabilities: Record<string, unknown>
      instructions?: string
    }
    expect(Object.keys(result.capabilities).sort()).toEqual(["prompts", "resources", "tools"])
    expect(result.instructions ?? "").toContain("citations 为空")
  })

  it("未知方法：返回 -32601", async () => {
    const response = await call("nope")
    expect(response?.error?.code).toBe(-32601)
  })

  it("notifications/initialized：通知不应产生响应", async () => {
    const response = await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" })
    expect(response).toBeUndefined()
  })

  it("search_docs：命中中文页面并给出官方原文", async () => {
    const response = await call("tools/call", { name: "search_docs", arguments: { query: "怎么安装 Effect" } })
    const payload = response?.result as { content: ReadonlyArray<{ text: string }> }
    const body = payload.content[0]?.text ?? ""
    expect(body).toContain("installation")
    expect(body).toContain("effect.website")
  })

  it("get_page：返回带基线的 Markdown", async () => {
    const response = await call("tools/call", {
      name: "get_page",
      arguments: { slug: "v4/getting-started/running-effects" }
    })
    const body = (response?.result as { content: ReadonlyArray<{ text: string }> }).content[0]?.text ?? ""
    expect(body).toContain("# 运行 Effect")
    expect(body).toContain("基线：")
  })

  it("get_page：未翻译页面给出官方入口", async () => {
    // 刻意不写死 v4/runtime 这类页面 —— 它一旦被翻译，这条就变成"断言当年的缺口"，
    // 而不是"断言能力"。未翻译的页面从语料里取，内容怎么增长都成立。
    const pending = corpus.pending[0]
    expect(pending, "需要一个尚未翻译的页面来验证该分支").toBeDefined()
    const response = await call("tools/call", {
      name: "get_page",
      arguments: { slug: pending!.slug }
    })
    const body = (response?.result as { content: ReadonlyArray<{ text: string }> }).content[0]?.text ?? ""
    expect(body).toContain("尚无中文译文")
    expect(body).toContain(pending!.officialUrl)
  })

  it("ask：有依据时返回引用", async () => {
    const response = await call("tools/call", { name: "ask", arguments: { question: "怎么运行 Effect？" } })
    const body = (response?.result as { content: ReadonlyArray<{ text: string }> }).content[0]?.text ?? ""
    expect(body).toContain("引用：")
    expect(body).toContain("running-effects")
  })

  it("ask：未翻译主题必须拒答并给英文原文（不允许编答案）", async () => {
    const response = await call("tools/call", { name: "ask", arguments: { question: "Schema 怎么做数据校验？" } })
    const body = (response?.result as { content: ReadonlyArray<{ text: string }> }).content[0]?.text ?? ""
    expect(body).toContain("拒答")
    expect(body).toContain("v4/schema")
  })

  it("ask：已翻译主题（Layer）必须直接作答，而不是拒答", async () => {
    const response = await call("tools/call", { name: "ask", arguments: { question: "Layer 怎么做依赖注入？" } })
    const body = (response?.result as { content: ReadonlyArray<{ text: string }> }).content[0]?.text ?? ""
    expect(body).not.toContain("拒答")
    expect(body).toContain("requirements-management/layers")
  })

  it("translation_status：无参返回总体统计，带参返回单页状态", async () => {
    const overall = await call("tools/call", { name: "translation_status", arguments: {} })
    const overallBody = (overall?.result as { content: ReadonlyArray<{ text: string }> }).content[0]?.text ?? ""
    // 不写死数字：随译文增长自动跟随（由语料推导，避免每加一篇翻译就要改测试）
    const translated = corpus.pages.length
    expect(overallBody).toContain(`已翻译：${translated} 篇`)

    const single = await call("tools/call", { name: "translation_status", arguments: { slug: "v4/onboarding" } })
    const singleBody = (single?.result as { content: ReadonlyArray<{ text: string }> }).content[0]?.text ?? ""
    expect(singleBody).toContain("已翻译")
  })

  it("stdio 端到端：两条请求 → 两条响应", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const received: Array<string> = []
    output.on("data", (chunk: Buffer) => received.push(chunk.toString("utf8")))

    const done = serveStdio({ input, output })
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`)
    input.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`
    )
    input.end()
    await done
    // 等待异步处理完成
    await new Promise((resolve) => setTimeout(resolve, 50))

    const lines = received.join("").trim().split("\n").filter((line) => line !== "")
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0] ?? "{}") as { id: number; result: { serverInfo: { name: string } } }
    const second = JSON.parse(lines[1] ?? "{}") as { id: number; result: { tools: unknown[] } }
    expect(first.id).toBe(1)
    expect(first.result.serverInfo.name).toBe("effect-ts-cn")
    expect(second.id).toBe(2)
    expect(second.result.tools).toHaveLength(6)
  })
})

describe("引用可核验（cite / 资源 / 提示词）", () => {
  it("ask 的引用带 citationId 与核验地址", async () => {
    const response = await call("tools/call", {
      name: "ask",
      arguments: { question: "怎么从 defect 中恢复？" }
    })
    const body = (response?.result as { content: ReadonlyArray<{ text: string }> }).content[0]?.text ?? ""
    expect(body).toContain("引用 ID：ecn:v4/error-management/unexpected-errors@")
    expect(body).toContain("核验地址：/cite/")
    expect(body).toContain("原文：")
  })

  it("cite：用 slug#anchor 解析出可独立核验的记录", async () => {
    const response = await call("tools/call", {
      name: "cite",
      arguments: { key: "v4/error-management/unexpected-errors#catchdefect" }
    })
    const body = (response?.result as { content: ReadonlyArray<{ text: string }> }).content[0]?.text ?? ""
    expect(body).toContain("ecn:v4/error-management/unexpected-errors@")
    expect(body).toContain("/cite/")
    expect(body).toContain("内容指纹")
    expect(body).toContain("原文片段")
  })

  it("cite：未知引用明确说找不到，并给出可用路径", async () => {
    const response = await call("tools/call", {
      name: "cite",
      arguments: { key: "v4/not/a/page#nope" }
    })
    const body = (response?.result as { content: ReadonlyArray<{ text: string }> }).content[0]?.text ?? ""
    expect(body).toContain("未找到引用")
    expect(body).toContain("effect-cn://citations")
  })

  it("resources/list：暴露全部译文页 + 引用索引", async () => {
    const response = await call("resources/list")
    const result = response?.result as {
      resources: ReadonlyArray<{ uri: string; mimeType: string }>
    }
    expect(result.resources).toHaveLength(corpus.pages.length + 1)
    expect(result.resources.some((resource) => resource.uri === "effect-cn://citations")).toBe(true)
    expect(
      result.resources.some((resource) => resource.uri === "effect-cn://docs/v4/onboarding")
    ).toBe(true)
  })

  it("resources/read：读页面返回带基线的 Markdown；读引用索引返回可核验清单", async () => {
    const page = await call("resources/read", { uri: "effect-cn://docs/v4/onboarding" })
    const pageText = (page?.result as { contents: ReadonlyArray<{ text: string }> }).contents[0]?.text ?? ""
    expect(pageText).toContain("# 欢迎来到 Effect")
    expect(pageText).toContain("基线：")

    const citations = await call("resources/read", { uri: "effect-cn://citations" })
    const citationsText =
      (citations?.result as { contents: ReadonlyArray<{ text: string }> }).contents[0]?.text ?? ""
    const parsed = JSON.parse(citationsText) as {
      count: number
      citations: ReadonlyArray<{ citationId: string; citeUrl: string }>
    }
    expect(parsed.count).toBeGreaterThan(100)
    expect(parsed.citations[0]?.citeUrl).toMatch(/^\/cite\//)
  })

  it("resources/read：未知资源 → -32602", async () => {
    const response = await call("resources/read", { uri: "effect-cn://docs/v4/nope" })
    expect(response?.error?.code).toBe(-32602)
  })

  it("prompts/list：暴露三条工作流提示词", async () => {
    const response = await call("prompts/list")
    const result = response?.result as { prompts: ReadonlyArray<{ name: string }> }
    expect(result.prompts.map((prompt) => prompt.name).sort()).toEqual([
      "answer_with_evidence",
      "review_proposal",
      "translate_page"
    ])
  })

  it("prompts/get：译文提示词把治理规则写进指令（不许自我发布）", async () => {
    const response = await call("prompts/get", {
      name: "translate_page",
      arguments: { slug: "v4/error-management/fallback" }
    })
    const result = response?.result as {
      messages: ReadonlyArray<{ content: { text: string } }>
    }
    const body = result.messages[0]?.content.text ?? ""
    expect(body).toContain("v4/error-management/fallback")
    expect(body).toContain("status 只能是 reviewing")
    expect(body).toContain("逐字节一致")
    expect(body).toContain(".proposals/")
  })

  it("prompts/get：问答提示词要求先核验再回答", async () => {
    const response = await call("prompts/get", {
      name: "answer_with_evidence",
      arguments: { question: "Layer 怎么做依赖注入？" }
    })
    const body =
      ((response?.result as { messages: ReadonlyArray<{ content: { text: string } }> }).messages[0]
        ?.content.text ?? "")
    expect(body).toContain("Layer 怎么做依赖注入？")
    expect(body).toContain("cite")
    expect(body).toContain("**不要**用模型记忆补齐")
  })

  it("prompts/get：未知提示词 → -32602", async () => {
    const response = await call("prompts/get", { name: "nope" })
    expect(response?.error?.code).toBe(-32602)
  })
})
