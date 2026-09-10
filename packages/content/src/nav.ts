/**
 * 侧边栏导航生成器：从官方内容目录（Effect-TS/website → apps/web/src/content/docs）
 * 生成"镜像官方结构"的导航清单 JSON。
 *
 * 依据官方两个配置：
 *   - sidebar-config.json  版本 → 章节 → 排序号
 *   - onboarding-groups.json 版本 → "Start Here / Getting Started" 分组与条目顺序
 * 章节内的条目顺序取各文件 frontmatter 的 sidebar.order。
 */
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { asBoolean, asNumber, asString, parseFrontmatter } from "./frontmatter.js"
import { headCommit } from "./git.js"

export interface NavItem {
  readonly slug: string
  readonly label: string
  readonly order: number
  readonly upstreamPath: string
}

export interface NavSection {
  readonly key: string
  readonly label: string
  readonly order: number
  readonly items: ReadonlyArray<NavItem>
}

export interface DocsNav {
  readonly generatedFrom: {
    readonly repo: string
    readonly dir: string
    readonly head: string | null
    readonly generatedAt: string
  }
  readonly versions: Readonly<Record<string, ReadonlyArray<NavSection>>>
}

/** 章节中文化（镜像官方 key，展示用中文；未收录的 key 自动美化） */
const SECTION_LABELS: Readonly<Record<string, string>> = {
  "": "总览",
  "getting-started": "快速上手",
  "error-management": "错误管理",
  "requirements-management": "依赖管理",
  "resource-management": "资源管理",
  observability: "可观测性",
  configuration: "配置",
  runtime: "运行时",
  scheduling: "调度",
  "state-management": "状态管理",
  batching: "批处理",
  caching: "缓存",
  concurrency: "并发",
  stream: "Stream",
  sink: "Sink",
  testing: "测试",
  "code-style": "代码风格",
  "data-types": "数据类型",
  trait: "Trait",
  behaviour: "行为",
  schema: "Schema",
  platform: "Platform",
  ai: "AI",
  micro: "微教程",
  "additional-resources": "进阶资源"
}

const GROUP_LABELS: Readonly<Record<string, string>> = {
  "Start Here": "从这里开始",
  "Getting Started": "快速上手"
}

interface UpstreamDoc {
  readonly slug: string
  readonly upstreamPath: string
  readonly section: string
  readonly title: string
  readonly label: string
  readonly order: number
}

function prettify(key: string): string {
  return key
    .split(/[-_/]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function sectionLabel(key: string): string {
  return SECTION_LABELS[key] ?? prettify(key)
}

async function listDocFiles(dir: string, base: string): Promise<ReadonlyArray<string>> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: Array<string> = []
  for (const entry of entries) {
    if (entry.name.startsWith("_")) continue // 与官方一致：_ 前缀不参与内容集合
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listDocFiles(full, base)))
    } else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      files.push(path.relative(base, full))
    }
  }
  return files
}

async function readUpstreamDocs(
  docsDir: string,
  version: string
): Promise<ReadonlyArray<UpstreamDoc>> {
  const versionDir = path.join(docsDir, version)
  const files = await listDocFiles(versionDir, docsDir)
  const docs: Array<UpstreamDoc> = []

  for (const rel of files) {
    const posix = rel.split(path.sep).join("/")
    const raw = await readFile(path.join(docsDir, rel), "utf8")
    const { frontmatter } = parseFrontmatter(raw)
    if (asBoolean(frontmatter, "sidebar.hidden") === true) continue

    const segments = posix.split("/")
    const slug = posix.replace(/\.mdx?$/, "")
    const section = segments.length > 2 ? (segments[1] ?? "") : ""
    const title = asString(frontmatter, "title") ?? prettify(slug.split("/").pop() ?? slug)

    docs.push({
      slug,
      upstreamPath: posix,
      section,
      title,
      label: asString(frontmatter, "sidebar.label") ?? title,
      order: asNumber(frontmatter, "sidebar.order") ?? 999
    })
  }

  return docs
}

interface RawRecord {
  readonly [key: string]: unknown
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T
  } catch {
    return undefined
  }
}

export async function generateNav(
  docsDir: string,
  options?: { readonly repo?: string; readonly dir?: string }
): Promise<DocsNav> {
  const root = path.resolve(docsDir)
  const entries = await readdir(root, { withFileTypes: true })
  const versions = entries
    .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse() // v4 在前

  const sidebarConfig =
    (await readJson<Record<string, RawRecord>>(path.join(root, "sidebar-config.json"))) ?? {}
  const onboardingGroups =
    (await readJson<Record<string, ReadonlyArray<RawRecord>>>(path.join(root, "onboarding-groups.json"))) ??
    {}

  const result: Record<string, ReadonlyArray<NavSection>> = {}

  for (const version of versions) {
    const docs = await readUpstreamDocs(root, version)
    const bySlug = new Map(docs.map((doc) => [doc.slug, doc]))
    const consumed = new Set<string>()
    const sections: Array<NavSection> = []

    // 1) 官方 onboarding 分组（Start Here / Getting Started）优先
    const groups = onboardingGroups[version]
    if (Array.isArray(groups)) {
      let groupOrder = -100
      for (const group of groups) {
        const label = typeof group["label"] === "string" ? (group["label"] as string) : ""
        const items = Array.isArray(group["items"]) ? (group["items"] as ReadonlyArray<string>) : []
        const navItems: Array<NavItem> = []
        let index = 0
        for (const slug of items) {
          const doc = bySlug.get(slug)
          if (doc === undefined) continue
          consumed.add(doc.slug)
          navItems.push({
            slug: doc.slug,
            label: doc.label,
            order: index++,
            upstreamPath: doc.upstreamPath
          })
        }
        if (navItems.length > 0) {
          sections.push({
            key: `group:${label}`,
            label: GROUP_LABELS[label] ?? label,
            order: groupOrder++,
            items: navItems
          })
        }
      }
    }

    // 2) 其余章节按 sidebar-config 排序
    const config = sidebarConfig[version] ?? {}
    const sectionKeys = new Set<string>()
    for (const doc of docs) {
      if (consumed.has(doc.slug)) continue
      sectionKeys.add(doc.section)
    }

    const orderedSections = [...sectionKeys].sort((a, b) => {
      const orderA = typeof config[a] === "number" ? (config[a] as number) : 500
      const orderB = typeof config[b] === "number" ? (config[b] as number) : 500
      return orderA === orderB ? a.localeCompare(b) : orderA - orderB
    })

    let sectionOrder = 0
    for (const key of orderedSections) {
      const items = docs
        .filter((doc) => doc.section === key && !consumed.has(doc.slug))
        .sort((a, b) => (a.order === b.order ? a.slug.localeCompare(b.slug) : a.order - b.order))
        .map((doc, index) => ({
          slug: doc.slug,
          label: doc.label,
          order: index,
          upstreamPath: doc.upstreamPath
        }))
      if (items.length === 0) continue
      sections.push({ key, label: sectionLabel(key), order: sectionOrder++, items })
    }

    result[version] = sections
  }

  return {
    generatedFrom: {
      repo: options?.repo ?? "Effect-TS/website",
      dir: options?.dir ?? "apps/web/src/content/docs",
      head: await headCommit(path.resolve(root, "..", "..", "..", "..", "..")),
      generatedAt: new Date().toISOString()
    },
    versions: result
  }
}

export async function writeNav(nav: DocsNav, outFile: string): Promise<void> {
  await writeFile(outFile, `${JSON.stringify(nav, null, 2)}\n`, "utf8")
}
