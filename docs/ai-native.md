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
**形态**：从公开来源（GitHub Issues、掘金 / 知乎等中文平台的公开问答，均须获授权）聚类真实问题 → Agent 依文档起草答案 → 维护者审核 → 落地为文档页底部的「社区常问」与独立 FAQ。
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
5. **内容合规** —— 只用 MIT 文档 + 获授权的公开来源；用户提交需附贡献许可；私密群聊（如微信群）与未授权频道的内容一律不采。

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
| **引用可独立核验**（`citationId` + `/cite/<digest>.json` + 内容指纹 + 漂移检测） | ✅ 已上线 | `packages/knowledge/src/citation.ts`、`packages/content/src/citation.ts` |
| 引用索引（Agent 无需先提问即可发现证据） | ✅ 已上线 | `/cite/index.json`、MCP 资源 `effect-cn://citations` |
| MCP Server（stdio，离线自包含） | ✅ 已上线 | `apps/mcp`（`pnpm mcp`） |
| MCP resources / prompts（可订阅语料 + 工作流指令） | ✅ 已上线 | `apps/mcp/src/server.ts` |
| **Agent 起草 + 人审的提案队列**（`.proposals/`，套用同一道门禁） | ✅ 已上线（译文 / 落后页更新；FAQ、练习题待接） | `packages/content/src/proposals.ts`、`.proposals/README.md` |
| 仓库对 Agent 可执行（架构不变量 / 门禁 / 边界） | ✅ 已上线 | `AGENTS.md` |
| 模型润色（DeepSeek 预设 / 任意 OpenAI 兼容，失败自动回退 extractive） | ✅ 已实现（`DEEPSEEK_API_KEY` 一条配置即可；`pnpm llm:check` 可验证） | `apps/api` `LlmLive`、`provider-config.ts` |
| 站内 UI（⌘I「问这一页」、/ask 页） | ✅ 已上线 | `apps/site` AskPanel |
| 选区即问（选中正文 ⇒ 小效跑到选区旁问一句，带 `slug#anchor`） | ✅ 切片 A 已上线（讲讲 / 换个问法 / 反打扰；切片 B 接 `selection` 契约） | `apps/site/src/scripts/selection.ts`、`components/SelectionAgent.astro` |
| **多轮会话**（`history` + 指代消解 + `resolvedQuestion`）：面板是时间线而不是搜索框 | ✅ 已上线（配模型时按 `history` 改写查询；无模型时退化为单轮） | `packages/contracts/src/knowledge.ts`、`apps/api` AskQuestion、`apps/site` AskPanel |
| **术语化扩展 + RRF 融合**（白话 → 术语，补词法检索够不着的那一段） | ✅ 已上线（第一次检索偏弱才触发，一次为限） | `packages/knowledge/src/fusion.ts`、`apps/api` `expandQueries` |
| **候选重排**（只换顺序，不增删引用） | ✅ 已上线（先去重定版本代表，再重排） | `apps/api` `rerank`、`packages/knowledge` `applyOrder` |
| **语义检索（向量 / hybrid）** | ⏳ 未实现（③A 已补白话召回；长句与同义改写仍靠词法） | 见 §3 S3 与第 7 轮记录 |
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
| 6 | 产品把它讲出来了吗？ | 首页/导航/文档能发现它；搜索与问答不互为孤岛；**有一个能被叫住名字的吉祥物**（小效）常驻每个页面 |
| 7 | 输出干净吗？ | 不重复、不啰嗦（例如 quote 只出现一次，对 Agent 省 token） |
| 8 | 有反馈回路吗？ | 用户能低成本报告"答案不对/引用过期" |
| 9 | 知识够深吗？ | 高频问题不能只能答"中文还没翻译" |
| 10 | **没有后端时它还能用吗？** | 静态托管（我们的默认形态）下 AI 必须**降级**而不是消失：⌘K 与 `/ask`、`/debug` 退化为浏览器内检索，并明确标注"未连接问答服务" |
| 11 | **产物本身被门禁验过吗？** | 构建产物（`/search-index.json`、锚点）必须进 CI：答对金标问句、对无关问句必须无结果、引用锚点必须点得到 |
| 12 | **它一直在场吗？** | 每个页面都能唤起（不是只有文档页）；状态诚实（在线 / 本地）；选中文字可直接问；拒答也给下一步 |
| 13 | **读得完吗？** | 正文与代码在常见窗口宽度（1161 / 1440 / 1920）下必须**不用横向拖动就能读**；确实放不下的长行要有显式提示与「换行」开关（见第 8 轮实测） |

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

