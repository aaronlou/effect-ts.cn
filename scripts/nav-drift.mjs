#!/usr/bin/env node
/**
 * 比对两份 `docs-nav.json` 的**结构**是否一致（upstream-sync 巡检用）。
 *
 * ── 为什么不能直接 `diff` ──────────────────────────────────────────────
 * 生成出来的 nav 里带着两个每次都会变的字段：
 *   · `generatedFrom.head` —— 上游当前 commit（上游一有新提交就变）
 *   · `generatedFrom.generatedAt` —— 生成时刻
 * 直接比对文件，**恒为"有漂移"**，于是这条巡检每天都在报一个假警报
 * （实测：结构完全一致，只有这两行不同）。
 *
 * 这条巡检想问的其实是：**上游的目录结构 / 侧边栏组织变了吗？**
 * 所以只比 `versions` 这一段 —— 除此之外的元信息一律忽略。
 *
 * 用法：
 *   node scripts/nav-drift.mjs <新生成的 nav.json> <仓库里已提交的 nav.json>
 *
 * 退出码：0 = 结构一致；1 = 有漂移；2 = 参数或文件有问题（与"有漂移"区分开 ——
 * 读不到文件时不该报成"漂移"，那是把"不知道"说成"有问题"）。
 */
import { readFileSync } from "node:fs"

const [nextPath, committedPath] = process.argv.slice(2)
if (nextPath === undefined || committedPath === undefined) {
  console.error("用法：node scripts/nav-drift.mjs <新生成的 nav.json> <已提交的 nav.json>")
  process.exit(2)
}

/** 递归排序对象键：JSON.stringify 的结果受键序影响，而键序不该算作"漂移" */
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    )
  }
  return value
}

const readVersions = (file) => {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"))
    return { ok: true, versions: parsed.versions }
  } catch (cause) {
    console.error(`读不到或解析不了 ${file}：${cause instanceof Error ? cause.message : String(cause)}`)
    return { ok: false }
  }
}

const next = readVersions(nextPath)
const committed = readVersions(committedPath)
if (!next.ok || !committed.ok) process.exit(2)

const diffPaths = []
const walk = (a, b, prefix) => {
  const aKeys = Object.keys(a ?? {})
  const bKeys = Object.keys(b ?? {})
  for (const key of new Set([...aKeys, ...bKeys])) {
    const path = prefix === "" ? key : `${prefix}.${key}`
    const av = a?.[key]
    const bv = b?.[key]
    if (av === undefined || bv === undefined) {
      diffPaths.push(`${path}（${av === undefined ? "仅已提交的有" : "仅新生成的有"}）`)
    } else if (Array.isArray(av) || Array.isArray(bv)) {
      if (JSON.stringify(canonical(av)) !== JSON.stringify(canonical(bv))) diffPaths.push(path)
    } else if (typeof av === "object" && typeof bv === "object") {
      walk(av, bv, path)
    } else if (av !== bv) {
      diffPaths.push(path)
    }
  }
}

walk(canonical(next.versions), canonical(committed.versions), "")

if (diffPaths.length === 0) {
  const versions = Object.entries(next.versions ?? {})
    .map(([version, sections]) => {
      const items = Array.isArray(sections)
        ? sections.reduce((sum, section) => sum + (section.items?.length ?? 0), 0)
        : 0
      return `${version}: ${Array.isArray(sections) ? sections.length : 0} 章节 / ${items} 条目`
    })
    .join("；")
  console.log(`导航结构一致 ✔（${versions}）`)
  process.exit(0)
}

console.error(`导航结构有漂移 ✘（${diffPaths.length} 处）`)
for (const path of diffPaths.slice(0, 20)) console.error(`  · ${path}`)
if (diffPaths.length > 20) console.error(`  … 另有 ${diffPaths.length - 20} 处`)
process.exit(1)
