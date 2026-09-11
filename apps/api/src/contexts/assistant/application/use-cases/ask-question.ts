/**
 * Assistant 上下文 · 应用用例：AskQuestion
 *
 * 固定流程（顺序即不变量）：
 *   指代消解 → 检索（弱则术语化扩展 + RRF 融合）→ 模型重排（只换顺序）
 *   → 引用/拒答 → （可选）模型合成 → 术语门禁 → 缓存 → DTO
 *
 * 关键点：
 * - **拒答直接短路**，不会进入合成模型（不给出"没有依据的流畅答案"）；
 * - 模型能做的只有四件事：改写**查询**、扩展**查询**、重排**候选顺序**、把证据写成中文；
 *   它**拿不到**"新增引用"或"改引用"的能力 —— citations 永远由检索层构造；
 * - 每一步模型调用失败/超时都只是"这一步不做"，绝不变成"问答不可用"；
 * - 未配置模型时整条链退化成单轮 extractive（零 Key 可跑、CI 不需要 Key）；
 * - 缓存键含 history：追问与首问即便字面相同也不共用条目。
 */
import { Effect } from "effect"
import type { AskHistoryTurnDto, AskRequestDto, AskResponseDto } from "@ecn/contracts"
import { applyOrder, dedupeHits, type Citation, type SearchHit } from "@ecn/knowledge"
import {
  KnowledgeBase,
  type KnowledgeBaseService
} from "../../../knowledge/domain/ports/knowledge-base"
import { AnswerCache, type AnswerCacheService } from "../ports/answer-cache"
import { Glossary, type GlossaryService } from "../ports/glossary"
import { Llm, type AskHistoryTurn, type LlmService } from "../ports/llm"

/** 送去重排的候选窗口：再往后的命中几乎不可能进最终引用，不值得花 token */
const RERANK_WINDOW = 5

/** 每条候选给模型看的正文长度（重排只需要判断"讲的是不是这件事"） */
const RERANK_TEXT_LIMIT = 300

export function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ")
}

export function containsForbiddenTerm(text: string, forbidden: ReadonlyArray<string>): string | undefined {
  for (const term of forbidden) {
    if (term.length > 0 && text.includes(term)) return term
  }
  return undefined
}

/** 历史摘要：只取"问题 + 引用了哪一页哪一节"，用于缓存键与指代消解 */
export function historyFingerprint(history: ReadonlyArray<AskHistoryTurnDto> | undefined): string {
  if (history === undefined || history.length === 0) return "no-history"
  return history
    .map((turn) => {
      const where = turn.citations
        .map((citation) => `${citation.slug}#${citation.anchor ?? ""}`)
        .join(",")
      return `${normalizeQuestion(turn.question)}@${where}`
    })
    .join(">")
}

export function cacheKey(request: AskRequestDto, model: string): string {
  return [
    model,
    request.version ?? "any",
    request.scope ?? "global",
    String(request.maxCitations ?? 3),
    normalizeQuestion(request.question),
    historyFingerprint(request.history)
  ].join("|")
}

/** 契约里的历史与领域层同形，这里做一次显式转换（不让 DTO 类型渗进端口） */
function toDomainHistory(
  history: ReadonlyArray<AskHistoryTurnDto> | undefined
): ReadonlyArray<AskHistoryTurn> {
  if (history === undefined) return []
  return history.map((turn) => ({
    question: turn.question,
    citations: turn.citations.map((citation) => ({
      slug: citation.slug,
      title: citation.title,
      ...(citation.anchor !== undefined ? { anchor: citation.anchor } : {})
    }))
  }))
}

function toRerankCandidate(hit: SearchHit): { title: string; anchor?: string; text: string } {
  return {
    title: hit.page.title,
    ...(hit.chunk.anchor !== undefined ? { anchor: hit.chunk.anchor } : {}),
    text: hit.chunk.text.slice(0, RERANK_TEXT_LIMIT)
  }
}

export const askQuestion = (
  request: AskRequestDto
): Effect.Effect<
  AskResponseDto,
  never,
  KnowledgeBaseService | LlmService | AnswerCacheService | GlossaryService