### 吉祥物「小效」：让"永远在场的 Agent"有个能被记住的脸

> 起因：右下角原本是一个「问 AI 在线 ⌘I」的胶囊 —— 功能清楚，但**不像有人在那儿**，
> 很容易被当成又一个工具按钮划过去。站点需要一个能被叫住名字的形象。

- **形象**：一只猫，名叫**小效**。选猫不是随手挑的：Effect 的并发原语叫 **Fiber**（轻量、可成千上万），
  而"猫有九条命"是最容易被中文读者记住的类比；项圈挂着 Effect 徽记，左眼上一块紫色斑块呼应站点主色。
- **它在哪**：右下角常驻（每个页面）· 首页 AI 区块的自我介绍 · 404（"小效也没找到这一页"）·
  问答面板头部（面板会盖住页面，所以吉祥物必须也在面板里出场）。
- **表情即状态**（比小圆点更好读）：在线 → 眯眼微笑；降级为本地检索 → 睁大眼睛；
  选中一段文字 → 歪头"竖起耳朵"，文案变成「问这段」。
- **显眼但安静**：轻微呼吸（5.4s）+ 每 6.8s 一次眨眼；每个会话**只**冒一次招呼气泡
  （"有问题随时问我，答案都带引用喵～"，8 秒后自动收起），之后不再打扰。
- **可访问性**：外层是真正的 `<button>`（天然键盘可达）+ `aria-label` / `aria-haspopup="dialog"`；
  吉祥物 SVG 是 `aria-hidden`（纯装饰，语义由按钮提供）；**无 JS 时气泡保持隐藏**；
  `prefers-reduced-motion: reduce` 下呼吸、眨眼、气泡动画全部关闭。
- **实现**：`apps/site/src/components/Mascot.astro`（内联 SVG，零外部请求、跟随深浅色主题、
  clipPath id 每实例唯一）+ `AgentDock.astro`（状态与交互）。

### 本轮追加（第 6 轮：**"选中即讲" —— 让猫跑到你选中的那段旁边**）

> 触发问题：右下角的胶囊解决的是"**随时能问**"，但没解决"**问什么**"。
> 读到一段卡住时，最自然的动作是**选中它**，而让视线从正文跑到屏幕角落、再想措辞，正是学习节奏断掉的地方。
> 产品意象：*选中一段，小效跑过来问"要我讲讲这段吗？"*。

**这一轮立下的不变量**：**选区不是"给模型的自由文本"，选区是一个引用锚点。**
`/cite/<digest>.json` 的地址只由 `(slug, anchor)` 决定（`packages/knowledge/src/citation.ts`），
所以"讲这段"可以被机械地钉回 `v4/...#anchor@commit`，进而解引用核验 —— 知识仍然只来自站内语料，
不需要（也不应该）把选中的一段丢给外部服务。

- ✅ **共享选区口径**：新增 `apps/site/src/scripts/selection.ts` —— 快照含 `text / slug / version / commit /
  anchor / kind / 末行 rect / Range`；`AgentDock` 与新的 `SelectionAgent` **共用同一份监听与判定**，
  不再各写一套。顺带修掉两个老问题：① 文档页侧栏 `aside` 就在 `main` 里面，
  只判 `closest("main")` 会把"选中侧栏文字"当成正文；② 点胶囊会让浏览器先清掉选区，
  于是"选中 → 点胶囊"偶发拿不到文本（现在留 5 秒内的快照兜底）。
- ✅ **锚点解析**：选区起点之前最近的带 `id` 标题；落在页首导言时退回 `intro`
  （与 `packages/content` 的 `PAGE_LEAD_ANCHOR` 同源）。`<html data-doc-slug|version|commit>` 由
  `Base.astro` 暴露（文档页从 `[...slug].astro` 传入）。
- ✅ **跑过去 + 一问**：`SelectionAgent.astro` 用 FLIP 位移（从右下角猫的原位动画到选区旁），
  文案随选区变化（代码块 →"要小效解释这段代码吗？"），气泡里带 `slug#anchor` 让人看见"这段是可定位的"；
  三个动作：**讲讲**（把选中文本当问题提交）/ **换个问法**（只预填）/ **不用**。**绝不自动提交。**
