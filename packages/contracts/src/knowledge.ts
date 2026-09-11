/**
 * AI 知识层契约（Schema-first）：站点、HTTP、MCP 三方共用。
 *
 * 不变量：`citations` 为空即视为拒答 —— 前端/Agent 都应据此展示"没有依据"而不是"答案"。
 */
import { Schema } from "effect"

export const CitationDto = Schema.Struct({
  /**
   * 规范化引用 ID：`ecn:<slug>@<commit7|unpinned>#<anchor>`。
   * Agent 应把它写进回答（可被独立核验），而不是只贴一个页面链接。
   */
  citationId: Schema.String,
  /**
   * 可解引用的静态地址（`/cite/<digest>.json`），返回当前原文片段、内容指纹、
   * 上游基线与官方原文地址 —— 消费方据此判断引用是否漂移。
   */
  citeUrl: Schema.optional(Schema.String),
  slug: Schema.String,
  version: Schema.String,
  title: Schema.String,
  /** 站内地址，如 /docs/v4/getting-started/layers/ */
  url: Schema.String,
  /** 官方原文地址 */
  officialUrl: Schema.String,
  /** 译文所对照的上游 commit（可缺失） */
  commit: Schema.optional(Schema.String),
  status: Schema.String,
  /** 小节锚点（可缺失） */
  anchor: Schema.optional(Schema.String),
  /** 支撑该结论的原文片段（来自检索结果，非模型生成） */
  quote: Schema.String
})
export type CitationDto = Schema.Schema.Type<typeof CitationDto>

export const RefusalDto = Schema.Struct({
  reason: Schema.Literal("no-match", "untranslated"),
  message: Schema.String,
  suggestions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        slug: Schema.String,
        title: Schema.String,
        officialUrl: Schema.String
      })
    )
  ),
  /** 最接近的站内页面：**不是引用**，只是"下一步看哪里" */
  relatedPages: Schema.optional(
    Schema.Array(
      Schema.Struct({
        slug: Schema.String,
        title: Schema.String,
        url: Schema.String,
        translated: Schema.Boolean
      })
    )
  )
})
export type RefusalDto = Schema.Schema.Type<typeof RefusalDto>

/**
 * 上一轮问答的"可定位摘要"。
 *
 * 刻意**只带能定位的字段**（问题 + 引用了哪一页哪一节），不带上一轮的模型正文：
 * - 指代消解（"它呢？""那 v3 呢？"）只需要知道"刚在聊什么"；
 * - 若把上一轮模型的自由发挥也喂回去，幻觉会**跨轮传染**，而这是引用不变量最怕的事。
 */
export const AskHistoryTurnDto = Schema.Struct({
  question: Schema.NonEmptyString.pipe(Schema.maxLength(500)),
  citations: Schema.Array(
    Schema.Struct({
      slug: Schema.String,
      title: Schema.String,
      anchor: Schema.optional(Schema.String)
    })
  ).pipe(Schema.maxItems(5))
})
export type AskHistoryTurnDto = Schema.Schema.Type<typeof AskHistoryTurnDto>

export const AskRequestDto = Schema.Struct({
  question: Schema.NonEmptyString.pipe(Schema.maxLength(500)),
  /** 限定到某一页（"问这一页"），如 v4/getting-started/installation */
  scope: Schema.optional(Schema.String),
  version: Schema.optional(Schema.Literal("v3", "v4")),
  maxCitations: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 5))),
  /**
   * 多轮对话：最近几轮（最多 3）的"问题 + 引用"。服务端用它做**指代消解**（把追问改写成独立查询），
   * 但每轮仍会重新检索、重新给引用 —— 对话不豁免取证。
   */
  history: Schema.optional(Schema.Array(AskHistoryTurnDto).pipe(Schema.maxItems(3)))
})
export type AskRequestDto = Schema.Schema.Type<typeof AskRequestDto>

export const AskResponseDto = Schema.Struct({
  question: Schema.String,
  /** extractive = 无模型的可溯源合成；llm = 经模型润色（引用仍来自检索） */
  mode: Schema.Literal("extractive", "llm"),
  answer: Schema.String,
  citations: Schema.Array(CitationDto),
  refused: Schema.Boolean,
  refusal: Schema.optional(RefusalDto),
  stalePages: Schema.Array(Schema.Struct({ slug: Schema.String, status: Schema.String })),
  disclaimer: Schema.String,
  /**
   * 本轮**实际送去检索**的问题（仅当它与 `question` 不同才存在）。
   * 追问经过指代消解后会长这样 —— 展示出来是"我听懂成了什么"，也是防胡说的手段。
   */
  resolvedQuestion: Schema.optional(Schema.String),
  /** 本轮用过的术语化改写查询（仅当发生过扩展才存在）：便于人/Agent 复核"它为什么找得到" */
  expandedQueries: Schema.optional(Schema.Array(Schema.String))
})
export type AskResponseDto = Schema.Schema.Type<typeof AskResponseDto>

export const ExplainRequestDto = Schema.Struct({
  /** TypeScript / Effect 报错文本 */
  errorText: Schema.NonEmptyString.pipe(Schema.maxLength(8_000)),
  /** 可选：相关代码片段（有助模型给出更准确的诊断） */
  code: Schema.optional(Schema.String.pipe(Schema.maxLength(8_000)))
})
export type ExplainRequestDto = Schema.Schema.Type<typeof ExplainRequestDto>

export const ExplainResponseDto = Schema.Struct({
  /** 从报错里提取出的 API / 类型 / 错误码（检索锚点） */
  identifiers: Schema.Array(Schema.String),
  mode: Schema.Literal("extractive", "llm"),
  answer: Schema.String,
  citations: Schema.Array(CitationDto),
  refused: Schema.Boolean,
  refusal: Schema.optional(RefusalDto),
  disclaimer: Schema.String
})
export type ExplainResponseDto = Schema.Schema.Type<typeof ExplainResponseDto>

export const KnowledgeStatsDto = Schema.Struct({
  pages: Schema.Number,
  chunks: Schema.Number,
  pendingPages: Schema.Number,
  /** 可解引用的引用记录数（= 带锚点的小节数）—— Agent 据此判断"有多少可核验证据" */
  citations: Schema.Number,
  upstreamHead: Schema.NullOr(Schema.String),
  glossaryTerms: Schema.Number,
  /** 是否配置了模型（未配置时为 extractive 模式） */
  llmEnabled: Schema.Boolean,
  /** 已启用的模型名（如 deepseek-chat）；extractive 模式下缺省 */
  llmModel: Schema.optional(Schema.String),
  generatedAt: Schema.String
})
export type KnowledgeStatsDto = Schema.Schema.Type<typeof KnowledgeStatsDto>
