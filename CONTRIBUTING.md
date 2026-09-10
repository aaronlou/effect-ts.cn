# 贡献指南（v0 · 逐步完善）

欢迎任何形式的贡献：翻译、审校、投稿、社区功能、文档与 CI。本文先写得能落地，再随社区成长。

## 目录

1. [代码贡献](#代码贡献)
2. [译文贡献（核心流程）](#译文贡献)
3. [内容标准](#内容标准)
4. [行为准则](#行为准则)

---

## 代码贡献

标准开源流程：开 Issue → fork → PR → review → merge。工程约束：

- 用 Effect 的既有风格：`Effect.gen`、`Data`/`Schema`、`Context.Tag` 服务、`Layer` 装配。
- 后端改动请保持 DDD 分层：**domain 不 import infrastructure / interfaces**（eslint 边界规则待加入）。
- 领域错误用 `Data.TaggedError`；要暴露给前端的 wire 错误用 `@effect/schema` 的 `Schema.TaggedError`。
- 新增 endpoint：在 `interfaces/http/api.ts` 声明（Schema-first），实现放对应 `GroupLive`。
- 提交前：`pnpm typecheck && pnpm test`。

## 译文贡献

每一页译文都是 `apps/site/src/content/docs/<version>/…/*.mdx`（版本 = 路径首段，镜像官方
`v3/`、`v4/` 目录），frontmatter 承担“同步即信誉”。**完整规范见
[`docs/translation-guide.md`](./docs/translation-guide.md)**（含字段说明、四条管线命令与本地校准示例）：

```mdx
---
title: 为什么选择 Effect？
status: translating          # pending|translating|reviewing|published|stale
upstreamPath: v4/getting-started/why-effect.mdx
upstreamCommit: abc1234      # 与原文对照的那次 commit
translators: [昵称]
reviewers: []
---

中文正文（代码示例与上游**逐字一致**）
```

**流程**：`pending → translating → reviewing → published`；上游更新后由内容管线
（`packages/content`）自动标为 `stale`，译者负责更新。

- 取号/认领：在 Issue 里认领某页，避免重复翻译。
- 首次贡献前先翻译 **Getting Started** 一页跑通流程（译→审→发→stale→更新）。
- 审校由维护者或老译者完成；审校通过前请勿自行 `published`。
- 用 `pnpm --filter @ecn/content status` 查看进度；用 `snapshot` + `diff` 判断是否落后：

  ```bash
  pnpm --filter @ecn/content exec tsx src/cli.ts snapshot --dir <上游docs> -o snap.json
  pnpm --filter @ecn/content exec tsx src/cli.ts diff --snapshot snap.json --docs apps/site/src/content/docs
  ```

**CI 门禁**：每次 PR 会跑 `pnpm typecheck && pnpm test && pnpm build`；每日 `upstream-sync`
工作流会自动比对上游并开/更新 `upstream-sync` 标签的 issue，列出落后译文 —— 请以它为准
及时更新自己的译文基线。

## 内容标准

1. **术语不翻译**。核心词（`Effect / IO / Stream / Fiber / Layer / Schema / Effect.gen` 等）保留英文，
   首次出现给中文解释。术语表在 `docs/` 中维护，可提案修改。
2. **代码示例与上游逐字一致**（含缩进/注释）。只翻译代码块外的解释与文档行。
3. **标注来源**：译站文章在 frontmatter 提供 `sourceUrl` / `upstreamCommit`；正文注明“原文：链接”。
4. **链接有效**：站内链接用站内相对路径；外部链接保留原文地址。
5. 每页有清晰 `title` 与简短 `description`（用于 SEO 与统一入口）。

## 行为准则

- 对事不对人；讨论基于事实与代码。
- 译名/术语有分歧时，先在 Issue 公开讨论，避免个人风格化翻译。
- 尊重原作者署名，转载/引用遵循 MIT 许可并注明出处。
- 违规内容（广告、攻击性言论、未经授权转载）会被隐藏或删除。
