/**
 * Agent 分类器的判据测试（零网络）。
 *
 * 这层测试的意义：分类结果是"这个项目算不算 Agent"的**外部断言**，
 * 写进报告后会被用来算比例。判据错一格，整份报告的比例就错一片，
 * 而且错得很安静（数字永远看起来合理）。所以每条规则都要有正反例。
 */
import { describe, expect, it } from "vitest"
import { classifyAgent, extractDependencyNames, type ClassifyInput } from "../src/agent-classify.js"

const input = (overrides: Partial<ClassifyInput> = {}): ClassifyInput => ({
  repo: "acme/agent",
  description: "An open-source AI agent framework",
  topics: ["ai", "agent"],
  dependencies: [],
  paths: [],
  ...overrides
})

describe("A1：LLM 接触", () => {
  it("manifest 里有 LLM SDK ⇒ hasLlm（证据强度 manifest）", () => {
    const result = classifyAgent(input({ dependencies: ["openai", "zod"], paths: ["src/index.ts"] }))
    expect(result.hasLlm).toBe(true)
    expect(result.evidenceTier).toBe("manifest")
    expect(result.evidence.some((e) => e.startsWith("manifest:"))).toBe(true)
  })

  it("只有描述里写 AI、代码里没有 ⇒ 不算有 LLM 接触", () => {
    const result = classifyAgent(input({ dependencies: ["express"], paths: ["src/server.ts"] }))
    expect(result.hasLlm).toBe(false)
    expect(result.isAgent).toBe(false)
  })

  it("识别 @ai-sdk/* 这类前缀族", () => {
    const result = classifyAgent(input({ dependencies: ["@ai-sdk/openai"], paths: ["src/x.ts"] }))
    expect(result.hasLlm).toBe(true)
  })
})

describe("A2：执行结构", () => {
  it("Agent 框架依赖（langgraph / crewai / mastra）⇒ loop 与工具调用都算成立", () => {
    const result = classifyAgent(
      input({ description: "An agent that books flights", dependencies: ["openai", "langgraph"], paths: ["src/graph.ts"] })
    )
    expect(result.hasAgentLoop).toBe(true)
    expect(result.hasToolCalling).toBe(true)
    expect(result.isAgent).toBe(true)
    expect(result.agentType).toBe("single-agent")
  })

  it("MCP 依赖 ⇒ hasMcp", () => {
    const result = classifyAgent(
      input({ dependencies: ["openai", "@modelcontextprotocol/sdk"], paths: ["src/server.ts"], description: "MCP server" })
    )
    expect(result.hasMcp).toBe(true)
  })

  it("路径信号：tools/ 与 agent/ 目录（中等强度证据）", () => {
    const result = classifyAgent(
      input({
        dependencies: ["some-llm-client"],
        paths: ["src/agent/loop.ts", "src/tools/search.ts", "README.md"]
      })
    )
    expect(result.hasAgentLoop).toBe(true)
    expect(result.hasToolCalling).toBe(true)
    expect(result.evidence).toContain("path:agentLoop")
    expect(result.evidence).toContain("path:toolCalling")
  })
})

describe("A3：排除薄封装", () => {
  it("只把一次 LLM 调用包成函数（无工具/无 loop/无编排）⇒ 不是 Agent", () => {
    const result = classifyAgent(input({ dependencies: ["openai"], paths: ["src/index.ts"], description: "OpenAI API client" }))
    expect(result.isThinWrapper).toBe(true)
    expect(result.isAgent).toBe(false)
    expect(result.agentType).toBe("llm-app")
  })
})

describe("A4：排除教学产物", () => {
  it("tutorial / course / awesome 类仓库出局", () => {
    for (const repo of ["acme/awesome-agents", "acme/agent-tutorial", "acme/llm-course"]) {
      const result = classifyAgent(
        input({ repo, dependencies: ["openai", "langgraph"], paths: ["src/agent/loop.ts", "src/tools/t.ts"] })
      )
      expect(result.looksLikeTutorial, repo).toBe(true)
      expect(result.isAgent, repo).toBe(false)
    }
  })

  it("但产品定位里带这些词不算教学（如 agent-platform / agent-runtime）", () => {
    const result = classifyAgent(
      input({
        repo: "acme/agent-platform",
        description: "Production agent runtime platform",
        dependencies: ["openai", "langgraph"],
        paths: ["src/agent/loop.ts"]
      })
    )
    expect(result.looksLikeTutorial).toBe(false)
    expect(result.isAgent).toBe(true)
  })
})

