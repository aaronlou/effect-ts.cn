/**
 * MCP Server 入口（stdio）。
 *
 * 用法（Claude Code / Cursor / 任何支持 MCP 的 Agent）：
 *   {
 *     "mcpServers": {
 *       "effect-ts-cn": { "command": "pnpm", "args": ["--dir", "<repo>/apps/mcp", "start"] }
 *     }
 *   }
 * 注意：stdout 只用于 JSON-RPC，日志一律走 stderr。
 */
import { serveStdio } from "./server.js"

process.stderr.write(
  "[effect-ts-cn-mcp] 已启动：提供 search_docs / get_page / ask / glossary / translation_status\n"
)

await serveStdio()
