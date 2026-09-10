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

## 7.5 实现状态（本仓库当前）

| 能力 | 状态 | 位置 |
| --- | --- | --- |
| 语料层（页面切片 + 真实锚点 + 基线） | ✅ 已上线 | `packages/knowledge`（BM25F-lite）、`packages/content corpus` |
| 可溯源问答（引用不变量 + 拒答 + 版本/落后提示） | ✅ 已上线 | `apps/api` → `POST/GET /api/knowledge/ask` |
| 话题归属（"中文还没这一页"而非硬答，含章节级话题） | ✅ 已上线 | `packages/knowledge/src/topics.ts` |
| 提问意图（定义型问题优先定义小节） | ✅ 已上线 | `packages/knowledge/src/intent.ts` |
| 伪命中防护（中文单字噪声 + idf 覆盖率门禁） | ✅ 已上线 | `packages/knowledge/src/bm25.ts` |
| 答案缓存（同一问题零成本） | ✅ 已上线 | `apps/api` AnswerCache（TTL 30 分钟 / 500 条） |
| 限流（默认 20 次/分钟，429 带 retryAfterSeconds） | ✅ 已上线 | `apps/api` RateLimiter |
| 术语门禁作用于 AI 输出 | ✅ 已上线 | 应用用例 + `docs/glossary.json` |
| Agent 可读语料（`/llms.txt`、`/llms-full.txt`、`/docs/<slug>.md`） | ✅ 已上线 | `apps/site` 静态端点 |
| MCP Server（stdio，离线自包含） | ✅ 已上线 | `apps/mcp`（`pnpm mcp`） |
| 模型润色（DeepSeek 预设 / 任意 OpenAI 兼容，失败自动回退 extractive） | ✅ 已实现（`DEEPSEEK_API_KEY` 一条配置即可；`pnpm llm:check` 可验证） | `apps/api` `LlmLive`、`provider-config.ts` |
| 站内 UI（⌘I「问这一页」、/ask 页） | ✅ 已上线 | `apps/site` AskPanel |
| 评测门禁（recall@3、拒答、引用可解析、术语合规） | ✅ 已上线 | `packages/knowledge/test`、`packages/content/test`、`apps/mcp/test` |
| 报错翻译官（S2 v0：提取锚点 → 定位相关小节） | ✅ 已上线（`/debug` + `POST /api/knowledge/explain`） | `packages/knowledge/src/explain.ts` |
| 模型诊断（S2：基于同一份引用写诊断） | ✅ 已实现（配置 Key 后启用 diagnose 意图） | `apps/api` ExplainError |
| 报错百科（公开、版本化、人审） | ⏳ 未实现 | 见 §3 S2 |
| 可运行练习与隐藏测试（S4） | ⏳ 未实现 | 见 §3 S4 |
| AI 起草 + 人审的 FAQ（S5） | ⏳ 未实现 | 见 §3 S5 |

> 默认形态是 **extractive**：没有 API Key 时问答依然完整可用（检索 + 引用 + 拒答），
> 只是不做行文润色。这既是成本考量，也是可信度考量 —— 事实来自检索，不来自模型记忆。

## 7.6 每轮迭代的自检仪式（问自己两句话）

> 每次迭代结束前，必须回答：**① 这个站现在算 AI-native 吗？② 它"闻起来"对吗？**
> 不许凭感觉 —— 下面每条都要能用测试或实测证据回答。

