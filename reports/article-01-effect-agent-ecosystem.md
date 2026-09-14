# 2026 年，Effect-TS 正在成为 AI Agent 的下一种工程范式吗？

> **——基于 GitHub 开源生态的第一次调查**
>
> 数据快照：2026-09-14 · 数据集 v0.1 · 完整数据集与方法论见 `packages/observatory/`
> 一句话结论：**技术价值明显，生态规模有限（3.9%）。这不是"下一种范式"，但采用者的用法很重。**

---

## Chapter 1 · Agent 正在改变软件工程

先不谈 Effect。

2026 年的 Agent 项目里，真正难的部分早就不是"怎么调 LLM"了。任何一个能跑起来的 Agent
都会很快撞上这些：

```
失败      → 工具会挂、模型会超时、第三方 API 会 429
并发      → 多个工具要同时跑，一个挂了不能拖垮全部
取消      → 用户按了 Ctrl-C，子进程和连接要跟着收拾干净
资源      → 进程、数据库连接、文件句柄、MCP 连接的生命周期
状态      → 会话中断后能不能接着跑
流式      → 边生成边给用户看，而不是憋完再说
可观测    → 出了事要能查，而不是靠 printf
```

这些不是 AI 问题，是**运行时工程问题**。而它们恰好是 TypeScript 生态长期以来最薄的一块：
`try/catch` 管不住类型，`Promise.all` 管不住取消，`setTimeout` 管不住超时后的悬挂。

## Chapter 2 · 竞争的焦点正在转移

于是有了一个值得验证的问题：

> **Agent 框架的竞争，是否正在从"谁更方便调用 LLM"转向"谁更能可靠地管理 Agent Runtime 的复杂性"？**

这个问题很重要，但**这篇报告不回答它**。回答它需要对 Mastra / LangGraph / Vercel AI SDK
做同任务、同故障注入的对等实现对比 —— 那是 v0.2 的事。

这篇报告只回答一个更基础的问题：**真的有人在用 Effect 做 Agent 吗？用得多深？**

## Chapter 3 · Effect 是什么（一句话给没写过的人）

Effect 是一个 TypeScript 的 effect system。与本文相关的部分：

| 你要解决的问题 | Effect 的对应能力 |
| --- | --- |
| 工具失败的建模 | 类型化错误（`Data.TaggedError` / `Schema.TaggedError`） |
| 工具输入输出 | `Schema`（运行时校验 + 类型 + 可注解给模型看） |
| 并行工具 | 结构化并发（`Fiber`、`Effect.all`） |
| 重试 | `Schedule` |
| LLM 依赖替换 | `Layer` + `Context`（依赖注入） |
| 流式 | `Stream` |
| 资源生命周期 | `Scope` |
| 取消 | `Fiber` 中断（结构化并发） |
| 可观测 | `@effect/opentelemetry`、`Metric` |

关键不是"功能多"，而是**这些能力共享同一套组合语义** —— 一个 `Scope` 能同时管住
超时、取消与资源释放，这在 Promise 世界里要手写四遍且很难写对。

## Chapter 4 · 数据：GitHub 上到底有没有人在用 Effect 做 Agent？

### 怎么数的（这段比数字重要）

**不看 README，不看 star。** 判定分两步：

1. **依赖清单**：仓库里**所有** `package.json`（不是只读根目录）的
   `dependencies` / `peerDependencies` 里有 `effect` 或 `@effect/*`；
2. **真的在用**：下载 tarball **全仓扫描**，只统计**确实 `import` 了 effect** 的文件 ——
   并且剔除"仓库里塞了一份 Effect 源码"的情况（真有人把整个 effect 拷进 `.context/effect/`，
   不剔除的话统计到的是库自己）。

然后按用法分档（这是本文最重要的一个设计）：

| 深度 | 含义 |
| --- | --- |
| L0 | 不用 |
| L1 | 只在边角路径依赖（拿它当性能对比基准之类） |
| L2 | 部分业务逻辑用了 |
| L3 | Effect 是重要架构组成 |
| **L4** | **Effect 是 Agent Runtime 的地基** |

### 有界宇宙（必须是第一页就说清的事）

GitHub 搜索**每条查询最多返回 1000 条**。所以"全量爬取"在 API 层面不存在。
本次调查的宇宙是：

