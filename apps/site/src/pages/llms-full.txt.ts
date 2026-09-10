/**
 * `/llms-full.txt`：全量中文译文（Markdown 拼接）+ 来源与基线。
 * 给需要一次性把站内中文知识喂给模型的场景；单页请用 `/docs/<slug>.md`。
 */
import type { APIRoute } from "astro"
import { getCollection } from "astro:content"

export const GET: APIRoute = async ({ site }) => {
  const base = (site ?? new URL("https://effect-ts.cn/")).href.replace(/\/$/, "")
  const docs = (await getCollection("docs"))
    .filter((entry) => entry.data.draft !== true)
    .sort((a, b) => a.id.localeCompare(b.id))
  const posts = (await getCollection("blog")).filter((post) => post.data.draft !== true)

  const parts: Array<string> = []
  parts.push(
    [
      "# Effect 中文社区 · 全量中文内容",
      "",
      "> 非官方社区站；内容为 Effect 官方文档（Effect-TS/website，MIT）的中文译文与社区原创。",
      `> 站点：${base}/ · 官方站点：https://effect.website/`,
      `> 生成时间：${new Date().toISOString()}`,
      ""
    ].join("\n")
  )

  for (const entry of docs) {
    const commit = typeof entry.data.upstreamCommit === "string" ? entry.data.upstreamCommit : "未标注"
    const upstreamPath =
      typeof entry.data.upstreamPath === "string" ? entry.data.upstreamPath : `${entry.id}.mdx`
    parts.push(
      [
        "---",
        "",
        `<!-- 页面：${base}/docs/${entry.id}/ · 上游：${upstreamPath} · 基线：${commit} -->`,
        "",
        `# ${entry.data.title}`,
        ...(typeof entry.data.description === "string" ? ["", `> ${entry.data.description}`] : []),
        "",
        entry.body ?? ""
      ].join("\n")
    )
  }

  for (const post of posts) {
    parts.push(
      ["---", "", `<!-- 博客：${base}/blog/${post.id}/ -->`, "", `# ${post.data.title}`, "", post.body ?? ""].join(
        "\n"
      )
    )
  }

  return new Response(`${parts.join("\n\n")}\n`, {
    headers: { "content-type": "text/markdown; charset=utf-8" }
  })
}
