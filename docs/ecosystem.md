# 生态项目榜：收录口径与维护

> 站点页面：`/ecosystem/`。这份文档写给**维护者**：判据是什么、怎么更新、门禁拦什么。

## 一句话

官方文档教 API，真实项目教它们**怎么被组装起来**。但官方没有这类页面（上游 v3+v4 全部内容里
没有 showcase / projects / ecosystem），所以这是本站的原创增量。

## 收录判据（两条硬规则，都由脚本核对）

1. **运行时依赖**：仓库里某个 `package.json` 的 `dependencies` / `peerDependencies` 里必须有
   `effect` 或 `@effect/*`。只在 `devDependencies` 里的不算；
   命中路径落在 `bench/` `examples/` `docs/` `site/` `tests/` 等**边角目录**的也不算。
2. **真的在用**：全仓至少有一个文件 `import` 了 effect（`from "effect"` / `from "@effect/*"`）。
   只有第 1 条不够 —— `supermemoryai/supermemory-mcp` 在 `dependencies` 里写了 `effect`，
   但全仓没有一个文件 import 它；`octanejs/octane` 同理。

**为什么不看 README**：781 个候选（TypeScript + >1000★ + AI 关键词）里只有 24 个真的依赖 effect。
按印象收录会同时犯两类错，两类都实际撞到过：

| 类型 | 实例 | 真相 |
| --- | --- | --- |
| 假阳性 | `colinhacks/zod`（43,930★） | 命中在 `packages/bench/` 且是 devDependencies —— 拿 Effect 当性能对比对手 |
| 假阳性 | `vercel/ai`（26,696★） | 只在 `examples/` 里用 |
| 假阴性 | `sst/sst`（26,290★） | 195 个 package.json 里一个都不依赖 effect |

## 三个额外标注（让榜单不只是链接列表）

- **Effect 渗透度**：运行时依赖 effect 的包占全仓 package 的比例。opencode 是 21/40，
  teable 是 2/55 —— 同样叫「用 Effect」，读起来的收获完全不同，把差异标出来比 star 榜诚实。
- **该读这里**：每条建议都指向一个真实文件，`ecosystem:build` 会核对它是否落在采集到的
  「真的 import 了 effect 的文件」列表里。指向不存在的文件 ⇒ **构建失败**。
  这条规则让点评无法凭印象编造，和译文门禁要求「代码块与上游逐字节一致」同源。
- **同源谱系**：`kilocode`、`MiMo-Code` 与 `opencode` 包结构一致（`packages/opencode`、
  `packages/schema`、`packages/llm`），是代码衍生版而非独立实现。不标注的话榜单看起来
  比实际更多样 —— 这属于诚实性问题。

## 更新流程

```bash
pnpm ecosystem:collect            # 多渠道发现 → 依赖验证 → tarball 全仓扫描（写 artifacts/）
pnpm --filter @ecn/content ecosystem:evidence   # 导出证据表，写点评时照它取材
# 编辑 packages/content/data/ecosystem-annotations.json
pnpm ecosystem:build --checked-at $(date +%F)   # 观测 ⋈ 点评，并核对路径
pnpm ecosystem:check              # 离线诚实性门禁（CI 每次跑的就是这条）
```

定向更新（已知要看哪些仓库，**完全不消耗 API 配额**）：

```bash
pnpm ecosystem:collect --repos "owner/a,owner/b" --out artifacts/ecosystem-observations.json
```

### 两条通道，因为单通道会漏

实测：关键词扫描漏掉了 `rivet-dev/actors`(6,123★)、`AnswerOverflow`(2,013★)、
`MapleTechLabs/maple`(1,772★)、`octanejs/octane`(1,383★) —— 这四个是靠
「`package.json` 里出现 `@effect/ai`」这条依赖反查通道补出来的。

### 关于 GitHub 配额（踩过的坑）

一次全量采集约 3600 次 API 调用，而认证用户只有 **5000 次/小时**。
`deepseek-ai/deepseek-harness` 有 289 个 `package.json`，全读一遍就吃掉几百次。
所以采集器的策略是：

- API 只做**便宜的快速淘汰**（1 次文件树 + 少量 package.json），且只在
  「所有 package.json 都读到、且一个都不依赖 effect」时才判淘汰 —— 否则会错杀
  pnpm workspace 的 monorepo（根 package.json 是干净的）；
- 值得细看的仓库改用 **tarball**（codeload 不吃 API 配额），因此既**不抽样**也不受限流；
- **meta / tree / 文件内容 / tarball 扫描结果全部落盘缓存**（`artifacts/`）。没有缓存时跑第二遍
  就会打爆配额，而 403 会被误读成「这个仓库不依赖 effect」—— 一次限流就伪装成一次成功的筛选。

### 三类「静默失败」都被显式处理了

这三处都是实际踩过才补上的，改动时别退化：

1. **下载失败 ≠ 不依赖**：tarball 失败曾让 `summarizeCentrality(total=1, [])` 判成 `incidental`，
   于是 `eliza`(19k★) 和 `wa-automate`(3.6k★) 被误杀。现在失败一律记为「未知」，单独列出。
2. **声明 ≠ 使用**：见上面的判据 2。
3. **仓库内置的 Effect 源码要排除**：`maple`/`foldkit`/`hazel`/`lalph` 的仓库里各带一份 Effect
   （`.context/effect/`、`repos/effect/`），`Stream.ts` 这类库自己的文件会被当成项目用法统计，
   能力数字被严重放大（foldkit 的 1432 个「effect 文件」里大部分是库本身，剔除后是 534）。
   检测方式是找 `name === "effect"` 的源码检出并整支排除；`effect-smol` 因此被识别为
   **Effect 本体**、不进榜（它是库，不是「用 Effect 写的项目」）。

## 门禁拦什么

`pnpm ecosystem:check`（CI 里每次 push 都跑）是**离线**的，只读已提交的产物：

- 每条必须有运行时依赖 effect 的包（边角依赖不许进榜）；
- 每条必须至少有一个文件真的 import 过（`evidence.effectFiles >= 1`）；
- 分层必须与 star 门槛自洽；分类与难度必须在白名单内；
- `centrality.ratio` 必须与 `runtimePackages/totalPackages` 自洽（防止手改数字）；
- 「该读这里」必须写出为什么，路径形态合法；
- 不许重复收录、不许占位符式的 summary。

**不查网络**是刻意的：让 CI 每次打 GitHub 又慢又脆。条目会不会「腐烂」
（仓库改名 / 不再依赖 effect / star 掉下门槛）属于随时间变化的同步问题，
将来由每日巡检负责 —— 那是另一件事，不塞进构建门禁。

## 已知限制

- 发现是**下界不是全集**：关键词扫描按 star 降序只取第一页，`@effect/ai` 代码搜索也有 1000 条上限。
  漏掉的小项目欢迎直接提 PR 加进 `ecosystem-annotations.json`。
- star 数是**快照**，页面标注「数据截至 `checkedAt`」，不假装实时。
- 少数仓库（如 `lalph`）把 `@effect/*` 放在 devDependencies、靠内置的 Effect 源码构建，
  按判据会被排除。这是判据一致性的代价，不是 bug。
