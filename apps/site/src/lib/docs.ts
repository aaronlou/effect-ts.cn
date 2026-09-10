/**
 * 文档译站：导航数据与路径工具。
 *
 * 导航清单（docs-nav.json）由内容管线 `ecn-content nav` 从官方仓库生成：
 *   pnpm --filter @ecn/content exec tsx src/cli.ts nav --dir <上游 content/docs> -o apps/site/src/data/docs-nav.json
 */
import navJson from "../data/docs-nav.json"

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

export const docsNav = navJson as DocsNav

export const DEFAULT_VERSION = "v4"

export const allVersions = Object.keys(docsNav.versions).sort().reverse()

/** 版本从译文 id 的首段推导（镜像官方 v3/v4 目录） */
export function versionOf(id: string): string {
  const first = id.split("/")[0]
  return first !== undefined && /^v\d+$/.test(first) ? first : DEFAULT_VERSION
}

/** 官方站点对应页面的地址（未翻译条目回退到英文原文） */
export function officialUrl(slug: string): string {
  return `https://effect.website/docs/${slug}`
}

/** 本站译文的 GitHub 编辑地址 */
export function editUrl(slug: string): string {
  return `https://github.com/aaronlou/effect-ts.cn/edit/main/apps/site/src/content/docs/${slug}.mdx`
}

/** 认领翻译：预填标题与正文的 GitHub 新建 Issue 链接 */
export function claimUrl(slug: string): string {
  const title = `[翻译认领] ${slug}`
  const body = [
    `我认领这一页的翻译：\`${slug}\``,
    "",
    `- 上游文件：\`${slug}.mdx\``,
    `- 官方原文：https://effect.website/docs/${slug}`,
    "",
    "翻译规范见 docs/translation-guide.md（保留官方组件标签、去掉框架 import、代码逐字一致）。"
  ].join("\n")
  return `https://github.com/aaronlou/effect-ts.cn/issues/new?labels=translation&title=${encodeURIComponent(
    title
  )}&body=${encodeURIComponent(body)}`
}

/** 某版本下的全部条目（扁平化，用于上下页） */
export function flatItems(version: string): ReadonlyArray<NavItem> {
  const sections = docsNav.versions[version] ?? []
  return sections.flatMap((section) => section.items)
}

/** 同一文档在其它版本中的对应条目（用于版本切换） */
export function counterpartSlug(slug: string, targetVersion: string): string | undefined {
  const rest = slug.split("/").slice(1).join("/")
  const candidate = `${targetVersion}/${rest}`
  return flatItems(targetVersion).some((item) => item.slug === candidate) ? candidate : undefined
}

export const statusLabels: Readonly<Record<string, string>> = {
  pending: "待翻译",
  translating: "翻译中",
  reviewing: "审校中",
  published: "已发布",
  stale: "落后上游"
}

export const statusBadgeClass: Readonly<Record<string, string>> = {
  published: "ok",
  stale: "warn",
  reviewing: "",
  translating: "",
  pending: "dim"
}
