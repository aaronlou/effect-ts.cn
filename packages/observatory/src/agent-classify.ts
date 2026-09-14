/**
 * Agent 分类器（methodology §4 的 A1–A4）。
 *
 * 三条设计原则，全部来自"这份数据会被当成事实引用"这件事：
 *
 * 1. **规则优先**。LLM 只该判灰区。用 LLM 判 1612 个仓库不仅贵，而且不可复现
 *    （同一个仓库两次跑可能两个结论），而计划 §37 明确要求可复现。
 * 2. **证据分级**。`manifest`（依赖清单，强）> `paths`（文件路径，中）> `metadata`（描述与 topics，弱）。
 *    每条判定都带 `evidence`，报告里能说清"这条结论是拿什么得出的"。
 * 3. **判不准就说判不准**。`uncertain` 是一等公民，不硬塞进 agent 或 non-agent ——
 *    灰区交人工抽样审核（methodology §7）。
 *
 * 刻意不做的事：不看 README 正文。README 里"我们也用过 LangChain"这类句子会大量误召，
 * 而 name/description/topics 是维护者主动声明的定位。
 */
import type { Candidate } from "./candidate.js"

/** 判定用到的全部输入（纯数据，方便单测） */
export interface ClassifyInput {
  readonly repo: string
  readonly description: string | null
  readonly topics: ReadonlyArray<string>
  /** 依赖清单里的包名（各语言的 manifest 汇成一份） */
  readonly dependencies: ReadonlyArray<string>
  /** 仓库内文件路径（来自 git tree） */
  readonly paths: ReadonlyArray<string>
}

export type AgentType =
  | "single-agent"
  | "multi-agent"
  | "agent-framework"
  | "agent-runtime"
  | "agent-harness"
  | "workflow-agent"
  | "coding-agent"
  | "research-agent"
  | "mcp-agent"
  | "llm-app"
  | "other"
  | "uncertain"

export type EvidenceTier = "manifest" | "paths" | "metadata" | "none"

export interface AgentClassification {
  readonly repo: string
  /** A1 ∧ A2 ∧ A3 ∧ A4 */
  readonly isAgent: boolean
  /** 判定为"不是 Agent"还是"判不准" —— 两者必须分开 */
  readonly verdict: "agent" | "not-agent" | "uncertain"
  readonly agentType: AgentType
  readonly confidence: number
  /** 最强的一条证据来源 */
  readonly evidenceTier: EvidenceTier
  readonly evidence: ReadonlyArray<string>
  // A1–A4
  readonly hasLlm: boolean
  readonly hasAgentLoop: boolean
  readonly hasToolCalling: boolean
  readonly hasMcp: boolean
  readonly hasWorkflow: boolean
  readonly hasMultiAgent: boolean
  readonly hasMemory: boolean
  readonly hasStreaming: boolean
  /** A3：不是"把一次 LLM 调用包成函数"的库 */
  readonly isThinWrapper: boolean
  /** A4：不是教学产物 */
  readonly looksLikeTutorial: boolean
}

// ── 依赖名表（各语言）────────────────────────────────────────────────────────

/** A1：LLM 接触 */
const LLM_DEPS: ReadonlyArray<string> = [
  // TS / JS
  "openai", "@anthropic-ai/sdk", "@google/generative-ai", "@google/genai", "ai", "@ai-sdk/openai",
  "@ai-sdk/anthropic", "@ai-sdk/google", "@ai-sdk/provider", "langchain", "@langchain/core",
  "@langchain/openai", "llamaindex", "cohere-ai", "@mistralai/mistralai", "groq-sdk",
  "@huggingface/inference", "replicate", "ollama", "ollama-ai-provider", "@effect/ai",
  "genkit", "@genkit-ai/ai", "transformers.js", "@xenova/transformers",
  // Python
  "openai", "anthropic", "google-generativeai", "google-genai", "litellm", "langchain",
  "langchain-core", "llama-index", "llama-index-core", "transformers", "cohere", "mistralai",
  "groq", "ollama", "vllm", "replicate", "huggingface-hub", "sentence-transformers",
  // Rust / Go / Java
  "async-openai", "rig-core", "llm", "kalosm", "mistralrs", "ollama-rs",
  "sashabaranov/go-openai", "langchaingo", "openai-go", "langchain4j", "spring-ai-core",
  "dev.langchain4j"
]