- ✅ **反打扰（决定生死的那部分）**：同一段每会话只问一次；每页最多主动问 3 次；
  点过「不用」的段落整场会话不再提；`localStorage["ecn:selection-agent:quiet"]="1"` 可全局关掉，
  之后只保留被动的「问这段」；面板打开时不打扰；选区滚出视口即收起且**不记账**（没显示出来的打扰不算数）。
- ✅ **无障碍**：气泡挂在 `role="status" aria-live="polite"` 的文案上、按钮是真 `<button>`；
  鼠标选中**不抢焦点**（点气泡用 `mousedown` preventDefault 保住选区），键盘选中才把焦点交给「讲讲」；
  `prefers-reduced-motion` 下不做位移，只淡入。
- ✅ **实测证据**（静态构建 + 无 API，Playwright headless，`python3 -m http.server` 托管 `dist`）：
  | 行为 | 实测 |
  | --- | --- |
  | 正文选中 ⇒ 气泡 | 出现，锚点 `v4/getting-started/installation#intro`，位置在选区末行右下（x 887 / y 473） |
  | 标题下的选中 ⇒ 锚点 | `#javascript-运行时`（不是 `#intro`） |
  | 代码块选中 ⇒ 文案 | "要小效解释这段代码吗？" |
  | 真实鼠标拖选 | 气泡出现且 `slug#anchor` 正确 |
  | 「讲讲」 | 面板打开、输入框=选中文本；无 API 时诚实降级为本地检索（"问答服务未连接…"） |
  | 「换个问法」 | 只预填，**不发任何请求**（面板仍是初始提示） |
  | 同一段重复选中 | 不重复打扰（`count` 不增） |
  | 「不用」 | 记入 `dismissed`，再选同段不再出现 |
  | 每页上限 | 3 次之后安静（第 4 段不再冒泡） |
  | 选区滚出视口 | 气泡收起；滚回来重选同一段仍不打扰 |
  | `Esc` / 面板打开 | 收起 / 不打扰 |
  | 键盘选中（合成 keyup） | 气泡出现且焦点落到「讲讲」 |
  | `prefers-reduced-motion` | 无 FLIP 位移（inline transform 为空），直接淡入 |

  同一轮跑通 `pnpm content:check`（234 篇 · 0 错误 0 警告）/ `pnpm typecheck`（0 error）/ `pnpm test`
  （knowledge 80 · mcp 24 · api 59+4 skipped · content 93）/ `pnpm build`（245 页）。

- ⏳ **切片 B 待做**：把 `selection`（`slug/anchor/version/commit/text≤2000`）进 `packages/contracts` 的
  `AskRequestDto`，让"讲讲"变成**真正的问句 + 随行的锚点**（现在是拿选中文本本身当查询，
  并且受 `question` 的 500 字上限约束，所以选区上限暂时压在 300）；
  切片 C 再做追问线程与"相关小节/页面/术语/版本对照"的扩展面。

### 本轮追加（第 7 轮：**从"搜索框"变成"会话" —— 以及补上词法检索够不着的那一段**）

> 触发问题（用户实测观察）：*"小效接收到消息后似乎只是在文档里做关键词检索（甚至不是语义的），
> 也没有进入 AI LLM 的对话交互。"* —— 三句话全都成立，而且是三件不同的事：

| 观察 | 事实核查 | 性质 |
| --- | --- | --- |
| 没有 LLM 参与 | `GET /api/knowledge/stats → llmEnabled: false`；仓库里连 `.env` 都没有 | **配置**（一条 Key） |
| 只是关键词检索 | BM25F-lite（中文双字词 + idf 覆盖率门禁 + 话题归属），无向量 | **能力** |
| 不是对话 | 契约只有 `question`；模型角色被钉死成"把 3 段证据润色成 1–4 句" | **架构** |

**先量了病，再开药**（同一颗问题、同一份语料，实测）：

| 问题 | 纯词法检索 |
| --- | --- |
| 「怎么让两件事同时跑？」 | **拒答**（文档里明明有《Fiber》《基础并发》） |
| 「我这个报错老是修不掉怎么办」 | **拒答** |
| 「Effect 的错误分两类吗」 | 命中《两类错误》 |
| 「什么是 Fiber」 | 命中《Fiber › 什么是虚拟线程》 |

**术语对得上就查得到，换成白话就查不到** —— 这才是"像不像 AI"的第一道坎，比"要不要向量"更急。

