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
import { readFileSync, rmSync } from "node:fs"

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

/**
 * 产物自检：**体积不对就直接失败**。
 *
 * 为什么值得一道闸：`npm publish` 的 `prepublishOnly` 会跑这个脚本，
 * 而如果打包悄悄退化（语料没内联进去、入口没打进来），发布出去的会是一个**坏包** ——
 * 更糟的是它"看起来发布成功了"。语料约 5.8MB，成品不可能小于 1MB。
 */
/**
 * 依赖自检：**运行时依赖必须是空的**。
 *
 * 这个包把一切都打进了 `dist/cli.js`（含语料与术语表），所以发布出去的 package.json
 * 不该声明任何 `dependencies`。尤其是 `@ecn/knowledge: workspace:*` ——
 * 那是 **pnpm 专有协议，npm 上不存在这个包**，`npx` 会直接解析失败。
 *
 * 这类问题最坏的地方是**发布本身会成功**：`npm publish` 高高兴兴返回 200，
 * 坏在别人装的那一刻。所以宁可在打包这一步就拦住。
 */
const declared = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const runtime = Object.entries(declared.dependencies ?? {})
if (runtime.length > 0) {
  console.error(
    `✘ 这个包声明了运行时依赖：${runtime.map(([k, v]) => `${k}@${v}`).join(", ")}\n` +
      "  产物已自带全部代码，依赖会让 `npx` 解析失败（尤其是 workspace: 协议）。拒绝打包。"
  )
  process.exit(1)
}

if (bytes < 1_000_000) {
  console.error(
    `✘ 产物只有 ${(bytes / 1024).toFixed(0)} KB —— 语料（约 5.8MB）多半没被内联进来。拒绝发布。`
  )
  process.exit(1)
}
