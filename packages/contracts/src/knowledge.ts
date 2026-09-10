/**
 * AI 知识层契约（Schema-first）：站点、HTTP、MCP 三方共用。
 *
 * 不变量：`citations` 为空即视为拒答 —— 前端/Agent 都应据此展示"没有依据"而不是"答案"。
 */
import { Schema } from "effect"

export const CitationDto = Schema.Struct({
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

export const AskRequestDto = Schema.Struct({
  question: Schema.NonEmptyString.pipe(Schema.maxLength(500)),
  /** 限定到某一页（"问这一页"），如 v4/getting-started/installation */
  scope: Schema.optional(Schema.String),
  version: Schema.optional(Schema.Literal("v3", "v4")),
  maxCitations: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 5)))
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
  disclaimer: Schema.String
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
  upstreamHead: Schema.NullOr(Schema.String),
  glossaryTerms: Schema.Number,
  /** 是否配置了模型（未配置时为 extractive 模式） */
  llmEnabled: Schema.Boolean,
  /** 已启用的模型名（如 deepseek-chat）；extractive 模式下缺省 */
  llmModel: Schema.optional(Schema.String),
  generatedAt: Schema.String
})
export type KnowledgeStatsDto = Schema.Schema.Type<typeof KnowledgeStatsDto>
