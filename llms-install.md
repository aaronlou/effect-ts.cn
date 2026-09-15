# 安装 effect-ts-cn-mcp（给 Agent 的说明）

本仓库提供一个 MCP server：**Effect (TypeScript) 官方文档的中文译文检索**。

| | |
| --- | --- |
| 包名 | `effect-ts-cn-mcp`（npm） |
| 传输 | stdio |
| 运行时 | Node ≥ 20 |
| 依赖 | **零**运行时依赖（语料已打进单文件） |
| API key | **不需要**，且没有任何网络请求 |
| 工具 | `search_docs` · `get_page` · `ask` · `glossary` · `translation_status` · `cite` |

## 最短路径

写进 MCP 配置即可，**不需要 clone、不需要 build、不需要装依赖**：

```json
{
  "mcpServers": {
    "effect-ts-cn": {
      "command": "npx",
      "args": ["-y", "effect-ts-cn-mcp"]
    }
  }
}
```

各客户端的等价做法：

```bash
# Claude Code
claude mcp add effect-ts-cn -- npx -y effect-ts-cn-mcp

# 其它客户端（Cursor / Windsurf / VS Code Copilot / Cline 等）
# 都是同一组 command + args，格式差异只是外壳
```

## 怎么确认装好了

启动后 `tools/list` 应返回上面那 **6 个**工具。没有返回就是没起来，按顺序查：

1. `node -v` 是否 ≥ 20
2. `npx -y effect-ts-cn-mcp` 能否直接跑起来（stdout 只走 JSON-RPC，日志在 stderr）
3. 单个工具自测：调 `search_docs`，query 传 `Layer 依赖注入`，应当返回带官方原文链接的若干页

## 从源码跑（只在你打算改它时才需要）

```bash
pnpm install
pnpm --filter effect-ts-cn-mcp bundle   # 打成零依赖单文件 dist/cli.js（语料内联）
node apps/mcp/dist/cli.js
```

## 不要做的事

- **不要**先 `npm install` 到本地再跑 —— `npx -y` 每次取最新即可，本地安装没有收益
- **不要**给它配 API key 或任何环境变量 —— 它不读；配了不会生效，只会让你以为配置有问题
- **不要**在 `ask` 返回 `citations: []` 时判定为故障 —— 站内没有依据时**明确拒答是设计**。
  理由：这个 server 的立场是答案必须能回到原文，宁可说"不知道"
- **不要**指望它回答 Effect 之外的问题 —— 语料只有 Effect 官方文档的中文译文（234 页，v3 + v4）

## 想核对它给的引用

每条引用都带 `citationId` 与可解引用地址（`https://effect-ts.cn/cite/<digest>.json`），
里面有引文原文、内容指纹、上游基线与官方原文地址。用 `cite` 工具可以就地核验一条引用是否
仍然成立、是否已经漂移 —— **不要凭记忆判断引用过没过期**。