**本轮做的事（② 会话层 + ③A 检索升级，零新基础设施）：**

- ✅ **多轮会话**：契约加 `history`（最近 3 轮的"问题 + 引用了哪一页哪一节"，**刻意不含上一轮的模型正文** ——
  否则幻觉会跨轮传染）；服务端先做**指代消解**再检索，并把 `resolvedQuestion` 回传，
  让人一眼看见"它把这句理解成什么"。缓存键含 history：追问与首问即便字面相同也不共用条目。
- ✅ **术语化扩展 + RRF 融合**（`packages/knowledge/src/fusion.ts`）：第一次检索偏弱时，
  让模型把白话改写成 2–4 条"文档会用的说法"，各自检索后按 Reciprocal Rank Fusion 并成一路。
  融合后**保留最强的 BM25 分**而不是 RRF 分 —— 否则 `minScore` 门禁会把所有命中判成"弱"。
- ✅ **候选重排**：模型拿到候选片段，只返回**下标顺序**。增删引用在结构上不可能。
- ✅ **模型能力的四条边界**（写进 `LlmService` 端口与测试）：改写**查询** / 扩展**查询** /
  重排**候选顺序** / 合成**文字**；任何一步失败、超时、返回垃圾，都只是"这一步不做"。
- ✅ **面板变成会话**：`AskPanel` 从"清空重渲染"改成时间线（谁问的、它理解成什么、答案、引用、报告），
  输入框移到面板底部、线程自己滚，"新对话"一键清空。
- ✅ **一个被测试逼出来的真缺陷**：重排模型**看不到版本**（候选里只有标题/锚点/正文）。
  原先"先重排、再去重"会让同一次检索的引用在 `v4` / `v3` 之间漂移（写测试时真的踩到了）。
  修复：assistant 层**先 `dedupeHits` 定下版本代表，再重排**；并留下回归断言"重排不会把引用带到旧版本"。

**实测证据**（静态构建 + 假 OpenAI 兼容服务，走真实 HTTP 链路，不需要真 Key）：

| 场景 | 结果 |
| --- | --- |
| 「怎么让两件事同时跑？」（无 Key） | 拒答（行为不变） |
| 同上（配模型） | `mode: llm`、`expandedQueries: ["Fiber 并发","同时执行两个 Effect","并发基础"]`、引用《Fiber》#join-fiber / 《基础并发》#raceall |
| 「它怎么装？」+ history | `resolvedQuestion: "怎么安装 Effect？"`，引用落到 installation 页；LLM 调用序列 = 改写 → 重排 → 合成 |
| 真实浏览器（面板） | 两轮对话：模式显示"模型润色（fake-chat）"，第二轮出现"小效把这句理解成：怎么安装 Effect？"，引用带锚点与基线 |

- ✅ 门禁：`pnpm content:check` / `typecheck` / `test`（knowledge 90 · mcp 24 · api 80+4 skipped · content 93）/ `build`（245 页）全绿；
  新增测试 `packages/knowledge/test/fusion.test.ts`、`apps/api/test/assistant/ask-conversation.test.ts`、
  `apps/api/test/assistant/llm-capabilities.test.ts`。
- ⏳ 还没做：**语义检索（B 路线）** —— `③A` 解决的是"换个说法就拒答"，向量解决的是长句与同义改写。
  语料只有 2704 片，一次性 embedding 很便宜；`384` 维索引（≈4MB）甚至能进静态站，
  让**无后端时也能语义检索**（符合本站"降级而不是消失"的口径）。见 §3 S3 与 §6 路线。

### 本轮追加（第 8 轮：**"读得完吗？" —— 窗口宽度与代码块的可见性**）

> 触发问题（用户实测）：*"默认情况下页面内容没有适配浏览器窗口宽度，中间文本显示不全，尤其是代码框根本看不完整，还得左右滑动。"*
> 这条不属于 §7.6 清单里任何一项 —— 于是补上第 13 项自检：**正文与代码在当前窗口下读得完吗？**

**先量，再改**（真实浏览器，`getBoundingClientRect` + `scrollWidth`）：

| 视口 | 正文列宽 | generators 页最宽代码 | 结果 |
| --- | --- | --- | --- |
| 1161（用户截图宽度） | **536px** | 734px | 每块代码都截掉 1/4，只能横向滚 |
| 1440 | **536px** | 734px | 大屏白白浪费 400px，代码照样截 |