/** A2：执行结构（框架级依赖 —— 有它基本就能确定有 agent loop / 工具调用 / 编排） */
const AGENT_FRAMEWORK_DEPS: ReadonlyArray<string> = [
  "@modelcontextprotocol/sdk", "mcp", "@mastra/core", "mastra", "langgraph", "@langchain/langgraph",
  "crewai", "autogen", "pyautogen", "agno", "phidata", "smolagents", "openai-agents", "agents",
  "pydantic-ai", "pydantic-ai-slim", "semantic-kernel", "google-adk", "llama-index-agent",
  "@anthropic-ai/claude-agent-sdk", "claude-agent-sdk", "@openai/agents", "beeai-framework",
  "atomic-agents", "dspy", "dspy-ai", "mcp-agent", "fastmcp", "@modelcontextprotocol/server",
  "langchain4j", "spring-ai", "semantic-kernel-java"
]

const MCP_DEPS: ReadonlyArray<string> = [
  "@modelcontextprotocol/sdk", "mcp", "fastmcp", "mcp-agent", "@modelcontextprotocol/server",
  "mcp-go", "mark3labs/mcp-go", "modelcontextprotocol"
]

const MULTI_AGENT_DEPS: ReadonlyArray<string> = ["crewai", "autogen", "pyautogen", "agno", "swarm", "openai-swarm", "@mastra/core"]

const STREAMING_DEPS: ReadonlyArray<string> = ["effect", "@effect/stream", "@effect/platform", "rxjs", "tokio-stream"]

// ── 路径信号（A2 的中等强度证据）──────────────────────────────────────────────

