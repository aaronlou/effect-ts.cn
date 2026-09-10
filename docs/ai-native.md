# AI-Native 产品设计：从"可读的站点"到"可被质问、可被 Agent 调用的知识层"

> 状态：设计 v1（待评审）· 关联：[PLAN.md](../PLAN.md) §2/§7、[docs/translation-guide.md](./translation-guide.md)
> 前置结论：本文假设 LLM 翻译本身已商品化，因此**"我们翻得比别人好"不构成产品**。

---

## 1. 判断：为什么"只做翻译"在这个时代不成立

三个已经发生的事实：

1. **翻译不是壁垒**。任何开发者都能让模型半小时内产出可读的中文译文。我们现在的护城河（可追溯同步、术语一致、门禁）是**质量下限**，不是差异化上限。
2. **阅读入口正在迁移到 Agent**。开发者越来越多地在 Claude Code / Cursor / DSH 里边写代码边问，而不是打开浏览器逐页读。英文 Effect 文档的 MCP 服务已经出现（[niklaserik/effect-mcp](https://github.com/niklaserik/effect-mcp)、[ghardin1314/effect-mcp](https://github.com/ghardin1314/effect-mcp)、[EffectPatterns MCP](https://effecttalk.dev/mcp)）——**中文语料在这一层目前是空白**。
3. **Effect 的学习瓶颈不是"读不懂英文"，而是"错在哪、该用哪个 API、这个版本还成立吗"**。这类问题静态文档天然回答不了。

**所以产品形态必须变：从"人来读的站点"变成"人和 Agent 都能质问的知识服务，且每个答案都可溯源、每个内容变更都可审计"。**

## 2. 设计原则（这个时代的 taste）

| # | 原则 | 含义（可检验） |
|---|---|---|
| 1 | **可溯源即可信** | 任何 AI 答案必须带 `依据：<页面>@<commit>#<anchor>`；检索不到证据就**拒答**并给出英文原文/提问入口。把现有的"同步即信誉"扩展到答案层 |
| 2 | **Agent 优先，而非 Agent 专属** | 同一份语料同时服务人（HTML/搜索）、LLM（`.md`/`llms-full.txt`）与 Agent（MCP 工具）。机器可读是一等公民 |
| 3 | **AI 起草，人审发布** | 社区稀缺的是人的判断力。译文草稿、答案草稿、练习题、落后页更新都由 Agent 起草，人审通过才发布；每个产物记录 `draftedBy`（模型+prompt 版本）与 `reviewedBy` |
| 4 | **靠"跑起来"验证，而非"感觉对"** | 示例与练习由**执行**验证（浏览器 Effect runtime / CI），不由 LLM 打分 |
| 5 | **不锁不骗** | 站点无需登录即可用；译文不设 AI 门槛；配额只用于防滥用；全部开源可自托管 |

## 3. 五个产品形态（按杠杆排序）

### S1 · 问这一页（Ask this page）
**交互**：文档页上 `⌘I` 或选中文本 → "解释这段 / 为什么这样写 / 和 v3 有何区别"；答案流式返回，句句挂锚点；证据不足时明确说"文档里没有"。
**与直接用 ChatGPT 的差异**：① 版本锚定（"本页落后上游 3 个提交，答案基于 `16b1646`"）；② 引用可点回到具体小节；③ 遵守我们的术语表；④ 敢拒答。
**实现要点**：在页面粒度做 chunk + 保留 heading 路径 → 检索（先 BM25/标题加权，后加 pgvector）→ `@effect/ai` 的 `AiLanguageModel.streamText` 流式生成 → SSE 端点 `/api/ask`；引用用 `AiToolkit` 工具（`getPage`、`searchDocs`）强制产生结构化引用，而不是让模型自己编 URL。
**指标**：**可验证答率**（答案中至少一个引用能解析到真实页面+锚点+commit 的比例）≥ 95%；拒答正确率 ≥ 90%。

### S2 · 报错翻译官（Effect Error Explainer）
**交互**：`/debug` 粘贴一段 TypeScript 报错（可选代码）→ 输出：白话诊断 + "你大概想写的是…" + 精确定位到文档小节 + 版本判断（3.x / v4 rc）+ 可复制的修复片段（可一键在 Playground 打开）。
**为什么这是杀手级**：Effect 的类型错误是初学者流失的头号原因，报错长到没人愿意读完；中文世界没有对应工具。**且报错高度重复** —— 同一个规范化后的报错第一次贵，之后命中缓存近乎免费。
**实现要点**：确定性预处理（剥掉 `node_modules` 绝对路径、泛型编号归一化）→ 以"错误签名（TS 错误码 + 涉及类型名）"做键检索 → 文档锚定的解释生成 → **按签名的答案缓存** → 产出沉淀为公开的「报错百科」（版本化、人审）。
**指标**：缓存命中率 ≥ 60%；答案附带可复制修复片段的比例 ≥ 80%。

### S3 · Agent 接口：中文 Effect 知识的 MCP Server + `.md` 端点
**形态**：`npx effect-ts-cn-mcp`（stdio）+ 托管 HTTP/SSE；工具集：`search_docs`、`get_page`、`get_page_markdown`、`glossary`、`translation_status(slug)`（Agent 能知道"中文有没有、落后多少"）、`explain_error`、`ask`。
**差异**：英文 MCP 已存在，我们提供的是**中文 + 版本锚定 + 翻译状态 + 社区验证答案**；且语料是我们自己维护、可审计的。
**实现要点**：Effect 服务层复用 S1/S2 的用例；传输层用官方 MCP TS SDK 包一层（**Effect v4 的 API 参考里已有 `McpServer` 模块**，迁移到 v4 后可直接换）；同时提供 `/docs/<slug>/index.md`、`/llms-full.txt` 给"只会 fetch 的 Agent"。
**指标**：外部 Agent 的周调用量；由 MCP 带来的中文文档页到达。

### S4 · 会跑的教程与练习（有人审的 AI 出题）
**交互**：每个示例可 "Run"；每节课末尾 2–3 道练习（"把这段 `async/await` 改写成 `Effect.gen`"），提交后在浏览器跑**隐藏测试**得到判定与提示；进度存本地（无需账号）。
**AI-native 点**：练习题供给是所有学习产品的瓶颈。Agent 批量生成变体 + CI 校验（参考解必须通过、朴素错误解必须失败），人只负责挑选与润色。
**指标**：练习完成率；人均完成题数。

### S5 · 社区问答的"AI 起草 + 人审"闭环（也是 S1/S2/S3 的语料来源）
**形态**：从公开来源（GitHub Issues、公开 Discord 频道，须获授权）聚类真实问题 → Agent 依文档起草答案 → 维护者审核 → 落地为文档页底部的「社区常问」与独立 FAQ。
**为什么必须有**：没有用户时，"问答区"是空的；靠 Agent 起草 + 人审，冷启动也能积累语料，而且这份语料正是 S1/S2/S3 的护城河。
**provenance 模型**：每条答案记录 `questionSource`、`draftedBy`、`reviewedBy`、`basedOn(page@commit)` —— 与我们译文同一套思路。

## 4. 架构：落在现有 DDD 骨架上

新增两个上下文 + 一个网关，其余复用现有 `contracts / content / Identity`：

```
KnowledgeContext（语料与检索）
  domain:    CorpusUnit（页面切片：version/slug/commit/anchorPath/text）、GlossaryTerm
             ports: Retriever、CorpusIndex、Embedding
  infra:     构建期切片索引（首发）/ pgvector（二期）、glossary 注入
AssistantContext（问答与解释）
  domain:    Question、Answer（不变量：**无引用不成立**）、Citation、Feedback、Quota
             use cases: AskPage、ExplainError、AnswerFAQ
  infra:     LlmPort（包装 @effect/ai LanguageModel）、AnswerCache(按规范化 hash)、CostMeter
AgentGateway（对外 Agent 面）
  interfaces: /api/ask (SSE)、/docs/<slug>/index.md、/llms-full.txt、
              MCP tools（stdio + HTTP）、OpenAPI 契约进 packages/contracts
```

**为什么用 Effect 是对的（也是给社区的教学标本）**：流式答案 = `Stream`；多供应商回退 = `Layer` + 标签化错误；LLM 重试/超时 = `Schedule` / `Effect.timeout`；并发闸门 = `Semaphore`；按签名的答案缓存 = `Cache`；成本核算与预算熔断 = `Metric` + `FiberRef`；MCP 工具 = 类型化 `Toolkit`；全套可用 mock `LanguageModel` Layer + `TestClock` 测试 —— **"AI 后端"本身成为和现有 DDD 后端一样的 dogfood 教材**。

**答案的数据结构（关键不变量）**：

```ts
interface Citation {
  slug: string          // v4/error-management/expected-errors
  version: "v3" | "v4"
  commit: string        // 该页译文/上游基线
  anchor?: string       // 小节锚点
  quote?: string        // 支撑该结论的原文片段
}
interface Answer {
  question: string
  body: string                  // 中文回答（流式产出）
  citations: readonly Citation[] // 空数组 => 视为拒答
  basedOnStaleness?: readonly string[] // 涉及的落后页
  draftedBy: { model: string; promptVersion: string }
  reviewedBy?: readonly string[] // 人审后才有
}
```

## 5. 质量、成本与滥用工程（必须写在设计里，不能事后补）

| 关注点 | 做法 |
|---|---|
| 幻觉 | 引用强制（`citations` 为空即拒答）+ 只允许引用检索到的片段（模型不能自造 URL）+ 版本钉住 + 展示基线 commit |
| 成本 | **规范化问题/报错 hash → 答案缓存**（Effect 报错重复率极高，这一条就能压掉大部分成本）；小模型做分类/改写，大模型只做最终综合；检索全程确定性、不用 LLM |
| 预算 | 日 token 预算作为 `Metric` + 熔断：超预算自动降级为"搜索 + 官方原文"模式（**宁可退化，不可胡说**） |
| 滥用 | 按 IP/会话配额 + `RateLimiter`；登录（Phase 2 Identity）可提升配额；不开放匿名写 |
| 隐私 | 默认不持久化粘贴的代码（仅存 hash）；留存需显式同意；公开数据政策 |
| 术语一致 | 把现有 `docs/glossary.json` 的**黑名单复用在校验模型输出上**（AI 也必须遵守社区术语） |
| 回归 | CI 评测门禁：20 条黄金问题（含 3 条**应拒答**）断言"引用可解析 + 拒答正确 + 术语合规"；模型或 prompt 变更必须过评测 |

## 6. 分期路线

| 阶段 | 交付 | 依赖 | 验收 |
|---|---|---|---|
| **Slice 0**（数天） | Agent 可读语料：`/docs/<slug>/index.md`、`/llms-full.txt`、按 `Accept` 协商、页面级 provenance（header 带 version/commit） | 无 | 用 `curl`/Agent 能直接取到干净 Markdown 与基线；零 LLM 成本 |
| **Slice 1**（1–2 周） | **问这一页**：SSE 流式 + 引用 + 拒答 + 答案缓存 + 配额 + CI 评测门禁 | Slice 0 | 可验证答率 ≥95%、拒答正确率 ≥90%、缓存命中 ≥40% |
| **Slice 2**（2–3 周） | **报错翻译官** `/debug` + 报错百科（公开、版本化、人审）+ Playground 交接 | Slice 1 的检索与评测 | 缓存命中 ≥60%；修复片段可复制率 ≥80% |
| **Slice 3**（2–3 周） | **MCP Server**（stdio + 托管）+ npm 发布 + Agent 文档 | Slice 1/2 的用例 | 外部 Agent 周调用量 > 0 并持续增长 |
| **Slice 4**（持续） | AI 起草 + 人审：落后页更新 PR、FAQ 聚类与起草、练习题生成 | 全部 | 落后页平均修复时长下降；FAQ 条目数增长 |

## 7. 风险与反面论证（诚实版）

1. **"直接问 ChatGPT 就行"** —— 成立，且 baseline 会持续变强。所以我们赌的不是模型，而是**语料 + 溯源 + 术语 + 社区审校**这四件模型拿不到的东西；答案必须引用我们的页面与 commit，这本身就是差异化体验。
2. **上游官方做了中文/官方助手怎么办** —— 我们赢在"社区问答 + 版本差异 + 报错百科"；且一切 MIT 可导出，最优结局是与官方合并努力，而不是竞争。
3. **维护负担**（prompt/模型漂移）—— 用评测门禁 + `draftedBy` provenance + 可重生成来对冲；能重跑的东西不怕漂移。
4. **成本失控** —— 缓存优先 + 小模型路由 + 预算熔断 + 退化到静态内容。
5. **内容合规** —— 只用 MIT 文档 + 获授权的公开来源；用户提交需附贡献许可；Discord 私密内容一律不采。

## 8. 建议的第一刀

**Slice 0 + Slice 1 一起做**，理由：这是"可溯源 AI"这一主张的最小完整证明，且 S2/S3/S5 全部复用它的检索、引用、缓存与评测基础设施。具体交付：

1. `KnowledgeContext`：构建期页面切片索引（版本/锚点/commit 随切片）+ 检索端口；
2. `AssistantContext`：`AskPage` 用例 + 引用不变量 + 拒答 + 答案缓存；
3. `AgentGateway`：`/api/ask`（SSE）+ `.md`/`llms-full.txt` 端点；
4. 前端：文档页 `⌘I` 提问面板（引用可点回锚点，显示基线 commit 与落后提示）；
5. CI 评测门禁 + `docs/ai-native.md` 里这套不变量对应的单测。

**北极星指标**：**可验证答率**（答案引用能解析到真实页面+锚点+commit 的比例），而不是"回答了多少问题"。
