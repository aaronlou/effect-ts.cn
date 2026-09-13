#!/usr/bin/env node
/**
 * 报错百科的**播种跑批**。
 *
 * ── 它解决什么 ────────────────────────────────────────────────────────
 * 报错百科现在只有几条（靠真实用户提问攒出来的），而它的价值要靠**覆盖面**：
 * 中文开发者撞上 Effect 的报错时搜得到，这个站才有意义。
 * 这个脚本把 `apps/api/seed-cases/` 里的用例跑一遍，取**真实报错**喂给 `/debug`，
 * 让条目一次性成型，而不是等用户一条条问出来。
 *
 * ── 一条纪律：报错必须是真跑出来的 ──────────────────────────────────
 * 用例文件是**真的会失败**的代码，报错由 `tsc` 或 `tsx` 实际产生 —— 不手写。
 * 所以每条错误文本都能被独立复现，百科里的条目才站得住。
 *
 * 判据只有一条：**先 tsc；编译器不报错，就实际运行它。**
 * 于是"编译期类型报错"与"运行期报错"用同一套流程处理，不需要在用例上标元数据。
 *
 * 用法：
 *   node scripts/seed-errors.mjs                 # 播种到线上
 *   node scripts/seed-errors.mjs --dry           # 只生成报错，不调用接口
 *   node scripts/seed-errors.mjs --only 11-12    # 只跑文件名含该子串的
 *   node scripts/seed-errors.mjs --api http://127.0.0.1:8787
 */
