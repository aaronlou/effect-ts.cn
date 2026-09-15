#!/usr/bin/env node
/**
 * 把 MCP server 打成 **MCPB bundle**（`.mcpb`）。
 *
 * ── 为什么要这个产物 ──────────────────────────────────────────────────
 * Smithery 的本地分发通道只收 MCPB；它也是 Claude Desktop 双击安装的格式。
 * 我们的 MCP 是 stdio 的、没有公网 HTTP 端点，所以走 URL 那条路走不通，
 * MCPB 是唯一能上架的方式。
 *
 * ── 为什么这个 bundle 很便宜 ──────────────────────────────────────────
 * MCPB 就是个 zip：`manifest.json` + `server/`。而宿主自带 Node，
 * `dist/cli.js` 又是 esbuild 打好的**零依赖单文件**（语料已内联），
 * 所以既不用打包 `node_modules`，也不用带运行时 —— 一份 manifest 加一个文件就是全部。
 *
 * ── 为什么脚本里有冒烟测试 ────────────────────────────────────────────
 * "zip 能解开"和"装上去能用"是两件事。这里把包**解压到临时目录**、用
 * `node server/cli.js` 真的跑一次 stdio JSON-RPC（initialize + tools/list），
 * 断言工具清单回来了。否则等 Smithery 扫描失败时，你面对的是别人的报错。
 *
 * 用法：
 *   pnpm mcp:mcpb            # 打包 + 冒烟
 *   pnpm mcp:mcpb -- --no-smoke
 */
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DIST = path.join(ROOT, "dist")
const ENTRY = path.join(DIST, "cli.js")
const MANIFEST = path.join(ROOT, "mcpb", "manifest.json")
/** 图标复用站点的那份：同一张图既随 bundle 分发，也能从 https://effect-ts.cn/logo-400.png 直接取 */
const ICON = path.join(ROOT, "..", "site", "public", "logo-400.png")
const STAGE = path.join(DIST, "mcpb")
const smoke = !process.argv.includes("--no-smoke")

const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"))
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"))

/** 版本必须与 package.json 一致：否则 bundle 里报的版本和 npm 上的对不上 */
if (manifest.version !== pkg.version) {
  console.error(
    `✘ 版本不一致：mcpb/manifest.json 是 ${manifest.version}，package.json 是 ${pkg.version}\n` +
      `  两边必须一起改 —— 分发出去的 bundle 会声称自己是个不存在的版本。`
  )
  process.exit(1)
}

if (!existsSync(ENTRY)) {
  console.error("✘ 找不到 dist/cli.js。先跑 `pnpm mcp:bundle` 把 server 打成零依赖单文件。")
  process.exit(1)
}
if (manifest.server.entry_point !== "server/cli.js") {
  console.error(`✘ manifest 的 entry_point（${manifest.server.entry_point}）与打包布局不符`)
  process.exit(1)
}

if (!existsSync(ICON)) {
  console.error(`✘ 找不到图标 ${ICON} —— manifest 声明了 ${manifest.icon}，缺了宿主会显示裂图。`)
  process.exit(1)
}
if (manifest.icon !== "icon.png") {
  console.error(`✘ manifest 的 icon（${manifest.icon}）与打包布局不符，应为 icon.png`)
  process.exit(1)
}

rmSync(STAGE, { recursive: true, force: true })
mkdirSync(path.join(STAGE, "server"), { recursive: true })
cpSync(MANIFEST, path.join(STAGE, "manifest.json"))
cpSync(ENTRY, path.join(STAGE, "server", "cli.js"))
cpSync(ICON, path.join(STAGE, "icon.png"))

const out = path.join(DIST, `${manifest.name}-${manifest.version}.mcpb`)
rmSync(out, { force: true })

const zip = await run("zip", ["-r", "-X", "-q", out, "."], { cwd: STAGE })
if (zip.code !== 0) {
  console.error(`✘ zip 失败：${zip.stderr || zip.stdout}`)
  process.exit(1)
}

const bundleBytes = statSync(out).size
console.log(`  ✔ ${path.relative(process.cwd(), out)}  ${(bundleBytes / 1024 / 1024).toFixed(1)} MB`)

if (!smoke) {
  console.log("  （已跳过冒烟测试）")
  process.exit(0)
}

/** 解压后真的跑一次：zip 能解开 ≠ 装上去能用 */
const probe = path.join(tmpdir(), `ecn-mcpb-${Date.now()}`)
mkdirSync(probe, { recursive: true })
const unzip = await run("unzip", ["-q", out, "-d", probe])
if (unzip.code !== 0) {
  console.error(`✘ 解压失败：${unzip.stderr || unzip.stdout}`)
  process.exit(1)
}

for (const required of ["manifest.json", "server/cli.js", "icon.png"]) {
  if (!existsSync(path.join(probe, required))) {
    console.error(`✘ bundle 里缺少 ${required}`)
    process.exit(1)
  }
}

const requests = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mcpb-smoke", version: "0" } }
  },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
]

const smokeRun = await run("node", [path.join(probe, "server", "cli.js")], {
  stdin: `${requests.map((r) => JSON.stringify(r)).join("\n")}\n`,
  timeoutMs: 30000
})

const responses = smokeRun.stdout
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  })
  .filter(Boolean)

const toolsResponse = responses.find((response) => response.id === 2)
const tools = toolsResponse?.result?.tools ?? []
if (tools.length === 0) {
  console.error("✘ 冒烟失败：解压后的 bundle 没有返回工具清单")
  console.error(`  stdout: ${smokeRun.stdout.slice(0, 500)}`)
  console.error(`  stderr: ${smokeRun.stderr.slice(0, 500)}`)
  rmSync(probe, { recursive: true, force: true })
  process.exit(1)
}

// 声称的工具必须真的都在（manifest 是给宿主看的门面，不能和实现对不上）
const declared = new Set(manifest.tools.map((tool) => tool.name))
const actual = new Set(tools.map((tool) => tool.name))
const missing = [...declared].filter((name) => !actual.has(name))
if (missing.length > 0) {
  console.error(`✘ manifest 声明了但 server 没有的工具：${missing.join(", ")}`)
  rmSync(probe, { recursive: true, force: true })
  process.exit(1)
}

rmSync(probe, { recursive: true, force: true })
console.log(`  ✔ 冒烟通过：解压后启动，返回 ${tools.length} 个工具（manifest 声明的 ${declared.size} 个都在）`)

/** 跑一个子进程，收集 stdout/stderr；可选喂 stdin 与超时 */
function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      stderr += "\n(超时被杀)"
      finish(124)
    }, options.timeoutMs ?? 120000)

    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", (error) => {
      stderr += String(error)
      finish(1)
    })
    child.on("close", (code) => finish(code ?? 0))

    if (options.stdin !== undefined) child.stdin.end(options.stdin)
    else child.stdin.end()
  })
}
