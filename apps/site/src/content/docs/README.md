# docs 内容集合（中文译站）

译文以 `.mdx` 存放，文件名即路由 id。frontmatter 承担「可追溯同步」元数据：

```mdx
---
title: 快速上手
description: ...
version: v4                 # 面向版本主线
status: translating        # pending | translating | reviewing | published | stale
upstreamPath: getting-started.mdx
upstreamCommit: abc1234     # 所对照的上游 commit（内容管线的同步基线）
translators: [你的昵称]
reviewers: []
---

正文（中文翻译，代码示例与上游保持逐字一致）
```

- `status` 由人维护、由 CI 校验；上游有更新时内容管线会将 `published` 标记为 `stale`。
- 本目录的说明文件用 `.md` 而非 `.mdx`，避免被内容集合误收录。
- 目录结构暂按「官方 Guides 章节」展开，版本用 frontmatter 区分而非目录。
