/**
 * 语料构建：把站内中文译文 + 官方导航 → packages/knowledge/data/corpus.json
 *
 * 关键设计：**锚点从站点构建产物里提取**（`apps/site/dist` 下每页的 `index.html`），
 * 这样引用能精确跳到小节，而不需要复刻 Astro 的中文 slug 算法。
 * 若构建产物不存在，则退化为"无锚点"的页级引用（依然可用，只是不够精确）。
 */
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { chunkMarkdown, stripMarkup, type Corpus, type CorpusChunk, type CorpusPage } from "@ecn/knowledge"
import { asString, parseFrontmatter } from "./frontmatter.js"
import type { DocsNav } from "./nav.js"

export interface BuildCorpusOptions {
  /** 译文目录（apps/site/src/content/docs） */
  readonly docsDir: string
  /** 导航清单（apps/site/src/data/docs-nav.json） */
  readonly navFile: string
  /** 站点构建产物目录（apps/site/dist），用于提取真实锚点 */
  readonly htmlDir?: string
  /** 语料输出路径（packages/knowledge/data/corpus.json） */
  readonly outFile: string
  /** 上游仓库信息（写入 corpus.upstream） */
  readonly upstream?: { readonly repo: string; readonly dir: string; readonly head: string | null; readonly snapshotFiles: number }
  readonly generatedAt?: string
}

async function listFiles(dir: string): Promise<ReadonlyArray<string>> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: Array<string> = []
  for (const entry of entries) {
    if (entry.name.startsWith("_")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(full)))
    else if (entry.isFile() && /\.mdx?$/.test(entry.name)) files.push(full)
  }
  return files
}

function normalizeHeading(text: string): string {
  return stripMarkup(text).replace(/[\s:：?？!！。.、,，'"'"()（）\-—…]/g, "").toLowerCase()
}

/** 从构建产物提取 `标题文本 → 锚点 id` 映射 */
async function loadAnchorsForPage(htmlDir: string, slug: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const html = await readFile(path.join(htmlDir, "docs", slug, "index.html"), "utf8")
    const headingRe = /<h([2-4])[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g
    for (const match of html.matchAll(headingRe)) {
      const id = match[2]
      const text = normalizeHeading((match[3] ?? "").replace(/<[^>]*>/g, ""))
      if (id !== undefined && text !== "") map.set(text, id)
    }
  } catch {
    // 未构建或页面不存在：忽略，退化为页级引用
  }
  return map
}

export async function buildCorpus(options: BuildCorpusOptions): Promise<Corpus> {
  const docsDir = path.resolve(options.docsDir)
  const nav = JSON.parse(await readFile(options.navFile, "utf8")) as DocsNav
  const files = await listFiles(docsDir)

  const pages: Array<CorpusPage> = []
  for (const file of files) {
    const raw = await readFile(file, "utf8")
    const { frontmatter, body } = parseFrontmatter(raw)
    const relative = path.relative(docsDir, file).split(path.sep).join("/")
    const slug = relative.replace(/\.mdx?$/, "")
    const version = slug.split("/")[0] ?? "v4"
    const title = asString(frontmatter, "title") ?? slug
    const description = asString(frontmatter, "description")
    const status = asString(frontmatter, "status") ?? "pending"
    const upstreamPath = asString(frontmatter, "upstreamPath")
    const upstreamCommit = asString(frontmatter, "upstreamCommit")

    const anchors = options.htmlDir !== undefined ? await loadAnchorsForPage(options.htmlDir, slug) : new Map<string, string>()
    const drafts = chunkMarkdown(body)

    const chunks: Array<CorpusChunk> = drafts.map((draft, index) => {
      const lastHeading = draft.headingPath.filter((part) => part.length > 0).at(-1)
      const anchorFromHtml = lastHeading !== undefined ? anchors.get(normalizeHeading(lastHeading)) : undefined
      const anchor = draft.anchor ?? anchorFromHtml
      return {
        id: `${slug}#${index}`,
        slug,
        version,
        pageTitle: title,
        headingPath: draft.headingPath,
        ...(anchor !== undefined ? { anchor } : {}),
        text: draft.text,
        hasCode: draft.hasCode
      }
    })

    pages.push({
      slug,
      version,
      title,
      ...(description !== undefined ? { description } : {}),
      status,
      ...(upstreamPath !== undefined ? { upstreamPath } : {}),
      ...(upstreamCommit !== undefined ? { upstreamCommit } : {}),
      url: `/docs/${slug}/`,
      officialUrl: `https://effect.website/docs/${slug}`,
      markdown: body.trim(),
      chunks
    })
  }

  // 官方侧边栏的章节名（意图类查询的信号，如「从这里开始」包含"开始"）
  const sectionLabels = new Map<string, string>()
  for (const sections of Object.values(nav.versions)) {
    for (const section of sections) {
      for (const item of section.items) sectionLabels.set(item.slug, section.label)
    }
  }
  for (const page of pages) {
    const label = sectionLabels.get(page.slug)
    if (label !== undefined) {
      ;(page as { sectionLabel?: string }).sectionLabel = label
    }
  }

  const translated = new Set(pages.map((page) => page.slug))
  const pending = Object.entries(nav.versions).flatMap(([, sections]) =>
    sections.flatMap((section) =>
      section.items
        .filter((item) => !translated.has(item.slug))
        .map((item) => ({
          slug: item.slug,
          version: item.slug.split("/")[0] ?? "v4",
          title: item.label,
          sectionLabel: section.label,
          upstreamPath: item.upstreamPath,
          officialUrl: `https://effect.website/docs/${item.slug}`
        }))
    )
  )

  const corpus: Corpus = {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    upstream: options.upstream ?? { repo: "Effect-TS/website", dir: "apps/web/src/content/docs", head: nav.generatedFrom.head, snapshotFiles: 0 },
    pages: pages.sort((a, b) => a.slug.localeCompare(b.slug)),
    pending: pending.sort((a, b) => a.slug.localeCompare(b.slug)),
    stats: {
      pages: pages.length,
      chunks: pages.reduce((sum, page) => sum + page.chunks.length, 0),
      pendingPages: pending.length,
      upstreamHead: nav.generatedFrom.head
    }
  }

  await writeFile(options.outFile, `${JSON.stringify(corpus, null, 2)}\n`, "utf8")
  return corpus
}