> stars ≥ 300 ∧ 180 天内有 push ∧ 5 种语言 × 16 个 Agent 方向词（命中 name/description/topics）

**这是有界宇宙，不是 GitHub 上全部 Agent 项目。** 所有比例的分母都是它。

### 数字

| | |
| --- | --- |
| 候选仓库 | **4,861** |
| 判定为 Agent | **2,275**（另有 2,177 个"判不准"，**不计入**分子分母） |
| TypeScript Agent | **856** |
| **其中真正在用 Effect（L2+）** | **33 → 3.9%** |

语言分布（GitHub 的 `language` 字段，仅供参考）：

| 语言 | 候选 | 判定为 Agent |
| --- | ---: | ---: |
| Python | 2,223 | 934（42.0%） |
| **TypeScript** | **1,612** | **856（53.1%）** |
| Go | 465 | 217（46.7%） |
| Rust | 402 | 185（46.0%） |
| Java | 158 | 83（52.5%） |

## Chapter 5 · Effect 在 TypeScript Agent 生态里的位置

3.9% 是什么概念？**它不是一个"范式"该有的数字。**
（本文不拿它和 LangChain 系比 —— 我们没按同一口径做过那组测量，没有数字就不比较。）

但把 33 拆开看，故事变了：

| 深度 | 项目数 |
| --- | ---: |
| L2（部分业务逻辑） | 6 |
| L3（重要架构组成） | 4 |
| **L4（Runtime 地基）** | **23** |

**23 / 33 是 L4。** 也就是说：**用 Effect 做 Agent 的人，绝大多数不是浅尝，而是把执行模型建在它上面。**
这个分布极不均匀，而且方向很明确 —— 它支持一个假设：
**Effect 的价值在 Agent Loop 之下，而不是在 Loop 里面。**

## Chapter 6 · 我们找到的真实 Effect Agent

### anomalyco/opencode —— 20 万 star 的样板

3,271 个文件里 **950 个** import 了 effect，命中 **14 项**能力，渗透度 52.5%（主体包里一半运行时依赖 effect）。

它的 Agent 本身就是一个 Effect Service：

```ts
import { Context, Effect, Layer } from "effect"

export interface Interface extends State.Transformable<Draft> {
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  readonly resolve: (id?: ID | string) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Agent") {}

const layer = Layer.effect(Service, Effect.gen(function* () { ... }))
```

它的工具契约用 Schema 一份定义三处受益（运行时校验 / 类型 / **给模型看的说明**）：

```ts
export const Input = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_TIMEOUT_MS)).pipe(Schema.optional),
})
```

**这是本次调查里最值得抄的一处设计**：工具的校验规则与模型看到的描述不可能漂移，因为它们本来就是同一个值。

### 另外三篇

- **[ComposioHQ/composio](../packages/observatory/case-studies/composio.md)**（30k★，L4）：
  渗透度只有 3.7%，但 286 个文件真的在用 —— 而且它专门做了 `json-schema-to-effect-schema`
  这座桥（Agent 工具生态的元数据是 JSON Schema，运行时是 Effect Schema）。
- **[baptisteArno/typebot.io](../packages/observatory/case-studies/typebot.io.md)**（10k★，L4）：
  一个**真实产品**（不是框架），用 `@effect/sql-pg` + `@effect/opentelemetry`，
  而且 Effect 出现在 **React 组件**里 —— "Effect 只在后端"是误解。
- **[elizaOS/eliza](../packages/observatory/case-studies/eliza.md)**（19k★，**L2**）——
  **反例**：22,043 个文件里只有 **3 个** import 了 effect。
  按"依赖里有 effect"判，它是 Effect 项目；按"真的成了架构"判，它只是两个插件用了 Effect 的 Agent 平台。

## Chapter 7 · Effect 为什么可能适合 Agent Runtime

把 33 个 Effect Agent 的能力命中汇总（同一项目命中多项，数字取自 `dataset/stats.json`）：