> =>
  Effect.gen(function* () {
    const knowledge = yield* KnowledgeBase
    const llm = yield* Llm
    const cache = yield* AnswerCache
    const glossary = yield* Glossary

    const key = cacheKey(request, llm.enabled ? llm.model : "extractive")

    return yield* cache.getOrCompute(
      key,
      Effect.gen(function* () {
        const history = toDomainHistory(request.history)
        const askOptions = {
          ...(request.scope !== undefined ? { scope: request.scope } : {}),
          ...(request.version !== undefined ? { version: request.version } : {}),
          ...(request.maxCitations !== undefined ? { maxCitations: request.maxCitations } : {})
        }
        const composeOptions =
          request.maxCitations !== undefined ? { maxCitations: request.maxCitations } : {}

        // ── 1) 指代消解：有历史 + 有模型才做；改写失败就用原问题 ──
        const rewrite = llm.rewriteQuery
        const rewritten =
          llm.enabled && history.length > 0 && rewrite !== undefined
            ? yield* rewrite({ question: request.question, history })
            : undefined
        const resolved =
          rewritten !== undefined && rewritten.trim() !== "" && rewritten.trim() !== request.question
            ? rewritten.trim()
            : request.question

        // ── 2) 第一次检索 + 组装（组装是纯函数，用它判断"这次检索够不够强"）──
        let hits = yield* knowledge.candidates(resolved, askOptions)
        let probe = yield* knowledge.composeFrom(resolved, hits, composeOptions)

        // ── 3) 偏弱 ⇒ 术语化扩展 + RRF 融合再取一次（一次为限）──
        // "中文还没这一页"是话题路由器给的判断，扩展查询救不了它，跳过省一次调用。
        const expand = llm.expandQueries
        let expandedQueries: ReadonlyArray<string> = []
        const weak = probe.refused || probe.citations.length < 2
        if (weak && llm.enabled && expand !== undefined && probe.refusal?.reason !== "untranslated") {
          const queries = yield* expand({ question: resolved, history })
          const usable = (queries ?? [])
            .map((query) => query.trim())
            .filter((query) => query !== "" && query !== resolved)
            .slice(0, 4)
          if (usable.length > 0) {
            expandedQueries = usable
            hits = yield* knowledge.candidates(resolved, { ...askOptions, altQueries: usable })
            probe = yield* knowledge.composeFrom(resolved, hits, composeOptions)
          }
        }

        // ── 4) 重排：只调顺序，不增删候选 ──
        // 先把"每个逻辑小节由哪个版本代表"定下来（v3/v4 是同一篇文档的两个版本）：
        // 重排模型看不到版本，若先重排再去重，引用会在 v3/v4 之间随机漂移。
        const rerank = llm.rerank
        if (llm.enabled && rerank !== undefined && hits.length > 1) {
          const ordered = dedupeHits(hits)
          const window = Math.min(RERANK_WINDOW, ordered.length)
          const order = yield* rerank({
            question: resolved,
            candidates: ordered.slice(0, window).map(toRerankCandidate)
          })
          hits = order !== undefined ? applyOrder(ordered, order, window) : ordered
        }

        // ── 5) 用最终顺序组装答案（引用构造与拒答判定的唯一入口）──
        const result = yield* knowledge.composeFrom(resolved, hits, composeOptions)
        const resolvedField = resolved !== request.question ? { resolvedQuestion: resolved } : {}
        const expandedField = expandedQueries.length > 0 ? { expandedQueries } : {}

        if (result.refused) {
          return {
            question: result.question,
            mode: "extractive" as const,
            answer: "",
            citations: [],
            refused: true,
            ...(result.refusal !== undefined ? { refusal: result.refusal } : {}),
            stalePages: [],
            disclaimer: result.disclaimer,
            ...resolvedField,
            ...expandedField
          } satisfies AskResponseDto
        }

        const citations: ReadonlyArray<Citation> = result.citations
        let answer = result.answer
        let mode: "extractive" | "llm" = "extractive"

        if (llm.enabled) {
          const polished = yield* llm.composeAnswer({
            question: resolved,
            citations,
            fallback: result.answer,
            forbiddenTerms: glossary.forbidden,
            ...(history.length > 0 ? { history } : {})
          })
          if (polished !== undefined && polished.trim() !== "") {
            const violation = containsForbiddenTerm(polished, glossary.forbidden)
            if (violation === undefined) {
              answer = polished
              mode = "llm"
            } else {
              yield* Effect.logWarning(
                `模型输出违反术语门禁（命中「${violation}」）→ 回退 extractive`
              )
            }
          }
        }

        return {
          question: result.question,
          mode,
          answer,
          citations,
          refused: false,
          stalePages: result.stalePages,
          disclaimer: result.disclaimer,
          ...resolvedField,
          ...expandedField
        } satisfies AskResponseDto
      })
    )
  })
