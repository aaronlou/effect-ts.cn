/**
 * 知识层的数据模型。
 *
 * 设计要点（对应 docs/ai-native.md 的"可溯源即可信"）：
 * - 语料单位是"页面切片"（chunk），而不是整页：便于精确引用到小节；
 * - 每个切片都带 page 的 slug/version/commit/status，因此答案可以标注
 *   "依据：<页面>@<commit>#<锚点>"，并提示该页是否落后上游；
 * - 未翻译页面单独建索引（untranslated），这样"中文还没有"本身也是一个可回答的结论，
 *   而不是让模型硬编。
 */

/** 语料切片 */
export interface CorpusChunk {
  /** 稳定 id：`<slug>#<index>`（页面内序号） */
  readonly id: string
  readonly slug: string
  readonly version: string
  readonly pageTitle: string
  /** 标题路径，如 ["构建管道", "pipe"] */
  readonly headingPath: ReadonlyArray<string>
  /** 该小节在站内的真实锚点（从构建产物中提取，可能缺失） */
  readonly anchor?: string
  /** 用于检索的纯文本（含行内代码，去掉了 Markdown 标记） */
  readonly text: string
  /** 是否包含代码示例 */
  readonly hasCode: boolean
}

/** 已翻译页面 */
export interface CorpusPage {
  readonly slug: string
  readonly version: string
  readonly title: string
  readonly description?: string
  /** 官方侧边栏中的章节名（如「从这里开始」/「快速上手」），用于意图类查询 */
  readonly sectionLabel?: string
  readonly status: string
  readonly upstreamPath?: string
  readonly upstreamCommit?: string
  /** 站内地址（含末尾斜杠） */
  readonly url: string
  readonly officialUrl: string
  /** 原始 Markdown 正文（供 MCP / llms 场景离线使用；不参与检索） */
  readonly markdown: string
  readonly chunks: ReadonlyArray<CorpusChunk>
}

/** 未翻译（或尚未入库）的官方页面 */
export interface CorpusPendingPage {
  readonly slug: string
  readonly version: string
  readonly title: string
  readonly sectionLabel: string
  readonly upstreamPath: string
  readonly officialUrl: string
}

export interface CorpusStats {
  readonly pages: number
  readonly chunks: number
  readonly pendingPages: number
  readonly upstreamHead: string | null
}

export interface Corpus {
  readonly generatedAt: string
  readonly upstream: {
    readonly repo: string
    readonly dir: string
    readonly head: string | null
    readonly snapshotFiles: number
  }
  readonly pages: ReadonlyArray<CorpusPage>
  readonly pending: ReadonlyArray<CorpusPendingPage>
  readonly stats: CorpusStats
}

/** 引用（答案的唯一"证据"形态） */
export interface Citation {
  readonly slug: string
  readonly version: string
  readonly title: string
  readonly url: string
  readonly officialUrl: string
  readonly commit?: string
  readonly status: string
  readonly anchor?: string
  /** 支撑该结论的原文片段（来自检索结果，非模型生成） */
  readonly quote: string
}

export type RefusalReason = "no-match" | "untranslated"

export interface Refusal {
  readonly reason: RefusalReason
  readonly message: string
  /** 未翻译场景下给出的"改读哪里"建议 */
  readonly suggestions?: ReadonlyArray<{
    readonly slug: string
    readonly title: string
    readonly officialUrl: string
  }>
  /**
   * 最接近的站内页面（**不构成引用**）。
   * 用途：拒答也要给出"下一步" —— 一个永远在场的 Agent 不能只说"我不知道"然后沉默。
   * 它来自检索到的弱相关页面，所以 UI 必须与 citations 明显区分。
   */
  readonly relatedPages?: ReadonlyArray<{
    readonly slug: string
    readonly title: string
    readonly url: string
    readonly translated: boolean
  }>
}

export type AnswerMode = "extractive" | "llm"

/** 问答结果：citations 为空即视为拒答 */
export interface AskResult {
  readonly question: string
  readonly mode: AnswerMode
  readonly answer: string
  readonly citations: ReadonlyArray<Citation>
  readonly refused: boolean
  readonly refusal?: Refusal
  /** 命中的页面中，落后上游的（用于 UI 提示"答案基于旧基线"） */
  readonly stalePages: ReadonlyArray<{ readonly slug: string; readonly status: string }>
  /** 免责声明：避免用户把检索合成当作权威结论 */
  readonly disclaimer: string
}
