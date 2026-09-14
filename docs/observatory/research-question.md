# 研究问题（Effect × AI Agent Ecosystem v0.1）

> 项目代号：**Effect Agent Ecosystem Observatory**
> 启动：2026-09-14 · 数据集版本 `0.1` · 分类器版本 `0.1`
> 关联：[methodology.md](./methodology.md) · 数据快照 `packages/observatory/data/snapshots/<date>/`

## 0. 一句话

> **2026 年，Effect-TS 正在成为 AI Agent 的下一种工程范式吗？**

这个问题的答案**允许是否定的**。项目立项时就把"数据证明 Effect 还不是重要路线"当作合法结局之一
（见 §4 的四种 Scenario）。任何为了让结论好看而调整口径的动作，都算项目失败。

## 1. 为什么这个问题值得单独建一套数据系统

Agent 系统的复杂度正在从"怎么调 LLM"转移到传统软件工程问题上：
失败重试、并发、取消、资源生命周期、依赖注入、流式、可观测、状态与持久化。
Effect-TS 恰好以这些为核心能力（Typed Error / Layer / Structured Concurrency / Scope / Stream / Schema）。

于是有两个互相独立的问题需要分开回答：

- **规模问题**：GitHub 上到底有多少人在用 Effect 做 Agent？（本项目的 Dataset）
- **工程问题**：用了 Effect 的 Agent 项目，是否在**可靠性 / 生命周期 / 并发**上真的更好？（留给 v0.2 的 Benchmark）

v0.1 只回答规模问题，**不声称任何性能或成熟度排名**。

## 2. 四个待验证假设

| # | 假设 | v0.1 能否证伪 |
| --- | --- | --- |
| H1 | Agent 正在从 "AI Application" 演变为 "Agent Runtime" | 部分：靠 `has_tool_calling / has_mcp / has_memory / has_workflow / has_streaming` 的共现率 |
| H2 | Agent Framework 的竞争力从"调 LLM"转向"管 Runtime 复杂度" | **不能**（需要框架对比矩阵 + 证据，v0.2） |
| H3 | Effect 正在进入 Agent Engineering | 能：Effect Agent 项目数、占 TS Agent 的比例、逐月增长 |
| H4 | Effect 的价值可能不在 Agent Loop，而在它下面的 Runtime | 部分：靠 Effect 能力使用分布（Layer/Scope/Schedule/Stream vs 仅 Effect.gen） |

**v0.1 明确不回答 H2。** 把"框架竞争力"当结论写出来而只有 star 数与文档对比，是最容易变成软文的地方。

## 3. 验收问题（对应计划的 Q1–Q14，标注 v0.1 覆盖情况）

| # | 问题 | v0.1 |
| --- | --- | --- |
| Q1 | 有多少符合定义的 Agent 项目 | ✅ 有界宇宙内 |
| Q2 | 语言分布如何 | ✅ |
| Q3 | TypeScript Agent 有多少 | ✅ |
| Q4 | 其中多少用 Effect | ✅ |
| Q5 | Effect Agent 占 TS Agent 的比例 | ✅（分母口径必须同页写出） |
| Q6 | Effect Agent 的 stars 分布 | ✅ |
| Q7 | 活跃度如何 | ✅（push/90 天、releases） |
| Q8 | 是 Demo 还是工程项目 | 🟡 用"生产信号分"辅助判断，**不声称是成熟度排名** |
| Q9 | 哪些值得深入研究 | ✅ → case studies |
| Q10 | Effect 在这些项目里解决了什么 | ✅ → 能力证据（文件级） |
| Q11 | 与 Mastra / LangGraph / Vercel AI SDK 的差异 | 🟡 只做**有证据的格子**，留白比编造好 |
| Q12 | 统一 Benchmark 能否观察到收益 | ❌ 留给 v0.2 |
| Q13 | Effect Agent 生态是否在增长 | 🟡 v0.1 建立基线，第二期快照后才能谈增长 |
| Q14 | 证据是否足以支持"新范式" | ✅ 允许结论为否定 |

> 这里的取舍是刻意的：**宁可少答几问，也不要答得没有证据。**
> 计划里 10 个 Phase 全部塞进 v0.1，结果是每一条都浅 —— 那正是"看起来像研究"的东西。

## 4. 结论的四种合法形态

| Scenario | 内容 |
| --- | --- |
| A | Effect 已成为 TypeScript Agent 的重要基础设施 |
| B | Effect 正在快速增长，但仍处早期 |
| C | Effect 在 Agent Runtime 中有明显技术价值，但生态规模仍有限 |
| D | 目前没有足够证据支持 Effect 成为 Agent 范式 |

四者都必须能写、必须写。报告的"结论"一节**先给出 Scenario 判定，再给证据强度**。

## 5. 不做的事（负面清单）

- 不用 README 里的自我描述当"事实"（只当分类输入，且必须与代码证据一致）；
- 不让 LLM 生成任何数字（star / contributor / release / 依赖一律来自 API 或仓库文件）；
- 不把"用了 effect 依赖"等同于"用了 Effect 架构"（分四级，见 methodology）；
- 不做性能排名（同 LLM 同 prompt 下的耗时差异不足以支撑结论）;
- 不把 GitHub 开源生态等同于整个 Agent 产业。
