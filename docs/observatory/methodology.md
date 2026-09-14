# 方法论（Effect × AI Agent Ecosystem v0.1）

> 这份文档是项目的**宪法**：口径一旦定错，后面所有数字都要重跑。
> 所有数字都可以用仓库里的命令复现；所有约束都有实测依据（不是设计时的猜测）。

## 1. 有界宇宙（Frame）—— 必须写在每份报告的第一页

### 1.1 定义

```
GitHub 公开仓库
  ∧ stars ≥ 300
  ∧ pushed ≥ (快照日 - 180 天)
  ∧ 命中 5 种语言 × 16 个 Agent 方向词 之一（name / description / topics）
```

**这是有界宇宙，不是 "GitHub 上全部 Agent 项目"。** 报告里出现的任何比例
（例如 "Effect Agent 占 TS Agent 的 X%"）分母都是这个宇宙，不是整个 Agent 产业。

### 1.2 为什么必须有界（实测，不是设计取舍）

GitHub 搜索**每条 query 最多返回 1000 条**：

```
"AI agent" language:TypeScript → total_count 43,349
"AI agent" language:Python     → total_count 122,778
page=11（第 1001 条起）        → HTTP 422 "Only the first 1000 search results are available"
```

不加限定的"全量爬取"在 API 层面就不存在。加星数门槛 + 时间窗之后，候选规模落到可枚举区间：

| 语言 | 6 个探针关键词合计（去重前上限） |
| --- | ---: |
| Python | 978 |
| TypeScript | 804 |
| Go | 224 |
| Rust | 201 |
| Java | 79 |

### 1.3 泛词会被**抬高星数下限**（并逐条记录）

裸词（如 `agent`）在 stars ≥ 300 时仍可能超过 1000。此时**抬高该查询的星数下限**
（几何台阶 600 → 900 → 1200 → …）直到可枚举，并把实际生效下限写进
`search-calls.json` 的 `effectiveMinStars` 与 `frame.json` 的 `raisedFloors`。

代价必须说清：**这些查询只覆盖高星部分**。替代方案（星段二分）实测会退化 ——
泛词在每个窄段里都仍超上限，一次查询要几百次 API 调用且最后还是截断。

### 1.4 配额纪律

| 资源 | 限额 | 我们的做法 |
| --- | --- | --- |
| core | 5000/小时 | 每 20 次调用复核一次；低于 10% 且重置很远就停止 |
| search | 30/分钟 | 调用间隔 2.3s（≈26/分钟）；不够时**等到重置**而不是失败 |
| code search | 10/分钟 | 只在必要时用；深度验证走 tarball 扫描而不是全局 code search |

**每一条 API 响应都落盘缓存**（`artifacts/observatory/cache/`，已 gitignore）。
理由不是"省时间"，是**正确性**：一次限流若被读成"这个仓库不依赖 effect"，
就会伪装成一次成功的筛选（生态榜采集器踩过这个坑）。

## 2. 查询集（= 口径的一部分）

- **语言**：TypeScript / Python / Rust / Go / Java（计划 §12.1）
- **方向词**（12 个）：`agent` `llm` `mcp` `rag` `copilot` `chatbot` `harness` `workflow`
  `tool calling` `function calling` `multi-agent` `coding assistant`
- **短语**（4 个）：`"AI agent"` `"agent framework"` `"agent runtime"` `"LLM agent"`
- **匹配位置**：`in:name,description,topics` —— **不搜 README**。
  README 会大量误召（"我们也用过 LangChain"），而 name/description/topics 是维护者主动声明的定位。

查询集**写在代码里**（`packages/observatory/src/queries.ts`），每次快照都随快照一起冻结。
改查询集 = 改口径 = 数据集版本 +1。

## 3. 去重规则

| 情形 | 处理 | 理由 |
| --- | --- | --- |
| 同一 `owner/name` 被多条查询命中 | **合并**（`via` 取并集，star 取较大值） | 不是两个项目 |
| `fork = true` | 排除 | fork 的 star 会污染规模统计 |
| `archived = true` | 排除出主集，**保留名单** | 计划要求"除非有历史重要性" ⇒ 得让人看得见 |
| 名字归一化后相同（`agent` / `Agent.js` / `agent-ts`） | **只标记，不丢弃** | 可能是同一项目的两个组织，也可能是无关项目；误丢真实项目比多留一条更贵 |

`possibleDuplicates` 进证据表交人判断（与生态榜"机器出事实、人写判断"一致）。

## 4. Agent 判据（**可代码验证**，v0.1 核心）

README 与 LLM 印象都不算证据。一个仓库进入 Agent 集，必须满足：

| # | 条件 | 证据形态 |
| --- | --- | --- |
| A1 | **有 LLM 接触** | manifest 依赖（`openai` / `@anthropic-ai/sdk` / `@ai-sdk/*` / `ai` / `@effect/ai` / `langchain` / `llama-index` / `ollama` …）**或**源码里出现 LLM HTTP 调用 |
| A2 | **有执行结构**（至少一项） | ① tool/function schema 定义 ② agent loop（循环调用 LLM）③ workflow / graph 编排 ④ 多 agent 协作 ⑤ MCP server/client |
| A3 | **不是纯 wrapper** | 不是"把单次 LLM 调用包成函数"：需 ≥2 项（工具 / 状态 / 记忆 / 编排 / 流式 / 重试） |
| A4 | **不是教学产物** | 排除 tutorial / demo / course / awesome-list / 纯文档 / 纯 UI demo |

