/**
 * Markdown/MDX → 检索切片（chunk）与纯文本。
 *
 * 目标不是完美解析 Markdown，而是产出**可引用、可检索**的语料：
 * - 按标题切分，保留标题路径（答案里能写"《页面》› 小节"）；
 * - 代码块内容保留（Effect 场景下 API 名是强检索信号），但只保留前若干字符；
 * - MDX 组件标签剥掉、保留其文字（`<Aside>` 里的提示往往正是答案所在）；
 * - 若译文用 `<span id="...">` 固定了上游锚点，这里一并记录（构建产物缺失时的兜底）。
 */

const FENCE = /^\s*```/
const HEADING = /^(#{2,4})\s+(.*)$/
const SPAN_ANCHOR = /<span\s+id="([A-Za-z0-9_-]+)"\s*\/?>/

export interface ChunkDraft {
  readonly headingPath: ReadonlyArray<string>
  readonly anchor?: string
  readonly text: string
  readonly hasCode: boolean
}

export interface ChunkOptions {
  /** 单个切片的目标上限（字符） */
  readonly maxChars?: number
  /** 代码块保留字符数 */
  readonly maxCodeChars?: number
}

/** 去掉 Markdown/MDX 标记，保留可读文本（用于检索与 llms 输出） */
export function stripMarkup(markdown: string, options?: { keepCode?: boolean }): string {
  const keepCode = options?.keepCode ?? true
  let text = markdown

  text = text.replace(/^import\s.+$/gm, "")
  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, code: string) =>
    keepCode ? `\n${code}\n` : "\n"
  )
  text = text.replace(/`([^`\n]*)`/g, "$1")
  text = text.replace(/<span\s+id="[^"]*"\s*\/?>/g, "")
  text = text.replace(/<\/?[A-Za-z][^>]*>/g, " ")
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  text = text.replace(/^\s{0,3}#{1,6}\s*/gm, "")
  text = text.replace(/^\s{0,3}>\s?/gm, "")
  text = text.replace(/^\s{0,3}[-*+]\s+/gm, "")
  text = text.replace(/^\s{0,3}\d+\.\s+/gm, "")
  text = text.replace(/\|/g, " ")
  text = text.replace(/[*_~]{1,3}/g, "")
  text = text.replace(/[ \t]+/g, " ")
  text = text.replace(/\n{3,}/g, "\n\n")
  return text.trim()
}

function compactCode(code: string, maxChars: number): string {
  const trimmed = code.trim()
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)} …`
}

/**
 * 把一页正文切成若干切片。
 * 传入的 body 不应包含 frontmatter。
 */
export function chunkMarkdown(body: string, options?: ChunkOptions): ReadonlyArray<ChunkDraft> {
  const maxChars = options?.maxChars ?? 1100
  const maxCodeChars = options?.maxCodeChars ?? 500

  const chunks: Array<ChunkDraft> = []
  const headingPath: Array<string> = []
  let anchor: string | undefined
  let buffer: Array<string> = []
  let hasCode = false
  let inFence = false
  let fenceBuffer: Array<string> | null = null

  const currentHeadingPath = (): ReadonlyArray<string> => headingPath.filter((part) => part.length > 0)

  const flush = (): void => {
    const text = stripMarkup(buffer.join("\n\n"))
    buffer = []
    const code = hasCode
    hasCode = false
    if (text.length === 0) return
    chunks.push({
      headingPath: currentHeadingPath(),
      ...(anchor !== undefined ? { anchor } : {}),
      text,
      hasCode: code
    })
  }

  for (const rawLine of body.split(/\r?\n/)) {
    // 代码块
    if (FENCE.test(rawLine)) {
      if (!inFence) {
        inFence = true
        fenceBuffer = []
      } else {
        inFence = false
        if (fenceBuffer !== null) {
          const code = compactCode(fenceBuffer.join("\n"), maxCodeChars)
          if (code.length > 0) {
            buffer.push("```\n" + code + "\n```")
            hasCode = true
          }
        }
        fenceBuffer = null
      }
      continue
    }
    if (inFence) {
      fenceBuffer?.push(rawLine)
      continue
    }

    // 显式锚点（译文用 <span id="..."> 固定上游英文锚点）
    const spanMatch = SPAN_ANCHOR.exec(rawLine)
    if (spanMatch !== null) {
      anchor = spanMatch[1]
      continue
    }

    // 标题：切换小节
    const heading = HEADING.exec(rawLine)
    if (heading !== null) {
      flush()
      const level = (heading[1] ?? "##").length
      const title = stripMarkup(heading[2] ?? "")
      headingPath.length = Math.max(0, level - 2) // ## → 0 级
      headingPath[level - 2] = title
      anchor = undefined
      continue
    }

    if (rawLine.trim() === "") {
      continue
    }

    buffer.push(rawLine)
    const size = buffer.reduce((sum, line) => sum + line.length, 0)
    if (size >= maxChars) flush()
  }
  flush()

  return chunks
}

/** 句子切分（中英混排），供答案组装挑选"最相关的一句" */
export function splitSentences(text: string): ReadonlyArray<string> {
  return text
    .split(/(?<=[。！？；!?;])\s*|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8)
}
