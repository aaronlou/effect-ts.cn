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
| `check` | **内容门禁**：frontmatter / 路径镜像 / 术语 / 元数据残留（PR 必过，不联网） |
| `snapshot --dir <上游docs> -o snap.json` | 固化上游每文件的最近 commit |
| `diff --snapshot snap.json --docs <译文目录>` | 判定哪些译文落后（stale） |
| `nav --dir <上游docs> -o nav.json` | 生成侧边栏导航（镜像官方结构 + 中文标签） |
| `code:check --upstream <上游docs> [--docs <译文目录>] [--proposals <提案目录>]` | **代码块逐字节一致性**：译文/提案与上游对比，附带 `##`/`###` 标题数量校验（有漂移即退出 1） |
| `proposals:pack --drafts <.proposals/.drafts> [--dir .proposals]` | 把批量起草的暂存 MDX 打成合规提案 JSON（自动套用提案门禁） |

### 提交前自检（CI 会跑同样的检查）

```bash
pnpm content:check     # 出错会以非 0 退出，PR 无法合并
```

门禁规则（见 `packages/content/src/check.ts`）：

1. **必填字段**：`title`、`status`（枚举）、`upstreamPath`、`upstreamCommit`（40 位小写 hex）；
2. **路径镜像**：本地 `v4/…` 必须与 `upstreamPath` 完全对应，且该路径必须**存在于官方导航清单**里；
3. **生命周期**：`reviewing/published/stale` 必须填 `translators`；`published` 必须填 `reviewers`；
   - `reviewers` 填人或身份标识。当前语料以 **`ecn-review`** 表示"**机器可复核的自动化审校**"：
     代码块与上游逐字节一致、标题 / 组件 / 链接结构对齐、术语门禁 0 命中、引用锚点可达。
     它**不等于人类精读**，只是把"能被机器验证的部分"验干净。
   - 维护者精读抽查后，请**追加**自己的名字，例如 `reviewers: [ecn-review, 你的昵称]` ——
     provenance 里不该出现没有证据支撑的署名。
4. **术语黑名单**：命中文正里的禁用译法即报错，词表在 [`docs/glossary.json`](./glossary.json)（可提 PR 扩充）；
5. **元数据残留**：代码围栏里不得留 `twoslash` / `import.meta.vitest` / `showLineNumbers` / `name="` / `filename="`；
6. **框架导入残留**：不得留 `@astrojs/starlight` 之类的 import 行（见下节「官方组件标签」）；
7. **告警（不阻断）**：① 页内 ASCII 锚点未用 `{#id}` 固定（见下节「页内锚点」）；
   ② 代码块外出现 ≥12 个连续英文词，疑似漏译段落。

### 官方组件标签（重要）

官方 v4 文档是 Starlight MDX，正文里会出现 `<Aside>`、`<Steps>`、`<Tabs>`、`<TabItem>` 等组件。
本站已提供**同名轻量实现**（`apps/site/src/components/mdx/`：`Aside` / `Badge` / `Steps` / `Tabs` / `TabItem`），因此译文应当：

- ✅ **保留** 组件标签与其属性，例如 `<Aside type="note" title="...">…</Aside>`、`<TabItem label="npm">…</TabItem>`；
  ⚠️ **保留的是标签与属性（英文），组件内部的正文必须翻译** —— 曾经有译者把「属性保留英文」误读成「`<Aside>` 正文也保留英文」，造成整段漏译（已在门禁里加了英文段落扫描）。
- ❌ **删除** 框架导入行，例如 `import { Aside, Steps, Tabs, TabItem } from "@astrojs/starlight/components"`。

这样译文与上游结构保持一致，渲染由本站接管（`<Tabs>` 当前按标签分块展示、内容全部可见，后续再加交互）。

### 页内锚点（重要）

上游的页内链接使用英文 slug（例如 `[divide](#why-not-throw-errors)`）。标题译为中文后，自动生成的
锚点会变成中文，链接就会失效。因此：**凡是被页内链接引用的标题，请在标题前一行加一个显式锚点**：

