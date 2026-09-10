# Agent 接入指南（把中文 Effect 知识接进你的编码 Agent）

> 面向：Claude Code、Cursor、DSH、以及任何支持 MCP 或只会 `fetch` 的 Agent。
> 目标：让 Agent 在写 Effect 代码时，能拿到**中文、带版本基线、可溯源**的答案，而不是凭记忆编。

## 0. 一条不变量的约定（所有接入方式通用）

**`citations` 为空 = 没有依据 = 拒答。** 请把这种情况当作"站内没有答案"，
不要让 Agent 把 `answer` 字段当成事实继续推理。拒答会区分两种原因：

- `no-match`：站内确实没有相关内容 → 建议换问法或去社区提问；
- `untranslated`：**官方有这一页，但中文尚未翻译** → 返回 `suggestions`，含官方英文原文链接。

## 1. MCP Server（推荐）

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
| `ask` | `question`、`scope?` | 带引用的回答；无依据时明确拒答 |
| `glossary` | — | 术语门禁（禁止的译法）与原则 |
| `translation_status` | `slug?` | 单页或总体的翻译状态与上游基线 |

> 传输协议是 stdio 上按行分隔的 JSON-RPC 2.0（`initialize` / `tools/list` / `tools/call`），
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

限流：默认 20 次/分钟（按 `x-forwarded-for` 或来源地址），超限返回
`429` + `RateLimitedError`（含 `retryAfterSeconds`，建议按其退避重试）。

## 3. 静态文本端点（适合"只会 fetch"的 Agent）

| 端点 | 用途 |
| --- | --- |
| `/llms.txt` | 站点导览：已翻译文档、导航、博客、入口 |
| `/llms-full.txt` | **全量**中文译文（Markdown 拼接，含每页上游路径与基线） |
| `/docs/<slug>.md` | 单页 Markdown（如 `/docs/v4/getting-started/installation.md`） |

这些是纯静态文件，适合放进 Agent 的检索语料；`<!-- ... -->` 注释里带着来源、
上游文件路径、基线 commit、原页面与官方原文地址，便于回答时给出可核查的引用。

## 3.5 可分享的提问 URL（人类与 Agent 通用）

```
https://effect-ts.cn/ask?q=怎么把 Promise 包成 Effect
```

`/ask?q=...` 打开即提问，地址栏随提问同步（可收藏、可贴进 Issue/群聊）。
它返回的是人类可读的 HTML（不含结构化引用）——需要结构化结果时请用 §1 的 MCP 或 §2 的 HTTP。

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