import { execFileSync } from "node:child_process"
import { readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const API_DIR = path.join(ROOT, "apps/api")
const CASES_DIR = path.join(API_DIR, "seed-cases")

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const api = flag("--api", "https://effect-ts.cn").replace(/\/+$/, "")
const only = flag("--only", "")
const dry = args.includes("--dry")

const TSC_ARGS = [
  "--noEmit", "--strict", "--target", "es2022",
  "--module", "esnext", "--moduleResolution", "bundler", "--skipLibCheck"
]

/** 跑 `tsc`，返回编译错误文本（没有错误则为空串） */
const compileError = (file) => {
  try {
    execFileSync(path.join(API_DIR, "node_modules/.bin/tsc"), [...TSC_ARGS, path.relative(API_DIR, file)], {
      cwd: API_DIR, encoding: "utf8", stdio: "pipe"
    })
    return ""
  } catch (error) {
    return String(error.stdout ?? "").trim()
  }
}

/** 实际运行它，返回崩溃输出（正常结束则为空串） */
const runtimeError = (file) => {
  /**
   * **无论退出码都捕获输出**。
   *
   * 用例有两种写法，都要能拿到报错：
   *   · 未捕获崩溃 → 非零退出，报错在 stderr；
   *   · 应用自己 catch 后 `console.error(String(e))` → 零退出，报错在 stderr。
   * 后一种才是**用户真正会复制的形态**（`(FiberFailure) Error: ...`），
   * 所以不能只认非零退出。
   */
  const run = (bin) => {
    try {
      return execFileSync(bin, [path.relative(API_DIR, file)], {
        cwd: API_DIR, encoding: "utf8", stdio: "pipe", timeout: 30_000
      })
    } catch (error) {
      return `${error.stdout ?? ""}${error.stderr ?? ""}`
    }
  }
  const out = run(path.join(API_DIR, "node_modules/.bin/tsx"))
  return stripNodePreamble(out)
}

/**
 * 去掉 Node 自己打印的**未捕获异常前言**。
 *
 * `tsx` 崩溃时会先打这几行：`node:internal/modules/run_main:107` / `triggerUncaughtException(` / `^`。
 * 它们跟报错本身无关，而且**不是用户会去看的部分** —— 用户复制的、搜索的是后面那句
 * `(FiberFailure) Error: Service not found: ...`。
 * 留着会把百科条目的"报错原文"弄成一段 Node 内部路径，既不美观也不可搜。
 */
const stripNodePreamble = (text) =>
  text
    .split("\n")
    .filter((line) => !/^node:internal\//.test(line))
    .filter((line) => !/^\s*triggerUncaughtException\(\s*$/.test(line))
    .filter((line) => !/^\s*\^\s*$/.test(line))
    .join("\n")
    .trim()

/**
 * 把**本机绝对路径**换成中性占位符，再喂给接口。
 *
 * 不加这一步，播种出来的百科条目里会印着 `/Users/<某人>/.../effect-ts.cn/apps/api/seed-cases/...` ——
 * 既泄露了打包机的目录结构，也让"报错原文"这个样本变得不通用。
 *
 * 注意：这只影响**存下来展示的样本**；报错签名本来就会把路径归一化掉（见 error-signature.ts），
 * 所以去重不受影响。
 */
const neutralisePaths = (text) =>
  text
    .split(ROOT)
    .join("<project>")
    .replace(/\/Users\/[^/\s)]+/g, "<home>")
    .replace(/\/home\/[^/\s)]+/g, "<home>")

/** 答案质量判定 —— 只用来**报告**，不自动删条目（删除是不可恢复的，留给人决定） */
const judge = (result) => {
  if (result.refused === true) return { verdict: "拒答", ok: false }
  const citations = result.citations ?? []
  if (citations.length === 0) return { verdict: "无引用", ok: false }
  // 这类措辞说明模型找不到依据、只做了免责声明 —— 对百科条目没有价值
  if (/无法确定|未涉及|无法据此|没有.{0,8}关于/.test(String(result.answer ?? ""))) {
    return { verdict: "答案无实质内容", ok: false }
  }
  return { verdict: "有实质答案", ok: true }
}

const files = readdirSync(CASES_DIR)
  .filter((f) => f.endsWith(".ts"))
  .filter((f) => only === "" || f.includes(only))
  .sort()

if (files.length === 0) {
  console.error(`✘ 没有匹配的用例（目录 ${path.relative(ROOT, CASES_DIR)}，筛选「${only}」）`)
  process.exit(1)
}

console.log(`\n===== 报错百科播种（${files.length} 个用例${dry ? "，dry-run" : ""}）=====\n`)
console.log(`  ${"用例".padEnd(28)} ${"类型".padEnd(6)} ${"结果".padEnd(16)} 引用`)

const records = []
let okCount = 0

for (const file of files) {
  const full = path.join(CASES_DIR, file)
  const compiled = compileError(full)
  const kind = compiled !== "" ? "编译期" : "运行期"
  const errorText = neutralisePaths(compiled !== "" ? compiled : runtimeError(full))
  const name = file.replace(/\.ts$/, "")

  if (errorText === "") {
    console.log(`  ${name.padEnd(28)} ${kind.padEnd(6)} ⚠ 没有产生报错（用例写错了？）`)
    records.push({ file, kind, errorText: "", verdict: "用例无报错", ok: false })
    continue
  }

  if (dry) {
    console.log(`  ${name.padEnd(28)} ${kind.padEnd(6)} ${"（dry）".padEnd(16)} ${errorText.split("\n")[0].slice(0, 58)}`)
    records.push({ file, kind, errorText, verdict: "dry", ok: false })
    continue
  }

  let result
  try {
    const response = await fetch(`${api}/api/knowledge/explain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ errorText }),
      signal: AbortSignal.timeout(120_000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    result = await response.json()
  } catch (error) {
    console.log(`  ${name.padEnd(28)} ${kind.padEnd(6)} ✘ 请求失败：${String(error).slice(0, 40)}`)
    records.push({ file, kind, errorText, verdict: "请求失败", ok: false })
    continue
  }

  const { verdict, ok } = judge(result)
  if (ok) okCount += 1
  const titles = (result.citations ?? []).slice(0, 3).map((c) => "《" + c.title + "》").join(" ")
  console.log(
    `  ${name.padEnd(28)} ${kind.padEnd(6)} ${(ok ? "✔ " : "✘ ") + verdict.padEnd(14)} ${titles}`
  )
  records.push({
    file, kind, verdict, ok,
    identifiers: result.identifiers ?? [],
    citations: (result.citations ?? []).map((c) => c.title),
    answerHead: String(result.answer ?? "").replace(/\s+/g, " ").slice(0, 160),
    errorHead: errorText.split("\n").slice(0, 2).join(" ⏎ ").slice(0, 200)
  })
}

const out = path.join(ROOT, "scripts", ".seed-report.json")
writeFileSync(out, `${JSON.stringify(records, null, 1)}\n`)
console.log(`\n  合计：${okCount} / ${records.length} 条有实质答案`)
console.log(`  明细已写入 ${path.relative(ROOT, out)}（含每条的真实报错原文与答案开头，便于人工复核）`)
if (okCount < records.length) {
  console.log("  未达标的那几条**不会自动删除** —— 删除不可恢复；请人工看一眼明细再决定。\n")
}
