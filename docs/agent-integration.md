# Agent 接入指南（把中文 Effect 知识接进你的编码 Agent）

> 面向：Claude Code、Cursor、DSH、以及任何支持 MCP 或只会 `fetch` 的 Agent。
> 目标：让 Agent 在写 Effect 代码时，能拿到**中文、带版本基线、可溯源**的答案，而不是凭记忆编。

## 0. 一条不变量的约定（所有接入方式通用）

**`citations` 为空 = 没有依据 = 拒答。** 请把这种情况当作"站内没有答案"，
不要让 Agent 把 `answer` 字段当成事实继续推理。拒答会区分两种原因：

- `no-match`：站内确实没有相关内容 → 建议换问法或去社区提问；
- `untranslated`：**官方有这一页，但中文尚未翻译** → 返回 `suggestions`，含官方英文原文链接。

## 0.5 引用必须可核验（本站在 Agent 时代的主张）

我们不做"请引用我"这种请求，而是让**引用本身可被独立核验**。任何答案里的引用都带两个字段：

| 字段 | 用途 |
| --- | --- |
| `citationId` | 规范化 ID：`ecn:<slug>@<commit7>#<anchor>` —— 写进你的结论里 |
| `citeUrl` | 可解引用的静态地址：`/cite/<digest>.json` |

解引用后你会拿到：当前原文片段 `chunkText`、内容指纹 `contentHash`、上游基线 `upstreamCommit`、
以及**该基线下的官方原文** `upstreamRawUrl`。于是你可以机械地做三件事：

```bash
# 全部可引用证据的索引
curl -s https://effect-ts.cn/cite/index.json | jq '{count, staleCount}'

# 单条证据
curl -s https://effect-ts.cn/cite/<digest>.json \
  | jq '{citationId, upstreamCommit, contentHash, upstreamRawUrl, head: (.chunkText[0:40])}'
```

1. **核验引用**：`record.chunkText.includes(quote)` —— 引用是不是原文的逐字子串；
2. **检测漂移**：`record.upstreamCommit` 与你引用时的基线不同 ⇒ 译文已更新，结论可能过时；
3. **回到源头**：`record.upstreamRawUrl` 是官方文件在该 commit 下的原始内容，可逐字核对译文。

> 地址只由 `(slug, anchor)` 决定，所以**译文更新不会让旧引用 404**，只会让基线 / 指纹变化 ——
> 这正是漂移信号：地址稳定，内容可比对。

## 1. MCP Server（推荐）

### 1.0 从 npm 装（给外部用户）

包已配置为可发布：**`effect-ts-cn-mcp`** —— 零依赖、离线自包含（语料内联进产物）。

```bash
npx -y effect-ts-cn-mcp
claude mcp add effect-ts-cn -- npx -y effect-ts-cn-mcp    # Claude Code
```

为什么必须**打包**而不是直接发 TS：这个包依赖工作区内的 `@ecn/knowledge`（`workspace:*`），
而 **npm 上不存在那个包** —— 直接发布，别人 `npx` 会立刻解析失败。
`pnpm --filter @ecn/mcp bundle` 把代码、语料（5.8MB JSON）、术语表一起打进
`dist/cli.js`（约 7.8MB，压缩后 1.3MB）。

顺带修掉一个发布阻塞点：术语表原本是**运行期按相对路径读 `docs/glossary.json`** 的，
发布后那些路径一个都不存在，`glossary` 工具会静默返回兜底文案 —— 已改成静态导入让打包器内联。

仓库内自带、离线自包含（语料随包提交，无需网络）：

```bash
pnpm install
pnpm mcp        # 等价于 pnpm --filter @ecn/mcp start（stdio JSON-RPC）
```

配置示例（Claude Code / Cursor 等）：

```json
{
  "mcpServers": {
    "effect-ts-cn": {
      "command": "pnpm",
      "args": ["--dir", "/绝对路径/effect-ts.cn/apps/mcp", "start"]
    }
  }
}
```

暴露的工具：

