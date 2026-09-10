/**
 * Assistant 上下文 · 端口：术语表（社区共识）
 *
 * AI 输出和译文受同一套术语约束 —— 这是"社区术语不是建议而是门禁"的落点。
 * 数据源：仓库根 `docs/glossary.json`（与内容门禁共用同一份）。
 */
import { Context } from "effect"

export interface GlossaryService {
  /** 禁用译法（命中即视为不合规） */
  readonly forbidden: ReadonlyArray<string>
  /** 术语条数（用于 /stats 展示） */
  readonly termCount: number
  /** 数据来源路径（便于排查；内置兜底时为 "builtin"） */
  readonly source: string
}

export const Glossary = Context.GenericTag<GlossaryService>("assistant/Glossary")