根因两条，都在 CSS：

1. `.container { max-width: 1080px }` —— 三栏（224/240 + 目录 + 间隙）吃掉 504px，正文列只剩 536px，**窗口再宽也不会变宽**；
2. `max-width: 72ch` 加在 `.prose` 上 —— 本意是限制**正文行长**，实际上把**代码块**也一起压到 72ch。

**改法（把"可读行长"与"代码可用宽度"解耦）：**

- **容器宽度做成整页属性**：`--container-max` 默认 1080px，文档页（`<body data-wide="1">`）放宽到 **1320px**。
  关键是**页头一起变宽** —— 页头与正文各自居中、宽度却不同的话，
  导航左边缘会和侧栏错开、右边缘会和「本页目录」错开，视觉上就是"排版坏了"（第一版只给正文加宽，正是踩了这个坑）；
- **1320 是量出来的**：文档页三栏固定吃掉 516px，正文列 = 容器宽 − 516；本站最宽代码 734px ⇒ 容器 ≥ 1280，1320 留余量；
- `.prose` 在文档页不再设上限，**72ch 改由元素级规则管**（`p/li/h*/blockquote…`）—— 文字仍然一行 ~72 字符，`pre`/`table` 吃满整列；
- 侧栏与「本页目录」各让出 ~16px；`≤1280px` 收起「本页目录」（它只是辅助信息，代码不是）；
- **代码块溢出时给两个出路**：`↔ 可横向滚动` 显式提示（macOS 覆盖式滚动条不滚动就不显示，用户分不清"被截断"和"能滚"）、右缘 inset 阴影、以及一键「换行」（整页生效、偏好写 localStorage）。

**实测（改后，6 个代表页共 127 个代码块）：**

| 视口 | 正文列 | 仍溢出的代码块 | 页面级横向滚动 |
| --- | --- | --- | --- |
| 1161 | 536 → **889** | 127 块里 **2** 块（`layers` 页 120+ 字符的连接串，给出提示 + 换行开关；开启后 0 块） | 无 |
| 1440 | 536 → **804**（保留本页目录） | 同上 2 块 | 无 |
| 360 / 390 / 640 / 900 / 1024 / 1280 / 1920 | — | — | 无（顺手修掉 390px 下翻页链接把整页顶宽 30px 的老问题） |
| 1440 `/about/` | 726（72ch，未受影响） | — | 无 |

**对齐实测**（同一页同时量页头容器与正文容器，`getBoundingClientRect`）：

| 视口 | 页头容器 | 正文容器 | 品牌左缘 = 侧栏左缘 | 导航右缘 = 目录右缘 |
| --- | --- | --- | --- | --- |
| 1920 | 300..1620 | 300..1620 | ✅ | ✅ |
| 1440 | 60..1380 | 60..1380 | ✅ | ✅ |
| 1320 / 1281 | 0..视口宽 | 0..视口宽 | ✅ | ✅（目录可见） |
| 1161 / 1024 | 0..视口宽 | 0..视口宽 | ✅ | —（目录已收起） |
| 首页 / 博客 / 术语表 / 文档索引 | 1080 | 1080 | 不变 | 不变 |

> 这一轮也是"用户报了体验问题 → 先量出数字 → 再改 → 用数字回答"的一次演练：
> 没有"感觉好多了"，只有"536 → 889，127 块里 2 块仍溢出且都有出路"，
> 以及"页头与正文容器 4 个视口全部重合"。

## 8. 建议的第一刀

**Slice 0 + Slice 1 一起做**，理由：这是"可溯源 AI"这一主张的最小完整证明，且 S2/S3/S5 全部复用它的检索、引用、缓存与评测基础设施。具体交付：

1. `KnowledgeContext`：构建期页面切片索引（版本/锚点/commit 随切片）+ 检索端口；
2. `AssistantContext`：`AskPage` 用例 + 引用不变量 + 拒答 + 答案缓存；
3. `AgentGateway`：`/api/ask`（SSE）+ `.md`/`llms-full.txt` 端点；
4. 前端：文档页 `⌘I` 提问面板（引用可点回锚点，显示基线 commit 与落后提示）；
5. CI 评测门禁 + `docs/ai-native.md` 里这套不变量对应的单测。

**北极星指标**：**可验证答率**（答案引用能解析到真实页面+锚点+commit 的比例），而不是"回答了多少问题"。