| 工具 | 入参 | 返回 |
| --- | --- | --- |
| `search_docs` | `query`、`limit?`、`version?` | 中文页面与小节列表（含官方原文链接） |
| `get_page` | `slug`（如 `v4/getting-started/installation`） | 该页完整 Markdown + 上游路径与基线 |
| `ask` | `question`、`scope?` | 带引用的回答（含 `citationId` / `citeUrl` / 原文）；无依据时明确拒答 |
| `cite` | `key`（digest / `slug#anchor` / citationId） | 解引用并核验一条引用：原文片段、内容指纹、基线、官方原文地址 |
| `glossary` | — | 术语门禁（禁止的译法）与原则 |
| `translation_status` | `slug?` | 单页或总体的翻译状态与上游基线 |

另有 **resources**（可订阅地址，不必先提问）与 **prompts**（把社区工作流固化成指令）：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| resource | `effect-cn://docs/<slug>` | 某页中文译文（Markdown，带基线头） |
| resource | `effect-cn://citations` | 全部可引用证据的索引（citationId / citeUrl / 锚点 / 是否落后） |
| prompt | `translate_page` | 翻译一页并产出**提案**（含治理规则，不允许自我发布） |
| prompt | `answer_with_evidence` | 带可核验引用地回答；没依据就拒答 |
| prompt | `review_proposal` | 审阅一条提案并给出可执行修改意见 |

> 传输协议是 stdio 上按行分隔的 JSON-RPC 2.0（`initialize` / `tools/*` / `resources/*` / `prompts/*`），
> 实现见 `apps/mcp/src/server.ts`，并有端到端测试 `apps/mcp/test/mcp.test.ts`。

## 2. HTTP API（适合只发请求的 Agent）

```bash
# 追问（JSON）
curl -s -X POST http://localhost:8787/api/knowledge/ask \
  -H 'content-type: application/json' \
  -d '{"question":"怎么把 Promise 包成 Effect？"}' | jq '{refused, mode, answer, citations: [.citations[] | {slug, anchor, commit}]}'

# 便于脚本/GET
curl -s "http://localhost:8787/api/knowledge/ask?q=%E6%80%8E%E4%B9%88%E5%AE%89%E8%A3%85"

# 语料规模 / 是否启用模型
curl -s http://localhost:8787/api/knowledge/stats

# 报错定位（S2）：提取报错里的 API/类型/错误码 → 相关文档小节
curl -s -X POST http://localhost:8787/api/knowledge/explain \
  -H 'content-type: application/json' \
  -d '{"errorText":"TS2345: Argument of type '"'"'Effect<number>'"'"' is not assignable","code":"console.log(Effect.succeed(1) + 1)"}' \
  | jq '{identifiers, refused, citations: [.citations[] | {slug, anchor}]}'
```

`explain` 与 `ask` 共享同一套引用不变量：`citations` 为空即"没有依据"。
未配置模型时它**只做定位**（答案里会写明"不是自动诊断结论"）；配置模型后以 `diagnose` 意图给出诊断，
引用仍然只来自检索结果。

### 2.1 多轮追问（`history`）

`ask` 可以带最近几轮（最多 3 轮）的"问题 + 引用了哪里"，服务端据此做**指代消解**：

```bash
curl -s -X POST http://localhost:8787/api/knowledge/ask \
  -H 'content-type: application/json' \
  -d '{"question":"它怎么装？",
       "history":[{"question":"Effect 是什么？",
                   "citations":[{"slug":"v4/getting-started/why-effect","title":"为什么选择 Effect？","anchor":"intro"}]}]}' \
  | jq '{refused, mode, resolvedQuestion, answer, citations: [.citations[] | {slug, anchor}]}'
```

| 字段 | 含义 |
| --- | --- |
| 请求 `history[].question` / `.citations[]` | 只传"问题 + 引用了哪一页哪一节"。**不要传上一轮的模型正文** —— 那会让幻觉跨轮传染 |
| 响应 `resolvedQuestion` | 本轮**实际送去检索**的问题（仅当它与 `question` 不同才出现）。追问被改写成什么样，一眼可见 —— 这既是可读性，也是防胡说的手段 |
| 响应 `expandedQueries` | 本轮用过的**术语化改写查询**（仅当发生过扩展才出现）。纯词法检索查不到的白话，靠它补召回 |

