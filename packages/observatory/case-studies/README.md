# Case Study 索引（v0.1）

> 数据来源：`packages/observatory/data/snapshots/2026-09-14/effect-scan.json`（tarball 全仓扫描）
> 与 `dataset/effect-agents.csv`。每个案例的每条数字都能在快照里查到。

## v0.1 做了 5 篇

| 项目 | ★ | Effect 深度 | 为什么选它 |
| --- | ---: | --- | --- |
| [anomalyco/opencode](./opencode.md) | 207,170 | **L4** | 规模最大、用法最深的 Effect Agent（950 个文件 import effect，14 项能力） |
| [ComposioHQ/composio](./composio.md) | 30,160 | **L4** | 渗透度 3.7% 却用得很深：Effect 集中在 CLI 与工具链 |
| [baptisteArno/typebot.io](./typebot.io.md) | 10,318 | **L4** | 真实产品（不是框架）：用 `@effect/sql-pg` + `@effect/opentelemetry` 做数据与可观测 |
| [latitude-dev/latitude-llm](./latitude-llm.md) | 4,642 | **L4** | 渗透度 **79.6%**（全仓最高）：Effect 放在中间件/runtime 横切层 |
| [elizaOS/eliza](./eliza.md) | 19,331 | **L2** | **反例**：2.2 万个文件里只有 3 个 import effect —— star 数 ≠ Effect 使用 |

## 为什么是 5 篇而不是 10 篇

计划的 §31 要求"必须深入源码"。与其写满 10 篇浅的，v0.1 只写 5 篇**能落到文件与代码**的：
每篇的"证据文件"都来自全仓扫描的真实命中列表，不是读 README 得来的印象。

剩下 28 个 L2+ 项目的能力证据见 `dataset/effect-agents.csv`（每行都带 `effect_capabilities` 与 `effect_deps`）。
v0.2 的目标是把深案例补到 8–10 篇，并补齐"同源谱系"标注（例如 kilocode 与 MiMo-Code 的包结构
与 opencode 一致，属于衍生版而非独立实现——不标注会让生态看起来比实际更多样）。
