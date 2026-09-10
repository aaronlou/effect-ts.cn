/**
 * MCP Server 测试：直接走 JSON-RPC 协议层（不依赖任何外部 SDK），
 * 包含一次真正的 stdio 端到端（PassThrough 模拟 stdin/stdout）。
 */
import { PassThrough } from "node:stream"
import { describe, expect, it } from "vitest"
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

  it("tools/list：暴露 5 个知识工具", async () => {
    const response = await call("tools/list")
    const result = response?.result as { tools: ReadonlyArray<{ name: string }> }
    const names = result.tools.map((tool) => tool.name)
    expect(names).toEqual(["search_docs", "get_page", "ask", "glossary", "translation_status"])
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
    const response = await call("tools/call", { name: "get_page", arguments: { slug: "v4/runtime" } })
    const body = (response?.result as { content: ReadonlyArray<{ text: string }> }).content[0]?.text ?? ""
    expect(body).toContain("尚无中文译文")
    expect(body).toContain("https://effect.website/docs/v4/runtime")
  })

  it("ask：有依据时返回引用", async () => {
    const response = await call("tools/call", { name: "ask", arguments: { question: "怎么运行 Effect？" } })
    const body = (response?.result as { content: ReadonlyArray<{ text: string }> }).content[0]?.text ?? ""
    expect(body).toContain("引用：")
    expect(body).toContain("running-effects")
  })

  it("ask：未翻译主题必须拒答并给英文原文（不允许编答案）", async () => {
    const response = await call("tools/call", { name: "ask", arguments: { question: "Layer 怎么做依赖注入？" } })
    const body = (response?.result as { content: ReadonlyArray<{ text: string }> }).content[0]?.text ?? ""
    expect(body).toContain("拒答")
    expect(body).toContain("requirements-management")
  })

  it("translation_status：无参返回总体统计，带参返回单页状态", async () => {
    const overall = await call("tools/call", { name: "translation_status", arguments: {} })
    const overallBody = (overall?.result as { content: ReadonlyArray<{ text: string }> }).content[0]?.text ?? ""
    expect(overallBody).toContain("已翻译：10 篇")

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
    expect(second.result.tools).toHaveLength(5)
  })
})