| # | 自检项 | 判定方式 |
| --- | --- | --- |
| 1 | Agent 能自己用上吗？ | MCP / HTTP / `.md` 三种入口存在且有测试或实测 |
| 2 | 答案可溯源吗？ | 引用可解析到真实页面+锚点+基线（有断言） |
| 3 | 它敢说"不知道"吗？ | `no-match` 与 `untranslated` 两条拒答路径都有测试 |
| 4 | 无 Key 能用吗？ | extractive 为默认；provider 用假服务验证（成功/失败/缺字段） |
| 5 | AI 遵守社区术语吗？ | 违反即回退，有测试 |
| 6 | 产品把它讲出来了吗？ | 首页/导航/文档能发现它；搜索与问答不互为孤岛 |
| 7 | 输出干净吗？ | 不重复、不啰嗦（例如 quote 只出现一次，对 Agent 省 token） |
| 8 | 有反馈回路吗？ | 用户能低成本报告"答案不对/引用过期" |
| 9 | 知识够深吗？ | 高频问题不能只能答"中文还没翻译" |
| 10 | **没有后端时它还能用吗？** | 静态托管（我们的默认形态）下 AI 必须**降级**而不是消失：⌘K 与 `/ask`、`/debug` 退化为浏览器内检索，并明确标注"未连接问答服务" |
| 11 | **产物本身被门禁验过吗？** | 构建产物（`/search-index.json`、锚点）必须进 CI：答对金标问句、对无关问句必须无结果、引用锚点必须点得到 |
| 12 | **它一直在场吗？** | 每个页面都能唤起（不是只有文档页）；状态诚实（在线 / 本地）；选中文字可直接问；拒答也给下一步 |

**上一轮自检结论**（第 1 轮）：

- ❌→✅ **6 易发现性**：首页当时只字未提 AI，且仍写"问答建设中"；⌘K 搜索与 ⌘I 问答互不相通。
  修复：首页新增「AI 原生」区块与入口；搜索无结果时直接给出"用站内文档问答试试"（带问题跳转）。
- ❌→✅ **7 输出干净**：extractive 答案把引用原文重复两遍。修复：quote 只在 `citations` 里出现一次，
  答案只留"去哪看"的清单（含"含代码示例"提示）。
- ❌→✅ **8 反馈回路**：无。修复：每个回答/拒答底部提供「报告（自动附上问题与引用）」，
  直接开带 `ai-feedback` 标签的 Issue —— 零后端、零垃圾数据，且能反哺后续"AI 起草 + 人审"。
- ❌→✅ **9 知识深度**：语料从 10 篇扩到 **14 篇**，补上
  `requirements-management/layers`、`error-management/{two-error-types,expected-errors}`、
  `concurrency/fibers`。实测（同一套 API，扩语料前 → 后）：
  「Layer 怎么做依赖注入？」拒答 → **作答**（`layers#注入测试依赖`）；
  「Fiber 是什么？」拒答 → **作答**（`fibers#什么是虚拟线程`）；
  「Effect 的错误分哪两类？」拒答 → **作答**（`two-error-types`）。
  仍待继续：Schema / data-types / observability 等章节（220 个官方页面未译）。
- 附带修复：MCP `search_docs` 改用话题路由（与 HTTP 侧一致）；两个浮层关闭后恢复焦点。

**本轮自检结论**（第 2 轮：扩大语料把两个真实缺陷"挤"了出来）：

> 本轮最有价值的事不是加了功能，而是**语料从 10 篇扩到 14 篇后，两条隐藏的检索缺陷暴露了** ——
> 这正是"每轮自检"的目的：小语料会让错误看起来像正确。

- ❌→✅ **中文单字噪声**：中文单字（天/的/气）参与 BM25 打分，导致「今天北京的天气怎么样？」
  在语料变大后蹭到 `layers` 页 9.8 分并被**当成可回答问题**。
  修复：检索只认双字词与标识符，单字仅作极短查询兜底；再加 **idf 加权覆盖率门禁**（默认 0.25，
  仅统计语料里真实存在的查询词）—— 伪命中被挡在门外，真实提问不受影响（12 条 recall@3 全绿）。
- ❌→✅ **章节级话题被漏判**：`schema` 出现在 39 个页面路径里，被判"不够罕见"，
  于是「Schema 是什么？」路由为 `none`，**用 onboarding/devtools 的片段硬答**（最坏的一种错：自信地答错）。
  修复：pending 侧用宽阈值（≤40% 页面），translated 侧保持严阈值；并且 pending 检查不再被严阈值短路。
  实测：「Schema 是什么？」→ 诚实拒答 `untranslated` + 指向 `v4/schema/*`；建议优先 v4（不再先给 v3）。
- ❌→✅ **定义型问题答非所问**：BM25 只认词频，「Fiber 是什么？」引到同页的《Join Fiber》小节。
  修复：新增 `intent.ts` 识别定义意图，检索对"什么是/简介/概述"小节加成分，答案侧再做稳定重排。
  实测：「Fiber 是什么？」→ `v4/concurrency/fibers#什么是虚拟线程`。
