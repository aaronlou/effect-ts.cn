/**
 * `/docs/<slug>.md`：单页 Markdown（带来源与同步基线）。
 *
 * 面向"会 fetch 的 Agent"：比 HTML 更省 token、更少噪声；
 * 同时给人一个"看原文"的裸文本入口。
 */
import type { APIRoute, GetStaticPaths } from "astro"
import { getCollection } from "astro:content"

export const getStaticPaths: GetStaticPaths = async () => {
  const docs = await getCollection("docs")
  return docs
    .filter((entry) => entry.data.draft !== true)
    .map((entry) => ({ params: { slug: entry.id }, props: { entry } }))
}

export const GET: APIRoute = async ({ props, site }) => {
  const { entry } = props as { entry: { id: string; body?: string; data: Record<string, unknown> } }
  const base = (site ?? new URL("https://effect-ts.cn/")).href.replace(/\/$/, "")
  const commit = typeof entry.data.upstreamCommit === "string" ? entry.data.upstreamCommit : undefined
  const upstreamPath =
    typeof entry.data.upstreamPath === "string" ? entry.data.upstreamPath : `${entry.id}.mdx`
  const status = typeof entry.data.status === "string" ? entry.data.status : "unknown"

  const header = [
    `# ${String(entry.data.title ?? entry.id)}`,
    "",
    ...(typeof entry.data.description === "string" ? [`> ${entry.data.description}`, ""] : []),
    "<!--",
    `  来源：Effect 官方文档（Effect-TS/website）的中文译文，本站为非官方社区站。`,
    `  上游文件：${upstreamPath}`,
    `  上游基线：${commit ?? "未标注"}`,
    `  译文状态：${status}`,
    `  原页面：${base}/docs/${entry.id}/`,
    `  官方原文：https://effect.website/docs/${entry.id}`,
    "  许可：MIT（与上游一致）",
    "-->",
    ""
  ].join("\n")

  return new Response(`${header}${entry.body ?? ""}\n`, {
    headers: { "content-type": "text/markdown; charset=utf-8" }
  })
}