| 能力 | 命中项目数（共 33） |
| --- | ---: |
| `Effect.gen` 组合 | 32 |
| 类型化错误 | 31 |
| 并发原语（Queue / Ref / Semaphore） | 28 |
| 服务与依赖注入（Layer / Context） | 26 |
| Fiber 与并发 | 26 |
| Schema 校验 | 26 |
| Scope 资源管理 | 26 |
| Stream 流处理 | 22 |
| 可观测性 | 20 |
| Config 配置 | 18 |
| `@effect/platform` | 17 |
| 集群与工作流 | 14 |
| HttpApi | 11 |
| `@effect/sql` | 9 |
| **`@effect/ai`** | **0** |

**读法**：几乎人人用 `Effect.gen`（32/33），但这只是"会写 Effect"；
真正区分度在**类型化错误（31）、并发原语（28）、Layer/Context（26）、Scope（26）** ——
这些是**运行时能力**，而不是"怎么调 LLM"。

最扎眼的一行是最后一行：**`@effect/ai` 在 33 个项目里命中 0 个**
（全部 1,612 个 TS 候选里也只有 1 个项目用了它）。
也就是说：这些团队用 Effect 不是因为官方提供了 AI 包，而是**为了把 Agent 的部件组装起来并且管住失败**。
官方 AI 包在这批项目里几乎不存在感 —— 这个事实对"Effect 官方该怎么投入"比对外宣传更有价值。

## Chapter 8 · Effect vs Mastra vs LangGraph

**这一章在 v0.1 里只有一句话：没有取证，所以不下结论。**

框架对比矩阵里的每个格子都需要证据（文档 + 源码 + 可复现的行为），
而"谁能更好地处理 failure / concurrency / lifecycle"这类问题，
不看源码、不做故障注入是答不出来的。填一个靠印象的矩阵，比留白更糟。

## Chapter 9 · 我们真的做了一个 Benchmark

**没有。v0.1 不做 Benchmark。**

原因不是没时间，而是**同 LLM、同 prompt 下的耗时差异支撑不了"谁更好"的结论** ——
它主要反映框架开销与重试策略，噪声足以被写成任何一个你想写的结论。

真正值得测的是**失败语义**：

```
给三个框架同一个 Agent + 同一组故障注入（工具超时 / 网络错误 / 用户取消），
然后问：取消之后，资源释放了吗？错误被静默吞掉了吗？悬挂的 Fiber 还在吗？
```

这是 v0.2 的第一件事。

## Chapter 10 · 结论：不是下一种范式，但用法很重

回到标题的问题：**Effect-TS 正在成为 AI Agent 的下一种工程范式吗？**

按我们自己的判定标准，答案是 **Scenario C**：

> **Effect 在 Agent Runtime 中有明显技术价值，但生态规模仍然有限。**

三条支撑，三条限制：

**支撑**
1. 用 Effect 做 Agent 的项目里，**23/33 是 L4** —— 不是浅尝，是把执行模型建在它上面；
2. 最常用的能力是依赖注入、类型化错误、Schema、Scope、Fiber —— 全是**运行时能力**，
   而不是"怎么调 LLM"，这支持"Effect 的价值在 Agent Loop 之下"（H4）；
3. 这些项目里既有 20 万 star 的旗舰（opencode），也有真实产品（typebot），不是一堆 demo。

**限制**
1. **3.9%** 的占比，离"范式"很远；
2. **44.8% 的候选我们判不准是不是 Agent** —— "Agent"这个概念在开源世界还没有稳定边界，
   任何把这个比例当精确数字引用的做法都比数字本身更危险；
3. **v0.1 没有 Benchmark**，所以本文**不声称任何性能或可靠性优势**。

**这也是一份可以失败的调查。** 如果数据说的是"Effect 在 Agent 领域没什么人用"，这篇会照原样写出来。
把结论建立在"我们不预设答案"上，是这类数据研究唯一值得做的事。

---

### 附：数据与复现

- 数据集：`packages/observatory/data/dataset/`（`agents.csv` / `typescript-agents.csv` / `effect-agents.csv` / `frameworks.csv` / `dataset.json`）
- 快照：`packages/observatory/data/snapshots/2026-09-14/`（含每次查询的命中数、被排除的仓库、被抬高的星数下限）
- 方法与已知偏差：[docs/observatory/methodology.md](../docs/observatory/methodology.md)
- 一条命令复现：`pnpm --filter @ecn/observatory discover && … scan && … classify && … report`

> 本报告的一切数字都从数据集现算，不手抄。欢迎核对我们算错了哪里。