- ✅ **检索排序更稳**：查询词命中页面标题/小节名时加成（此前只对英文 API 名生效），
  「为什么选择 Effect 而不是直接用 Promise？」回到头号命中 `why-effect`。
- ✅ **门禁全绿**：`pnpm typecheck` / `pnpm test`（knowledge 40 · content 13 · mcp 12 · api 27）/
  `pnpm build`（245 页）/ 内容门禁 14 篇 0 错误 0 警告 / 语料新鲜度一致 / 锚点端到端 161 个。
  测试同步改为"断言能力"而不是"断言缺陷"：Layer/Fiber 现在断言**必须作答**，
  未翻译拒答改用 Schema/Stream（并新增"章节级话题也能定位"的回归）。

### 本轮追加（第 3 轮：去查"没有后端时它还 AI 吗"）

> 触发问题：我们的默认部署形态是**静态托管**。那 AI 面板在无后端时到底是什么体验？
> 实测结论：它此前只会说"服务不可用" —— AI 是**消失**，不是**降级**。这不算 AI-native。

- ❌→✅ **静态托管下的 AI 降级**：⌘K 搜索此前是"整串子串匹配"（中文自然问句「怎么安装 Effect」
  一条都搜不到），AI 面板在 API 缺失时只显示"服务不可用"。
  修复：把知识层的检索设计下沉到浏览器 —— 新增 `packages/knowledge/src/client-search.ts`
  （中文双字词 + idf 覆盖率门禁 + 标题话题加成），⌘K、`/ask`、`/debug` 共用它；
  无后端时明确标注"未连接问答服务"，给出页面级候选 + 摘录 + 链接。
- ❌→✅ **静态索引里未翻译页压过已翻译页**：「Layer 怎么做依赖注入？」的候选被
  "Managing Layers" / "Layer Memoization" 这些**只有英文标题**的未翻译页占满。
  修复：未翻译条目 ×0.6 + 正文上限 4000 → 12000 字（此前《Layer 与依赖注入》后半部分根本搜不到）。
- ❌→✅ **"顺带提及"被当成依据**（服务端同样存在，客户端先暴露）：
  「推荐一部科幻电影」会引用到正文里的"推荐使用 TypeScript"。
  修复：只命中**一个**正文词且没落在标题/小节名里 ⇒ 拒答。两侧同一规则，均有回归测试。
- ✅ **问题变成可寻址的 URL**：`/ask?q=…` 打开即答、提交时同步地址栏（可分享、可贴 Issue）。
- ✅ **产物级门禁**：`packages/knowledge/scripts/check-static-search.ts` 进 CI ——
  构建产物里的 `/search-index.json` 必须答对 5 个金标问句、且对 2 个无关问句**必须无结果**。
- 实测（真实浏览器 + 静态构建 + 无 API，Playwright headless shell 跑 `/ask?q=`）：
  「怎么安装 Effect？」→《安装》｜「Layer 怎么做依赖注入？」→《管理 Layer》｜
  「Effect 的错误分哪两类？」→《两类错误》｜「推荐一部科幻电影」→ 本地索引无结果。

### 本轮追加（第 4 轮：**"随时有位 Agent 等着"**）

> 用户给的产品意象：*"imagine there always is an AI Agent waiting to answer any question"*。
> 拿这句话当验收标准去查，立刻发现两处硬伤：**它不在场，也不总是在听**。

- ❌→✅ **Agent 不在场**：`AskPanel` 此前只挂在**文档页**和 `/ask`，而页面文案写着"可在任意页面唤起"
  —— 首页、博客、术语表、翻译进度、404 上按 ⌘I 毫无反应。
  修复：改为 `Base` 布局注入（新增 `withAsk` 开关，文档页/`/ask` 传 `false` 以保留各自作用域的面板），
  实测浏览器：`/`、`/glossary/`、`/docs/...`、404 全部有且**只有一个**面板。
- ❌→✅ **没有"在场感"**：新增常驻 `AgentDock`（右下角胶囊）——
  安静、不抢内容（面板一开就让位），显示**真实状态**：`在线`（有后端，可给引用）
  还是 `本地检索`（降级为浏览器内检索）。实测静态构建下四类页面均为"本地检索"（说真话，不装在线）。