```mdx
<span id="why-not-throw-errors" />

## 为什么不抛出错误？
```

> ⚠️ 不要使用 `{#why-not-throw-errors}` 这种写法 —— MDX 会把 `{…}` 当作 JS 表达式解析并导致构建失败。
> 内容门禁会对"未固定的 ASCII 页内锚点"给出告警（不阻断合并，但请在 PR 里修掉）。

### 已定口径（新译者必读）

以下术语在批量翻译中已经定过口径，**照此执行**，不要各页自创（这是 219 页规模下最容易漂移的地方）：

| 英文 | 处理 | 依据 |
| --- | --- | --- |
| `Annotation` / `Schema.annotations` | **API 名保留英文**；泛指"给 schema 加注解"这一动作时用「注解」，首次出现可写「注解（annotation）」 | 与 `Schema/Annotation` API 对应，避免读者对不上代码 |
| `defect` | 保留英文（不译「缺陷」） | `AGENTS.md` 核心术语表 |
| `fallback` | **API/操作符名保留英文**（`Effect.fallback`、`Option.fallback`）；**标题与泛指概念用「回退」** | 与已发布态一致：`v4/error-management/fallback` 的标题即「回退」 |
| `memoization` | 「记忆化」 | 与 `caching` 章节用语统一 |
| `permit` | 保留英文，首次可注「（许可）」 | 与 `Semaphore` API 对应 |
| `Branded` / `Brand`（类型名） | 类型/API 名保留英文；泛指概念与标题用「品牌类型」 | `v4/code-style/branded-types` |
| `effect`（小写，泛指一个 effect 值） | 保留英文 | 上游同样小写使用；译成「效果」会与 `Effect` 类型混淆 |
| 表格表头 `Description` / `Operation` | 「说明」/「操作」 | 全站表格统一 |
| **符号对照表**（`Input` / `Output` / `transforms to` / `<missing value>` / `e: E`） | 保持英文原样 | 内容是类型表达式，属代码语义 |
| 组件标签与属性（`<Aside type="tip" title="...">`） | 标签与属性保留英文，**正文必须翻译** | 曾因误读造成整段漏译，校验器已加英文段落扫描 |
| 表格中的标识符、类型名、方法名 | 不译 | 逐字节代码块规则的延伸 |
| 标题若**整个标题就是 API 名**（`## retryN`、`### catchAll`） | 保留英文 | 与页内锚点、代码示例对应 |
| **通用概念性小节名**（`Guards` / `Comparison` / `Rounding` / `Interop` / `Caveats`） | 译中文（如 `## 类型守卫`） | 只有**函数/类型/模块名**才保留英文，概念名不保留 |

### 社区 / 求助类链接（重要）

上游页尾常有 "Join our Community" 之类段落，链接指向 **Discord** 等海外 SNS。
本站是中文社区，**刻意不透传**这类入口（见 `AGENTS.md` 与 `apps/site/src/data/community.ts`）。
译法统一为中文读者真正可用的两个渠道，写法照抄已发布译文：

```mdx
如果你对任何与 Effect 相关的问题有疑问，欢迎加入[中文社区微信群](/community/)直接提问，
也可以在官方的 [GitHub 仓库](https://github.com/Effect-TS) 上参与讨论。
```

- ❌ 不要保留 `https://discord.gg/...` 链接；
- ✅ 社区入口只指 `/community/`（其唯一事实来源是 `apps/site/src/data/community.ts`），
  Issue / 仓库链接用官方 GitHub。

> 同理，指向"本站没有的页面"的链接（如官方 API 参考 `/docs/v4/api/...`、`/play`）会在构建期
> 自动改写为 effect.website 地址（见 `apps/site/rehype-rewrite-docs-links.mjs`），**译文保持上游 URL 原样即可**。

> 「是否落后于上游」不在 PR 门禁里（那需要克隆上游、较慢），由每日的
> `upstream-sync` 工作流负责，落后会开 issue。

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
