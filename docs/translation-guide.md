# 译者指南：docs 内容集合（中文译站）

译文以 `.mdx` 存放，**目录结构镜像官方**：官方仓库 `Effect-TS/website` 的
`apps/web/src/content/docs/` 下有 `v3/`、`v4/`，本站照抄这一结构，**版本 = 路径首段**
（不再写在 frontmatter 里）。

```
apps/site/src/content/docs/          # 内容集合目录：只放译文内容
└─ v4/
   └─ getting-started/
      └─ why-effect.mdx              # → 路由 /docs/v4/getting-started/why-effect/
```

> 注意：内容集合目录里的每个 `.md` / `.mdx` 都会被 Astro 当作**一篇译文**并校验
> frontmatter（`title` 必填）。因此：
> - 不要在该目录放草稿、笔记或说明文件；
> - 与官方一致，`_` 前缀的文件/目录会被排除（如 `_assets/`）；
> - 违反 schema 时报错形如 `docs → xxx data does not match collection schema. title: Required`，
>   若确认文件已删除/改名却仍报错，删掉 `apps/site/.astro` 缓存后重启 dev server 即可。

frontmatter 与官方对齐（`title` / `description` / `sidebar` / `tableOfContents`），
并叠加译文同步元数据：

```mdx
---
title: 为什么选择 Effect？
description: 一句话概括（用于 SEO 与列表展示）
status: reviewing            # pending | translating | reviewing | published | stale
upstreamPath: v4/getting-started/why-effect.mdx   # 相对官方 content/docs
upstreamCommit: 16b1646…     # 翻译时对照的上游 commit（同步基线）
translators: [你的昵称]
reviewers: []
sidebar:
  order: 1                   # 与官方一致：章节内排序
---

正文（中文翻译；**代码块内容与上游逐字节一致**，仅去掉 twoslash 等工具元数据）
```

配套工具（`packages/content`）：

| 命令 | 作用 |
| --- | --- |
| `status` | 各版本/状态/缺基线译文统计 |
| `snapshot --dir <上游docs> -o snap.json` | 固化上游每文件的最近 commit |
| `diff --snapshot snap.json --docs <译文目录>` | 判定哪些译文落后（stale） |
| `nav --dir <上游docs> -o nav.json` | 生成侧边栏导航（镜像官方结构 + 中文标签） |

```bash
# 本地校准示例（假设上游已 clone 到 /tmp/ecn-upstream）
pnpm --filter @ecn/content exec tsx src/cli.ts snapshot \
  --dir /tmp/ecn-upstream/apps/web/src/content/docs -o /tmp/snap.json
pnpm --filter @ecn/content exec tsx src/cli.ts diff \
  --snapshot /tmp/snap.json --docs "$PWD/apps/site/src/content/docs"
```

> 注意：`pnpm --filter exec` 的工作目录是包目录，路径请用绝对路径。

- `status` 由人维护、由管线校验；上游更新后 `diff` 会把落后页列为 `stale`。
- 导航清单 `apps/site/src/data/docs-nav.json` 由 `nav` 生成，请勿手改。