- ✅ **随手问**：选中正文里的一段文字 ⇒ 胶囊变成「问这段」，把选中文本带进输入框（只预填、不替你提交）。
- ✅ **空态不再是一句空话**：面板里给出 4 个"试着问"的示例问题，点一下即问。
- ❌→✅ **拒答后沉默**：`no-match` 此前只有一句"去社区提问"。
  现在拒答会附 **`relatedPages`（最接近的站内页面，明确标注"不构成引用"）**。
  实测：「怎么用 Effect 处理大数据量？」→ 拒答 + 官方建议 `caching-effects` / `schema/effect-data-types`
  + 站内最近的 3 页；而「推荐一部科幻电影」→ **related 为空**（不许硬凑）。
- ✅ **Agent 侧同样给下一步**：MCP `ask` 的拒答输出也带上"最接近的站内页面"。
- ✅ 404 页明确写出"直接问 AI（常驻右下角）"，不再只让人自己去搜。

### 本轮追加（第 5 轮：把"审校中"变成"已发布"，并修掉一个**错误拒答**）

> 触发问题：对外话术写着"已具备公开发布条件"，但 14 篇译文的 frontmatter 全是 `status: reviewing`、
> `reviewers: []` —— 页面顶着"审校中"徽章上线。**一个以"同步即信誉"为卖点的站点，
> 状态字段与对外话术必须是同一套事实。**

- ✅ **审校有据，不是走过场**：对 14 篇做了可复核的审校 —— 按各自记录的 `upstreamCommit` 拉取上游原文比对，
  **174/174 个代码块逐字节一致**；标题 / 组件（`Aside`/`Steps`/`Tabs`/`TabItem`）/ 链接数量与上游**全部对齐**；
  术语门禁 0 违规；抽检译文忠实。随后补 `reviewers` 并置 `published`。
- ✅ **新增一篇 Guides，走通完整生命周期**：`v4/error-management/unexpected-errors`（错误管理 3/12），
  译 → 审（同一套代码块/结构校验）→ 发布。语料：15 篇 / 180 切片 / 未译 219。
- ❌→✅ **错误拒答（本轮新暴露的检索缺陷）**：「Effect.orDie 是做什么的？」被判为"中文还没这一页"并拒答，
  可答案就在刚发布的页面里。**这是最坏的一种错：不是答不上来，而是把原因说错了。**
  两个成因：① 库名 `effect` 未进查询停用词，话题归属的宽松阈值把它当成话题词，
  于是问题被路由到 `caching-effects` 等**无关**的未翻译页；② 译文把该小节标题译成中文后，
  页面在"话题归属"里不再认领 `Effect.orDie` 这个 API 名（对比 `## catchDefect` 因保留英文而正常）。
  修复：`effect` 进 `QUERY_STOPWORDS`；小节标题保留 API 名（`…（Effect.orDie）`）。
  实测：`Effect.orDie`、`Effect.die`、「怎么从 defect 中恢复？」均可作答并引用新页；
  而「Schema 是怎么做数据校验的？」仍正确拒答为 `untranslated` —— **没有过度纠正**。
- ✅ **回归固化**：新增 3 条断言（recall@3 金标 +1、错误拒答 ×2），`knowledge` 测试 57 项全绿。

## 8. 建议的第一刀

**Slice 0 + Slice 1 一起做**，理由：这是"可溯源 AI"这一主张的最小完整证明，且 S2/S3/S5 全部复用它的检索、引用、缓存与评测基础设施。具体交付：

1. `KnowledgeContext`：构建期页面切片索引（版本/锚点/commit 随切片）+ 检索端口；
2. `AssistantContext`：`AskPage` 用例 + 引用不变量 + 拒答 + 答案缓存；
3. `AgentGateway`：`/api/ask`（SSE）+ `.md`/`llms-full.txt` 端点；
4. 前端：文档页 `⌘I` 提问面板（引用可点回锚点，显示基线 commit 与落后提示）；
5. CI 评测门禁 + `docs/ai-native.md` 里这套不变量对应的单测。

**北极星指标**：**可验证答率**（答案引用能解析到真实页面+锚点+commit 的比例），而不是"回答了多少问题"。