describe("置信度与 verdict：判不准就说判不准", () => {
  it("强证据 ⇒ agent，且置信度 ≥ 0.7", () => {
    const result = classifyAgent(
      input({ dependencies: ["openai", "@modelcontextprotocol/sdk"], paths: ["src/agent/loop.ts", "src/mcp/server.ts"] })
    )
    expect(result.verdict).toBe("agent")
    expect(result.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it("只有元数据、没有任何代码证据 ⇒ uncertain（不硬塞结论）", () => {
    const result = classifyAgent(input({ dependencies: [], paths: [] }))
    expect(result.verdict).toBe("uncertain")
    expect(result.agentType).toBe("uncertain")
  })

  it("证据越强置信度越高（manifest > paths）", () => {
    const manifest = classifyAgent(input({ dependencies: ["openai", "langgraph"], paths: ["src/x.ts"] }))
    const paths = classifyAgent(input({ dependencies: ["custom-client"], paths: ["src/agent/loop.ts", "src/tools/t.ts"] }))
    expect(manifest.confidence).toBeGreaterThan(paths.confidence)
    expect(paths.evidenceTier).toBe("paths")
  })
})

describe("类型归类", () => {
  it("coding agent / research agent / mcp agent 能被区分", () => {
    expect(
      classifyAgent(input({ repo: "acme/coding-agent", description: "A coding agent for the terminal", dependencies: ["openai", "langgraph"], paths: ["src/agent/loop.ts"] })).agentType
    ).toBe("coding-agent")
    expect(
      classifyAgent(input({ repo: "acme/deep-research", description: "Research agent for papers", dependencies: ["openai", "langgraph"], paths: ["src/agent/loop.ts"] })).agentType
    ).toBe("research-agent")
    // 纯 MCP server 没有 LLM 接触 ⇒ 按 methodology §4 的 A1，它是基础设施不是 agent
    expect(
      classifyAgent(input({ repo: "acme/mcp-server", description: "MCP server", dependencies: ["@modelcontextprotocol/sdk"], paths: ["src/mcp/server.ts"] })).isAgent
    ).toBe(false)
    // 既有 LLM 又接 MCP 的才是 mcp-agent
    expect(
      classifyAgent(
        input({
          repo: "acme/mcp-client",
          description: "Agent that drives MCP servers",
          dependencies: ["openai", "@modelcontextprotocol/sdk"],
          paths: ["src/mcp/server.ts"]
        })
      ).agentType
    ).toBe("mcp-agent")
  })
})

describe("依赖抽取（多语言 manifest）", () => {
  it("package.json：dependencies + devDependencies 都算", () => {
    const names = extractDependencyNames("TypeScript", JSON.stringify({ dependencies: { openai: "^4" }, devDependencies: { vitest: "^3" } }), "package.json")
    expect(names).toContain("openai")
    expect(names).toContain("vitest")
  })

  it("requirements.txt：剥掉版本号与注释", () => {
    const names = extractDependencyNames("Python", "# comment\nopenai>=1.0\nlanggraph==0.2.0\n", "requirements.txt")
    expect(names).toEqual(["openai", "langgraph"])
  })

  it("Cargo.toml：只取依赖段落", () => {
    const names = extractDependencyNames(
      "Rust",
      '[package]\nname = "x"\n\n[dependencies]\nasync-openai = "0.20"\nserde = { version = "1" }\n',
      "Cargo.toml"
    )
    expect(names).toContain("async-openai")
    expect(names).toContain("serde")
    expect(names).not.toContain("name")
  })

  it("go.mod：取 require 段里的模块路径", () => {
    const names = extractDependencyNames("Go", "module x\n\ngo 1.22\n\nrequire (\n\tgithub.com/sashabaranov/go-openai v1.0.0\n)\n", "go.mod")
    expect(names).toContain("github.com/sashabaranov/go-openai")
  })

  it("坏 JSON 不抛异常（返回空）", () => {
    expect(extractDependencyNames("TypeScript", "{ not json", "package.json")).toEqual([])
  })
})
