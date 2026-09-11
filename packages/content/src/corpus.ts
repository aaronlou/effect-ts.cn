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
import { citationDigest, contentHash as hashContent } from "./citation.js"
import type { DocsNav } from "./nav.js"

/**
 * 页首小节的锚点。站点在正文容器上渲染同名 id（apps/site/src/pages/docs/[...slug].astro），
 * CI 的「引用锚点」门禁会验证它真的存在于构建产物里。
 * 与任何标题 id 都不冲突（实测全站 0 个标题叫 intro）。
 */
export const PAGE_LEAD_ANCHOR = "intro"

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

/**
 * 从构建产物提取 `标题文本 → 锚点 id 列表`。
 *
 * 为什么是**列表**而不是单值：同一页里可能出现重复标题，Astro 会依次生成
 * `x`、`x-1`、`x-2`……。若只保留最后一个 id，前面那些小节就会指向**错误的小节** ——
 * 对一个以"引用可核验"为卖点的站来说是不可接受的。这里按**出现顺序**保存，
 * 下游按文档顺序消费，使第 n 次出现的标题对上第 n 个 id。
 */
async function loadAnchorsForPage(
  htmlDir: string,
  slug: string
): Promise<Map<string, ReadonlyArray<string>>> {
  const map = new Map<string, Array<string>>()
  try {
    const html = await readFile(path.join(htmlDir, "docs", slug, "index.html"), "utf8")
    const headingRe = /<h([2-4])[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g
    for (const match of html.matchAll(headingRe)) {
      const id = match[2]
      const text = normalizeHeading((match[3] ?? "").replace(/<[^>]*>/g, ""))
      if (id === undefined || text === "") continue
      const list = map.get(text)
      if (list === undefined) map.set(text, [id])
      else list.push(id)
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

    const anchors =
      options.htmlDir !== undefined
        ? await loadAnchorsForPage(options.htmlDir, slug)
        : new Map<string, ReadonlyArray<string>>()
    const drafts = chunkMarkdown(body)
    /**
     * 每个标题文本已出现到第几个**小节**（同页重复标题按文档顺序一一对应）。
     *
     * 注意单位是「小节」而不是「切片」：`chunkMarkdown` 会把一个长小节切成多个切片，
     * 它们 headingPath 相同、共享同一个 HTML id。旧实现每个切片都 +1，
     * 于是同一小节第 2 个起的切片都去查 ids[1]、ids[2]……全部落空 →
     * 全站 210 个切片因此没有锚点、也就拿不到 `/cite/<digest>.json`
     * （「怎么安装 Effect？」最相关的那条引用正是这样变成不可核验的）。
     * 现在只有**标题文本发生变化**（进入新小节）时才推进计数。
     */
    const occurrenceByHeading = new Map<string, number>()
    let previousSectionKey: string | undefined

    const base = drafts.map((draft, index) => {
      const lastHeading = draft.headingPath.filter((part) => part.length > 0).at(-1)
      let anchorFromHtml: string | undefined
      if (lastHeading === undefined) {
        previousSectionKey = undefined
      } else {
        const key = normalizeHeading(lastHeading)
        if (key !== previousSectionKey) {
          occurrenceByHeading.set(key, (occurrenceByHeading.get(key) ?? 0) + 1)
          previousSectionKey = key
        }
        const ids = anchors.get(key)
        anchorFromHtml = ids?.[(occurrenceByHeading.get(key) ?? 1) - 1]
      }
      /**
       * 页首（第一个 `##` 之前的那段）也要有锚点。
       *
       * 为什么：锚点 = 引用单位。页首没有标题就没有 HTML id，于是它既进不了引用记录
       * （`buildCitationRecords` 跳过无锚点切片），也拿不到 `/cite/<digest>.json` ——
       * 而「怎么安装 Effect？」这类问题的**最佳命中恰恰是页首**，结果答案里
       * 最相关的那条引用无法独立核验（全站曾有 ~1/3 引用如此）。
       * 站点在正文容器上渲染 `id="intro"`（见 apps/site/src/pages/docs/[...slug].astro），
       * 引用锚点门禁会验证这个 id 真的存在。
       */
      const isPageLead = draft.headingPath.every((part) => part.length === 0)
      return {
        draft,
        index,
        anchor: draft.anchor ?? anchorFromHtml ?? (isPageLead ? PAGE_LEAD_ANCHOR : undefined)
      }
    })


    /**
     * 引用单位是**小节（锚点）**，不是检索切片。
     *
     * 为什么：`chunkMarkdown` 会按长度把一个长小节切成多个切片（利于排序），
     * 但它们共享同一个锚点。若按切片发引用地址，两个切片会抢同一地址 ——
     * 引用就会指向错误的证据。这里把小节内所有切片拼成**完整小节正文**，
     * 作为该锚点的证据与指纹。
     */
    const sections = new Map<string, Array<number>>()
    for (const { anchor, index } of base) {
      if (anchor === undefined) continue
      const list = sections.get(anchor)
      if (list === undefined) sections.set(anchor, [index])
      else list.push(index)
    }

    const sectionMeta = new Map<number, { citeDigest: string; contentHash: string }>()
    for (const [anchor, indices] of sections) {
      const sectionText = indices.map((index) => base[index]!.draft.text).join("\n\n")
      const meta = { citeDigest: citationDigest(slug, anchor), contentHash: hashContent(sectionText) }
      for (const index of indices) sectionMeta.set(index, meta)
    }

    const chunks: Array<CorpusChunk> = base.map(({ draft, index, anchor }) => ({
      id: `${slug}#${index}`,
      slug,
      version,
      pageTitle: title,
      headingPath: draft.headingPath,
      ...(anchor !== undefined ? { anchor } : {}),
      // 引用协议：有锚点才谈得上"证据" —— 页级切片不生成引用记录
      ...(sectionMeta.get(index) ?? {}),
      text: draft.text,
      hasCode: draft.hasCode
    }))

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
      citations: new Set(
        pages.flatMap((page) =>
          page.chunks.flatMap((chunk) => (chunk.citeDigest !== undefined ? [chunk.citeDigest] : []))
        )
      ).size,
      upstreamHead: nav.generatedFrom.head
    }
  }

  await writeFile(options.outFile, `${JSON.stringify(corpus, null, 2)}\n`, "utf8")
  return corpus
}
