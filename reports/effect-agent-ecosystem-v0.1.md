# Effect × AI Agent 生态调查报告 v0.1

> 快照日：**2026-09-14** · 数据集版本 `0.1` · 分类器版本 `0.1`
> 复现：`pnpm --filter @ecn/observatory discover && pnpm --filter @ecn/observatory scan && pnpm --filter @ecn/observatory classify && pnpm --filter @ecn/observatory report`
> 口径：[docs/observatory/methodology.md](../../docs/observatory/methodology.md)（本文所有数字的口径依据）

## Executive Summary

- 有界宇宙内共 **4,861** 个候选仓库，其中判定为 Agent 的 **2,275** 个
  （判不准的 2,177 个**不计入**分子分母）。
- TypeScript Agent **856** 个；其中**真正在用 Effect（L2+）的 33 个**
  ⇒ **3.9%**。
- Effect 的用法集中在 **L4（Effect 是 Runtime 地基）**：23 个，
  高于 L2/L3 —— 说明"用 Effect 做 Agent"的不是浅尝，而是把执行模型建在它上面。
- 结论：**Scenario C：Effect 在 Agent Runtime 中有明显技术价值，但生态规模仍然有限。**

> ⚠️ 这是 **GitHub 有界宇宙**内的数字，不代表整个 Agent 产业。分母定义见 §2。

## 1. 研究问题

**2026 年，Effect-TS 正在成为 AI Agent 的下一种工程范式吗？**

拆成可验证的子问题（v0.1 覆盖情况见 [research-question.md](../../docs/observatory/research-question.md)）：
规模（有多少 Agent 项目、语言分布）、Effect 存在感（多少项目真的在用、用得多深）、
以及"Effect 在 Agent 里解决什么问题"（能力证据）。

**v0.1 不做 Benchmark**，因此本报告**不声称任何性能或可靠性优势**。这是一个刻意的边界：
同 LLM 同 prompt 下的耗时差异支撑不了"更好"的结论。

## 2. 方法论（摘要）

GitHub 上 stars ≥ 300 且 2026-03-18 之后有 push 的公开仓库，按 5 种语言 × 16 个 Agent 方向词（命中 name/description/topics）检索、经去重后的候选池。**这是有界宇宙，不是 GitHub 上全部 Agent 项目。**

### 有界宇宙带来的两个诚实性声明

| 项 | 值 | 含义 |
| --- | --- | --- |
| 泛词被抬高星数下限的查询 | **3** 条 | 这些查询只覆盖高星部分（裸词 `agent` 在 stars≥300 时超过 GitHub 的 1000 条上限） |
| 被截断的切片 | **0** 条 | 0 表示没有"只取头部 1000 条"的切片 |

**Effect 判定不是"看 package.json"**：依赖清单只是第一道筛，真正判定要下载全仓扫描，
只统计**确实 `import` 了 effect** 的文件，并剔除仓库里内置的 Effect 源码（有项目把整个 effect 拷进 `.context/effect/`）。
证据强度分布：

| 阶段 | 证据强度 | 仓库数 |
| --- | --- | --- |
| Agent 分类 | manifest（依赖清单，强） | 2025 |
| Agent 分类 | paths（文件路径，中） | 2108 |
| Agent 分类 | metadata（描述/topics，弱） | 720 |
| Effect 扫描 | tarball（全仓扫描，最强） | 50 |
| Effect 扫描 | manifest-full（所有 package.json 都读到） | 1561 |
| Effect 扫描 | unknown（什么也没读到） | 1 |

## 3. Agent 生态（按语言）

| 语言（GitHub 字段） | 候选数 | 判定为 Agent | Agent 占比 |
| --- | --- | --- | --- |
| Python | 2,223 | 934 | 42.0% |
| TypeScript | 1,612 | 856 | 53.1% |
| Go | 465 | 217 | 46.7% |
| Rust | 402 | 185 | 46.0% |
| Java | 158 | 83 | 52.5% |
| (未知) | 1 | 0 | 0.0% |