const PATH_SIGNALS: ReadonlyArray<{ readonly id: keyof PathSignals; readonly pattern: RegExp }> = [
  { id: "agentLoop", pattern: /(^|\/)(agent|agents|loop|orchestrat|runtime|runner)[^/]*\.(ts|js|py|rs|go|java|tsx|jsx)$/i },
  { id: "agentLoop", pattern: /(^|\/)(agent|agents)\/(?!.*\.(md|json|ya?ml)$)[^/]+$/i },
  { id: "toolCalling", pattern: /(^|\/)(tools?|functions?|toolkits?)\/[^/]+\.(ts|js|py|rs|go|java|tsx|jsx)$/i },
  { id: "toolCalling", pattern: /(^|\/)(tool|tools|function-calling|function_calling)[^/]*\.(ts|js|py|rs|go|java)$/i },
  { id: "mcp", pattern: /(^|\/)(mcp|mcp-server|mcp-servers?)\//i },
  { id: "workflow", pattern: /(^|\/)(workflows?|graphs?|pipelines?|nodes?)\/[^/]+\.(ts|js|py|rs|go|java|tsx|jsx)$/i },
  { id: "memory", pattern: /(^|\/)(memory|memories|vector[-_]?store|embeddings?)\//i },
  { id: "multiAgent", pattern: /(^|\/)(multi[-_]?agent|crews?|swarms?|teams?)\//i }
]

interface PathSignals {
  agentLoop: boolean
  toolCalling: boolean
  mcp: boolean
  workflow: boolean
  memory: boolean
  multiAgent: boolean
}

/**
 * A4：教学产物。
 *
 * 两个坑，都踩过：
 * - **短词子串误伤**：初版把 `book` 也当教学词，于是 "an agent that **book**s flights"
 *   被判成教学仓库。仓库名与描述用两套模式，且一律加词边界。
 * - **"machine learning" 不是教学**：描述里出现 `learning` 时先把它剔掉再判。
 */
const TUTORIAL_NAME_PATTERN =
  /\b(tutorial|tutorials|course|courses|awesome|boilerplate|starter|template|templates|example|examples|sample|samples|demo|demos|playground|learn|learning|guide|guides|walkthrough|workshop|curriculum|homework|exercise|exercises|handbook|cookbook|workbook|textbook)\b/i

const TUTORIAL_TEXT_PATTERN =
  /\b(tutorial|tutorials|course|courses|awesome|boilerplate|starter|template|templates|example|examples|sample|samples|demo|demos|playground|walkthrough|workshop|curriculum|homework|exercise|exercises|handbook|cookbook|workbook|textbook)\b/i

/** 描述里出现这些短语时，"learning/learn" 不是教学信号 */
const LEARNING_EXCEPTION = /(machine|deep|reinforcement|self-supervised|transfer)\s+learning/gi

/** 只在名字/描述里出现这些词 ⇒ 基本是教学仓库 */
const isTutorialRepo = (input: {
  readonly repo: string
  readonly description: string | null
  readonly topics: ReadonlyArray<string>
}): boolean => {
  const name = input.repo.split("/")[1] ?? ""
  // 仓库名里带教学词 ⇒ 决定性（`awesome-agents` / `agent-tutorial` 不会是真产品）
  if (TUTORIAL_NAME_PATTERN.test(name)) return true
  // 描述与 topics：先把 "machine learning" 这类短语剔掉，再看有没有教学词
  const rest = `${input.description ?? ""} ${input.topics.join(" ")}`.replace(LEARNING_EXCEPTION, " ")
  if (!TUTORIAL_TEXT_PATTERN.test(rest)) return false
  if (/\b(learn|learning)\b/i.test(rest) && !TUTORIAL_TEXT_PATTERN.test(rest.replace(/\b(learn|learning)\b/gi, " "))) return false
  // 描述里带教学词时才看"产品定位"例外（`Production agent runtime` 不该被判成教学）
  const productish = /(platform|production|engine|framework|runtime|server|service|cloud|\bapi\b)/i.test(rest)
  return !productish
}

const has = (deps: ReadonlyArray<string>, table: ReadonlyArray<string>): ReadonlyArray<string> => {
  const lowered = new Set(deps.map((dep) => dep.toLowerCase()))
  return table.filter((name) => lowered.has(name.toLowerCase()))
}

/** 子串匹配（处理 `@ai-sdk/openai` 这类前缀族与 python 的 `langchain-*`） */
const hasPrefix = (deps: ReadonlyArray<string>, prefixes: ReadonlyArray<string>): ReadonlyArray<string> =>
  deps.filter((dep) => prefixes.some((prefix) => dep.toLowerCase().startsWith(prefix.toLowerCase())))

export function classifyAgent(input: ClassifyInput): AgentClassification {
  const evidence: Array<string> = []

  // ── A1：LLM 接触 ──
  const llmDirect = [...has(input.dependencies, LLM_DEPS), ...hasPrefix(input.dependencies, ["@ai-sdk/", "langchain-", "llama-index-"])]
  const llmFromPaths = input.paths.some((path) => /(^|\/)(llm|openai|anthropic|prompt|chat|completion)[^/]*\.(ts|js|py|rs|go|java|tsx|jsx)$/i.test(path))
  const hasLlm = llmDirect.length > 0 || llmFromPaths
  if (llmDirect.length > 0) evidence.push(`manifest:${[...new Set(llmDirect)].slice(0, 4).join(",")}`)

  // ── A2：执行结构 ──
  const frameworkDeps = has(input.dependencies, AGENT_FRAMEWORK_DEPS)
  const mcpDeps = has(input.dependencies, MCP_DEPS)
  const multiAgentDeps = has(input.dependencies, MULTI_AGENT_DEPS)
  const streamingDeps = has(input.dependencies, STREAMING_DEPS)

  const finalSignals: PathSignals = {
    agentLoop: false,
    toolCalling: false,
    mcp: false,
    workflow: false,
    memory: false,
    multiAgent: false
  }
  for (const entry of PATH_SIGNALS) {
    if (input.paths.some((path) => entry.pattern.test(path))) {
      finalSignals[entry.id] = true
      evidence.push(`path:${entry.id}`)
    }
  }

  const hasAgentLoop = finalSignals.agentLoop || frameworkDeps.length > 0
  const hasToolCalling = finalSignals.toolCalling || frameworkDeps.length > 0
  const hasMcp = finalSignals.mcp || mcpDeps.length > 0
  const hasWorkflow = finalSignals.workflow
  const hasMultiAgent = finalSignals.multiAgent || multiAgentDeps.length > 0
  const hasMemory = finalSignals.memory
  const hasStreaming = streamingDeps.length > 0 || input.paths.some((path) => /stream/i.test(path))

  // ── A3：不是"薄封装" ──
  // 判据：除了 LLM 客户端以外，还有编排/工具/状态/记忆/流式中的 ≥2 项
  const structureCount = [hasAgentLoop, hasToolCalling, hasWorkflow, hasMemory, hasMcp].filter(Boolean).length
  const isThinWrapper = hasLlm && structureCount <= 1 && frameworkDeps.length === 0

  // ── A4：不是教学产物 ──
  const looksLikeTutorial = isTutorialRepo(input)

  const hasStructure = hasAgentLoop || hasToolCalling || hasMcp || hasWorkflow || hasMultiAgent
  const isAgent = hasLlm && hasStructure && !isThinWrapper && !looksLikeTutorial

  // ── 证据强度与置信度 ──
  const manifestStrength = llmDirect.length + frameworkDeps.length + mcpDeps.length
  const evidenceTier: EvidenceTier =
    manifestStrength > 0
      ? "manifest"
      : input.paths.length > 0 && (hasStructure || hasLlm)
        ? "paths"
        : input.description !== null || input.topics.length > 0
          ? "metadata"
          : "none"

  // ── 类型归类（多标签取最具体的一个）──
  const agentType: AgentType = !isAgent
    ? looksLikeTutorial
      ? "other"
      : hasLlm
        ? "llm-app"
        : "other"
    : mcpDeps.length > 0 || (hasMcp && /\bmcp\b/i.test(`${input.repo} ${input.description ?? ""}`))
      ? "mcp-agent"
      : hasMultiAgent
        ? "multi-agent"
        : /\b(coding|coder|code-agent|cli|ide|editor)\b/i.test(`${input.repo} ${input.description ?? ""}`)
          ? "coding-agent"
          : /research|search|paper|deep.?research/i.test(`${input.repo} ${input.description ?? ""}`)
            ? "research-agent"
            : frameworkDeps.length > 0 && /framework|sdk|toolkit/i.test(`${input.repo} ${input.description ?? ""}`)
              ? "agent-framework"
              : /runtime|harness|orchestrat/i.test(`${input.repo} ${input.description ?? ""}`)
                ? "agent-runtime"
                : hasWorkflow
                  ? "workflow-agent"
                  : "single-agent"

  // 置信度：证据强度打底，结构信号越多越确定，教学/薄封装扣分
  let confidence = evidenceTier === "manifest" ? 0.8 : evidenceTier === "paths" ? 0.6 : 0.45
  // 路径证据的细分：**多个相互独立的结构信号 + LLM 信号**已经足以判定，
  // 不必因为"依赖清单里没写 LLM SDK"就一律打成 unsure ——
  // 很多 agent 是通过 CLI/HTTP 调模型的，依赖清单里看不到（实测 372 个卡在这一档）
  if (evidenceTier === "paths" && hasLlm && structureCount >= 2) confidence = 0.72
  if (evidenceTier === "paths" && hasLlm && structureCount >= 4) confidence = 0.78
  if (frameworkDeps.length > 0) confidence += 0.12
  if (mcpDeps.length > 0) confidence += 0.05
  if (structureCount >= 3) confidence += 0.05
  if (looksLikeTutorial) confidence -= 0.35
  // 只在"有结构却仍是封装"时扣分；纯粹的 LLM 调用库是**有把握的否定结论**，不该被降级成 uncertain
  if (isThinWrapper && hasStructure) confidence -= 0.2
  if (!hasLlm && !hasStructure) confidence = Math.min(confidence, 0.6)
  confidence = Math.max(0.05, Math.min(0.99, Number(confidence.toFixed(2))))

  // verdict：高置信的两端给确定结论，中间给 uncertain（交人看）
  const verdict: AgentClassification["verdict"] =
    confidence >= 0.7 ? (isAgent ? "agent" : "not-agent") : "uncertain"

  return {
    repo: input.repo,
    isAgent,
    verdict,
    agentType: verdict === "uncertain" && !isAgent ? "uncertain" : agentType,
    confidence,
    evidenceTier,
    evidence: [...new Set(evidence)].slice(0, 12),
    hasLlm,
    hasAgentLoop,
    hasToolCalling,
    hasMcp,
    hasWorkflow,
    hasMultiAgent,
    hasMemory,
    hasStreaming,
    isThinWrapper,
    looksLikeTutorial
  }
}

/** 从 manifest 文本里抽依赖名（按语言各一份最小实现） */
export function extractDependencyNames(language: string | null, text: string, filename: string): ReadonlyArray<string> {
  const names: Array<string> = []
  if (filename.endsWith("package.json") || language === "TypeScript" || language === "JavaScript") {
    try {
      const parsed = JSON.parse(text) as Record<string, Record<string, string> | undefined>
      for (const field of ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"]) {
        const table = parsed[field]
        if (table !== undefined && typeof table === "object") names.push(...Object.keys(table))
      }
    } catch {
      return []
    }
    return names
  }
  if (filename.endsWith("requirements.txt")) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => line.split(/[<>=\[;]/)[0]!.trim())
  }
  if (filename.endsWith("Cargo.toml")) {
    // 只抓 [dependencies] / [dependencies.x] 段落里的名字（够用即可，不求完整 TOML 解析）
    let inDeps = false
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (trimmed.startsWith("[")) {
        inDeps = /^\[(dependencies|dev-dependencies|workspace\.dependencies)/.test(trimmed)
        if (inDeps && trimmed.startsWith("[dependencies.")) names.push(trimmed.slice(14).replace(/\]$/, ""))
        continue
      }
      if (!inDeps || trimmed === "" || trimmed.startsWith("#")) continue
      const name = trimmed.split("=")[0]!.trim()
      if (name !== "") names.push(name)
    }
    return names
  }
  if (filename.endsWith("go.mod")) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("/") && !line.startsWith("module") && !line.startsWith("//"))
      .map((line) => line.replace(/^require\s+/, "").split(/\s+/)[0]!)
  }
  if (filename.endsWith("pyproject.toml")) {
    let inDeps = false
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (trimmed.startsWith("[")) {
        inDeps = /^\[(project|tool\.poetry\.dependencies|dependency-groups)/.test(trimmed)
        continue
      }
      if (!inDeps || trimmed === "" || trimmed.startsWith("#")) continue
      if (trimmed.startsWith("dependencies")) {
        for (const match of trimmed.matchAll(/"([A-Za-z0-9_.\-]+)"/g)) names.push(match[1]!)
        continue
      }
      if (/^[A-Za-z0-9_.\-]+\s*=/.test(trimmed)) names.push(trimmed.split("=")[0]!.trim())
    }
    return names
  }
  if (filename.endsWith("pom.xml") || filename.endsWith(".gradle") || filename.endsWith(".gradle.kts")) {
    for (const match of text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) names.push(match[1]!)
    for (const match of text.matchAll(/["']([a-zA-Z0-9_.\-]+:[a-zA-Z0-9_.\-]+)["']/g)) names.push(match[1]!)
    return names
  }
  return names
}