配上模型（`.env` 里的 `DEEPSEEK_API_KEY` 或任意 OpenAI 兼容配置）后，服务端会多做四件事，**每一步失败都只是"这一步不做"**：

1. **改写查询**（有 `history` 时）：把「它呢？」「那 v3 呢？」补全成可独立检索的查询；
2. **扩展查询**（第一次检索偏弱时）：白话 → 术语（实测「怎么让两件事同时跑？」纯 BM25 会拒答，扩展后命中 Fiber / 并发），与原结果做 RRF 融合；
3. **重排候选**：只换引用顺序，**不增删候选**；
4. **合成答案**：把检索到的证据写成中文（引用仍由检索层构造）。

**引用不变量在多轮里一条都不放松**：每轮都重新检索、每轮都带 `citations`、为空即拒答；
模型能碰的只有"查询"与"候选顺序"，碰不到"引用从哪来"。

限流：默认 20 次/分钟（按 `x-forwarded-for` 或来源地址），超限返回
`429` + `RateLimitedError`（含 `retryAfterSeconds`，建议按其退避重试）。

## 3. 静态文本端点（适合"只会 fetch"的 Agent）

| 端点 | 用途 |
| --- | --- |
| `/llms.txt` | 站点导览：已翻译文档、导航、博客、入口 |
| `/llms-full.txt` | **全量**中文译文（Markdown 拼接，含每页上游路径与基线） |
| `/docs/<slug>.md` | 单页 Markdown（如 `/docs/v4/getting-started/installation.md`） |
| `/cite/index.json` | 全部可引用证据的索引（citationId / citeUrl / 锚点 / 是否落后） |
| `/cite/<digest>.json` | 单条证据：原文片段、内容指纹、上游基线、该基线下的官方原文地址 |

这些是纯静态文件，适合放进 Agent 的检索语料；`<!-- ... -->` 注释里带着来源、
上游文件路径、基线 commit、原页面与官方原文地址，便于回答时给出可核查的引用。

## 3.5 可分享的提问 URL（人类与 Agent 通用）

```
https://effect-ts.cn/ask?q=怎么把 Promise 包成 Effect
```

`/ask?q=...` 打开即提问，地址栏随提问同步（可收藏、可贴进 Issue/群聊）。
它返回的是人类可读的 HTML（不含结构化引用）——需要结构化结果时请用 §1 的 MCP 或 §2 的 HTTP。

## 3.8 MCP 为什么是 extractive（刻意的）

MCP 的 `ask` / `search_docs` **不调用任何模型**，即使部署方配置了 DeepSeek：

- 调用方本身就是一个 LLM —— 它需要的是**证据**（带锚点的原文片段），不是另一段润色文字；
- 确定性输出便于它做二次推理与引用核对，也省掉一次模型往返的费用与延迟；
- 因此 MCP 在零 Key 环境下也能完整工作。

需要"润色后的中文答案"时用 HTTP `POST /api/knowledge/ask`（会按配置走 DeepSeek / OpenAI 兼容）。

## 4. 为什么不让 Agent 直接用英文模型记忆

| 风险 | 本站的约束 |
| --- | --- |
| 版本漂移（v3/v4 API 变化） | 每个切片都绑定 `version` 与上游 `commit`；落后会显式提示 |
| 编造 API 名 | 引用只能来自检索结果（模型无法自造链接） |
| 术语不一致（Layer → "图层"） | AI 输出必须过与译文相同的术语门禁，违反则回退 |
| 中文资料过期 | 每日上游同步流水线比对基线，落后会自动开 issue |

## 5. 参与与反馈

- 发现答案有问题？请开 [Issue](https://github.com/aaronlou/effect-ts.cn/issues/new)（附上问题与引用页面）。
- 想改进检索或增加工具？`packages/knowledge` 有 recall@3 与引用不变量测试，
  改完请确保 `pnpm test` 通过（含 MCP 协议测试）。