**每条判定都要给出文件级证据**（`evidence: ["src/agent/loop.ts", ...]`）。
证据路径必须真实存在于该仓库的文件清单里 —— 这条由构建期校验（生态榜已验证过同一机制：
指向不存在的文件 ⇒ 构建失败）。

**判不准就标 `uncertain`，不硬塞。** 灰区（confidence 0.6–0.9）抽样人审。

## 5. Effect 使用深度（L0–L4）

不因为 `package.json` 里有 `effect` 就算"Effect Agent"。判据与证据：

| Level | 含义 | 证据 |
| --- | --- | --- |
| L0 | 没用 Effect | 无 |
| L1 | 只是依赖 / 顺带用 | 有 import，但核心目录里不出现 Layer/Context/Schema/Stream |
| L2 | 部分业务逻辑用了 | 上述能力出现在少数模块 |
| L3 | Effect 是重要架构组成 | Layer + Context + Schema/Stream 等多能力在核心路径共现 |
| L4 | Effect 是 Agent Runtime 的核心 | Agent 执行模型本身建立在 Effect 上（runtime / fiber / layer 组装在核心目录） |

能力检测复用生态榜采集器已验证的实现（`packages/content/src/ecosystem.ts`：
`extractEffectDeps` / `scanFile` / `summarizeCapabilities`），字段对齐计划的 `EffectUsage` 表：
`uses_layer` `uses_context` `uses_schema` `uses_stream` `uses_concurrency` `uses_schedule` `uses_scope` `uses_ai`。

**全仓扫描而非抽样**：抽样漏掉某个 API 会变成"这个项目没用 Stream"的错误结论。

## 6. 事实 vs 判断

| 谁 | 产出 | 约束 |
| --- | --- | --- |
| 机器 | star / 活跃度 / 依赖 / 文件清单 / 能力命中 / 分类结论 + 证据 | 全部来自 GitHub API 或仓库文件 |
| LLM | **只做分类**（A2/A3 的灰区） | 不能生成任何数字；输入是 README + manifest + 文件清单；输出必须带证据路径 |
| 人 | case study 的中文解读、Scenario 判定 | 署名，可被反驳 |

LLM 分类的 prompt 与模型名写进快照的 `frame.json`（可复现性要求）。

## 7. 人工审核设计（v0.1 轻量版）

| 置信度 | 判定 | 处理 |
| --- | --- | --- |
| ≥ 0.70 | `agent` / `not-agent`（自动） | 计入统计 |
| < 0.70 | `uncertain`（**不计入**分子分母） | 分层抽样人审（按语言 × 是否 Effect 分层） |

阈值 0.70 是**实现里真实生效**的那条线（`agent-classify.ts` 的 `verdict`），
置信度由证据强度打底（manifest 0.80 / paths 0.60–0.78 / metadata 0.45）再加结构信号修正。
**判不准的比例本身就是结论的一部分**：v0.1 里它是 44.8%，说明"Agent"这个概念在开源世界还没有稳定边界。

人工审核产出：`docs/observatory/classification.md`，含 Precision / Recall（用抽样估计，**写明估计方法与样本量**）
以及具体错例。**"抽了 100 条都同意"不是精确率**，必须给区间。

## 8. 生产信号（只用于区分 Demo 与工程，不是成熟度排名）

star 分层（+1/+2/+3）· contributors（+1）· 近 90 天持续开发（+1）· 有 release（+1）·
有 CI（+1）· 有测试（+1）· 有容器/部署（+1）· 描述指向真实产品（+1）· 组织/企业维护（+2）。

**明确声明：这是启发式分数，不是标准化的生产成熟度。** 报告里只用于分组（Demo 组 / 工程组）。

## 9. 已知 Bias（必须在报告 §Limitations 原样列出）

- GitHub 可见性偏差（私有仓库、企业内部项目完全不可见）
- 语言偏差（`language` 字段按字节占比，TS 项目常被判成 JS/JSON/Markdown）
- 星数门槛偏差（stars ≥ 300 排除了大量真实但小众的项目）
- 时间窗偏差（180 天不活跃即出局，长期维护但低频的项目会被误伤）
- 命名/描述偏差（只在 name/description/topics 里匹配 ⇒ 描述写得差的仓库会漏）
- 搜索排序偏差（超上限的查询只覆盖头部）
- 分类器偏差（规则 + LLM 灰区判断）
- 归档偏差（archived 直接出局）

## 10. 复现方式

```bash
pnpm --filter @ecn/observatory discover --snapshot 2026-09-14      # 发现 + 冻结快照
pnpm --filter @ecn/observatory test                                # 判据的单元测试（零网络）
```

产物（`packages/observatory/data/snapshots/<date>/`）：

| 文件 | 内容 |
| --- | --- |
| `frame.json` | 有界宇宙声明、版本号、查询集规模、被抬高的下限、API 用量 |
| `candidates.json` | 候选池（每条带 `via`，可回溯到具体查询） |
| `search-calls.json` | 每次查询的命中数/取回数/生效下限/是否截断 + 被排除的名单 |
| `summary.json` | Q1–Q3 的汇总（语言分布、stars 中位数/分位、活跃度） |

**快照禁止覆盖**：目录已存在即报错（换日期或显式 `--force`，后者只用于本地调试）。