> GitHub 的 `language` 按字节占比计算，TS 项目常被判成 JS/JSON/Markdown ——
> 因此这一列是**参考口径**，不是裁定口径（见 methodology §9）。

## 4. TypeScript Agent 生态

- TypeScript 候选：**1,612**
- 其中判定为 Agent：**856**
- Agent 类型分布：

| 类型 | 数量 |
| --- | --- |
| mcp-agent | 850 |
| single-agent | 540 |
| workflow-agent | 313 |
| coding-agent | 183 |
| multi-agent | 175 |
| agent-runtime | 105 |
| research-agent | 93 |
| agent-framework | 16 |

## 5. Effect 生态：用得多深

| 深度 | 含义 | 项目数 |
| --- | --- | --- |
| L0 | 不用 Effect | 816 |
| L1 | 只在边角路径依赖（拿它当对比基准之类） | 7 |
| L2 | 部分业务逻辑用了 | 6 |
| L3 | Effect 是重要架构组成 | 4 |
| L4 | Effect 是 Agent Runtime 的地基 | 23 |

**Q5：Effect Agent 占 TypeScript Agent 的比例 = 3.9%**
（33 / 856；判不准的项目不计入分子也不计入分母）

## 6. 真正在用 Effect 的项目（L2+）

| 项目 | ★ | 深度 | 类型 | 能力数 | 证据文件 |
| --- | --- | --- | --- | --- | --- |
| [anomalyco/opencode](https://github.com/anomalyco/opencode) | 207,170 | L4 | coding-agent | 14 | `@effect/opentelemetry`, `@effect/platform-node` |
| [ComposioHQ/composio](https://github.com/ComposioHQ/composio) | 30,160 | L4 | multi-agent | 12 | `@effect/platform-bun`, `effect` |
| [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode) | 27,293 | L4 | multi-agent | 14 | `@effect/opentelemetry`, `@effect/platform-node` |
| [elizaOS/eliza](https://github.com/elizaOS/eliza) | 19,331 | L2 | workflow-agent | 2 | `effect` |
| [triggerdotdev/trigger.dev](https://github.com/triggerdotdev/trigger.dev) | 16,273 | L2 | single-agent | 4 | `effect` |
| [millionco/react-doctor](https://github.com/millionco/react-doctor) | 14,840 | L4 | single-agent | 11 | `@effect/platform-node-shared`, `effect` |
| [XiaomiMiMo/MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code) | 13,095 | L4 | mcp-agent | 13 | `@effect/opentelemetry`, `@effect/platform-node` |
| [baptisteArno/typebot.io](https://github.com/baptisteArno/typebot.io) | 10,318 | L4 | workflow-agent | 13 | `@effect/opentelemetry`, `@effect/platform-bun` |
| [openstatusHQ/openstatus](https://github.com/openstatusHQ/openstatus) | 9,110 | L3 | mcp-agent | 4 | `effect` |
| [latitude-dev/latitude-llm](https://github.com/latitude-dev/latitude-llm) | 4,642 | L4 | mcp-agent | 9 | `@effect/opentelemetry`, `effect` |
| [UsefulSoftwareCo/executor](https://github.com/UsefulSoftwareCo/executor) | 3,760 | L4 | mcp-agent | 12 | `@effect/atom-react`, `@effect/opentelemetry` |
| [open-wa/wa-automate-nodejs](https://github.com/open-wa/wa-automate-nodejs) | 3,653 | L4 | single-agent | 11 | `@effect/platform-browser`, `@effect/platform-bun` |
| [millionco/expect](https://github.com/millionco/expect) | 3,553 | L4 | mcp-agent | 12 | `@effect/atom-react`, `@effect/platform-node` |
| [athasdev/athas](https://github.com/athasdev/athas) | 3,055 | L3 | multi-agent | 2 | `effect` |
| [coder/xum](https://github.com/coder/xum) | 2,016 | L4 | coding-agent | 10 | `effect` |
| [steipete/birdclaw](https://github.com/steipete/birdclaw) | 1,652 | L3 | mcp-agent | 3 | `effect` |
| [cyberpapiii/chipotlai-max](https://github.com/cyberpapiii/chipotlai-max) | 1,556 | L4 | mcp-agent | 8 | `effect` |
| [amicalhq/amical](https://github.com/amicalhq/amical) | 1,530 | L2 | workflow-agent | 7 | `effect` |
| [aws-samples/bedrock-chat](https://github.com/aws-samples/bedrock-chat) | 1,323 | L3 | single-agent | 1 | `effect` |
| [LodyAI/Lody](https://github.com/LodyAI/Lody) | 1,049 | L4 | mcp-agent | 7 | `effect` |
| [AltimateAI/altimate-code](https://github.com/AltimateAI/altimate-code) | 811 | L4 | mcp-agent | 14 | `@effect/opentelemetry`, `@effect/platform-node` |
| [FrancescoStabile/numasec](https://github.com/FrancescoStabile/numasec) | 779 | L4 | mcp-agent | 13 | `@effect/opentelemetry`, `@effect/platform-node` |
| [joelhooks/swarm-tools](https://github.com/joelhooks/swarm-tools) | 735 | L2 | mcp-agent | 6 | `effect` |
| [browser-use/browsercode](https://github.com/browser-use/browsercode) | 716 | L4 | single-agent | 14 | `@effect/opentelemetry`, `@effect/platform-node` |
| [s0ld13rr/pentestcode](https://github.com/s0ld13rr/pentestcode) | 700 | L4 | mcp-agent | 13 | `@effect/opentelemetry`, `@effect/platform-node` |
| [openteams-lab/openteams](https://github.com/openteams-lab/openteams) | 612 | L2 | multi-agent | 10 | `@effect/platform-node`, `effect` |
| [momozi1996/momo-code](https://github.com/momozi1996/momo-code) | 604 | L4 | coding-agent | 6 | `effect` |
| [paperboytm/spool](https://github.com/paperboytm/spool) | 590 | L2 | multi-agent | 7 | `@effect/opentelemetry`, `effect` |
| [shobcoder/shob](https://github.com/shobcoder/shob) | 581 | L4 | coding-agent | 13 | `@effect/opentelemetry`, `@effect/platform-node` |
| [maria-rcks/t1code](https://github.com/maria-rcks/t1code) | 520 | L4 | single-agent | 12 | `@effect/platform-node`, `@effect/sql-sqlite-bun` |
| [morapelker/hive](https://github.com/morapelker/hive) | 470 | L4 | single-agent | 9 | `effect` |
| [smithersai/smithers](https://github.com/smithersai/smithers) | 412 | L4 | workflow-agent | 14 | `@effect/opentelemetry`, `@effect/platform-bun` |
| [boringcomputers/nehemiah](https://github.com/boringcomputers/nehemiah) | 326 | L4 | mcp-agent | 7 | `effect` |

**Effect 能力频次**（在 L2+ 项目里）：

| 能力 | 项目数 |
| --- | --- |
| gen | 32 |
| error | 31 |
| primitives | 28 |
| service | 26 |
| concurrency | 26 |
| schema | 26 |
| resource | 26 |
| stream | 22 |
| observability | 20 |
| config | 18 |
| platform | 17 |
| cluster | 14 |
| httpapi | 11 |
| sql | 9 |
| cli | 1 |

## 7. Case Studies

v0.1 做了 **4 篇**（3 个 L4 + 1 个 L2 反例），见 [case-studies/](../../packages/observatory/case-studies/)。
配套文章草稿：[reports/article-01-effect-agent-ecosystem.md](../../reports/article-01-effect-agent-ecosystem.md)。

> 计划要求"必须深入源码"，所以宁可只写 4 篇能落到文件与代码的，也不写 10 篇浅的。
> 每篇的证据文件都来自全仓扫描的真实命中列表 —— 不是读 README 得来的印象。

## 8. 框架对比

**v0.1 不做完整的框架对比矩阵。** 只填有证据的格子，其余留白 —— 留白比编造好：

| 能力 | Effect | Mastra | LangGraph | Vercel AI SDK |
| --- | --- | --- | --- | --- |
| LLM | ✅ @effect/ai | — | — | — |
| Tool | ✅ | — | — | — |
| Typed Error | ✅（类型级） | — | — | — |
| Dependency Injection | ✅ Layer/Context | — | — | — |
| Resource Lifecycle | ✅ Scope | — | — | — |
| Structured Concurrency | ✅ Fiber | — | — | — |
| Retry / Timeout | ✅ Schedule/timeout | — | — | — |
| Streaming | ✅ Stream | — | — | — |
| MCP | ✅ 生态包 | — | — | — |

> "—" 表示**本次未取证**，不表示该框架没有这个能力。

## 9. Benchmark

**v0.1 不做。** 计划里 3–5 天的三实现对等实现 + 故障注入矩阵留给 v0.2。
理由：同 LLM、同 prompt 下的"更快"差异主要来自框架开销与重试策略，噪声大到足以被写成结论。
真正值得测的是**失败语义**（取消时资源是否释放、错误是否被静默吞掉），那不在这份报告的射程内。

## 10. Limitations

- **GitHub 可见性偏差**：私有仓库与企业内部项目完全不可见；
- **星数门槛偏差**：stars ≥ 300 排除了大量真实但小众的项目；
- **时间窗偏差**：180 天不活跃即出局；
- **语言字段偏差**：`language` 按字节占比，会误判；
- **命名/描述偏差**：只在 name/description/topics 匹配关键词，描述写得差的仓库会漏；
- **分类器偏差**：规则优先 + 证据分级，判不准的记为 uncertain（本报告 2,177 个）；
- **样本量**：L2+ 只有 33 个项目，任何百分比都应当按"个位数级别的样本"来读。

> 因此本报告研究的是 **Open Source Agent Ecosystem**，不是整个 Agent 产业。

## 11. 结论

- **Scenario C：Effect 在 Agent Runtime 中有明显技术价值，但生态规模仍然有限。**
  在有界宇宙的 856 个 TypeScript Agent 里，真正把 Effect 用进业务（L2+）的只有 33 个（3.9%）——
  规模上远谈不上"下一种范式"；但这 33 个里 23 个是 L4（Effect 是 Runtime 的地基），
  而不是浅尝辄止的 L2/L3，说明**采用者的用法很重**：他们不是在 Agent Loop 里顺手 import 一下，
  而是把整个执行模型建在 Effect 上。
- **H4 得到支持，H2 仍未验证。** 数据支持"Effect 的价值在 Agent Loop 之下的 Runtime"：
  L2+ 项目最常用的能力是服务与依赖注入（Layer/Context）、类型化错误、Scope 资源管理、Stream 与 Fiber 并发——
  全是运行时能力，而不是"怎么调 LLM"。至于"H2 框架竞争力是否真的转向 Runtime"，需要框架对比矩阵，
  v0.1 没有取证，因此不下结论。
- **判不准的比例（44.8%）本身就是结论的一部分。** 我们无法用规则+文件路径判定近一半候选是不是 Agent——
  这不是数据脏，而是"Agent"这个概念在开源世界里还没有稳定的边界（一个 MCP 工具服务器算不算？
  一个把 Claude Code 包一层的 CLI 算不算？）。任何把这个比例当成精确数字引用的做法都比数字本身更危险。
- **对本站的含义**：这个数字不足以支撑"Effect 是 Agent 的未来"这种话术，但足以支撑一件事——
  **用 Effect 做 Agent 的人，都是在解决运行时问题**。中文世界缺的正是这类内容：
  不是"怎么调 LLM"，而是"失败、取消、资源、并发怎么收敛"。这与站点既有的错误管理与并发章节是对齐的。
