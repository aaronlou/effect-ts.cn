/**
 * bootstrap · `.env` 加载（显式、可预测、可观察）
 *
 * 为什么不用一行 `import "dotenv/config"`：
 * 它只在 **cwd** 找 `.env`，而本仓库的进程 cwd 是 `apps/api`（`pnpm --filter @ecn/api dev`），
 * 于是"按 README 把 Key 填进仓库根目录的 `.env`"**根本不会被读到** —— 配置看着没问题，
 * 行为却是"AI 变笨了"，属于最难发现的一类问题。
 *
 * 这里按固定优先级依次加载，先命中者生效（`dotenv` 默认不覆盖已存在的 `process.env`）：
 *   1. `apps/api/.env.local`  2. `apps/api/.env`
 *   3. 仓库根 `.env.local`    4. 仓库根 `.env`
 * 命令行/容器注入的环境变量永远优先（因为它们在加载前就已存在）。
 */
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { config } from "dotenv"

const here = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(here, "../..")
const repoRoot = path.resolve(apiRoot, "../..")

const candidates = [
  path.join(apiRoot, ".env.local"),
  path.join(apiRoot, ".env"),
  path.join(repoRoot, ".env.local"),
  path.join(repoRoot, ".env")
]

const loaded: Array<string> = []
for (const file of candidates) {
  if (!existsSync(file)) continue
  config({ path: file, quiet: true })
  loaded.push(path.relative(repoRoot, file))
}

/** 已加载的 env 文件（相对仓库根；供启动日志与 `llm:check` 展示） */
export const loadedEnvFiles: ReadonlyArray<string> = loaded

export const describeLoadedEnv = (): string =>
  loaded.length === 0
    ? "（未找到 .env：可用 `cp .env.example .env` 创建；不配也能运行 —— extractive 模式）"
    : loaded.join(", ")
