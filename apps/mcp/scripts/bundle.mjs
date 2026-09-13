#!/usr/bin/env node
/**
 * 把 MCP server 打成**零依赖单文件**，用于发布到 npm。
 *
 * ── 为什么必须打包，而不是直接发 TS ───────────────────────────────────
 * 这个包依赖工作区内的 `@ecn/knowledge`（`workspace:*`），而**npm 上不存在这个包**
 * —— 直接发布，别人 `npx` 会立刻解析失败。所以要把代码、语料、术语表一起打进产物：
 *
 *   · 语料（corpus.json，约 5.8MB）：静态 import，esbuild 内联 → 这是"离线自包含"的实现；
 *   · 术语表（docs/glossary.json）：原本是运行期按相对路径读文件的，
 *     发布后那些路径一个都不存在（已改成静态导入）；
 *   · 运行时依赖：只有 node 内建（协议是自己实现的，没有 MCP SDK）→ 产物真的零依赖。
 *
 * 刻意**不 minify**：出错时栈要能对上源码。体积换可读性，这个包的值。
 */
import { build } from "esbuild"
import { rmSync } from "node:fs"

rmSync("dist", { recursive: true, force: true })

const result = await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  loader: { ".json": "json" },
  // 让产物自带 shebang，`npx` 才能直接执行
  banner: { js: "#!/usr/bin/env node" },
  minify: false,
  sourcemap: false,
  metafile: true,
  logLevel: "warning"
})

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0
console.log(`  ✔ dist/cli.js  ${(bytes / 1024 / 1024).toFixed(1)} MB（含内联语料，零运行时依赖）`)
