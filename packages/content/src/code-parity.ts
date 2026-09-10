/**
 * 代码块一致性校验器（code parity）。
 *
 * 为什么要有：仓库的三条硬约束之一是**代码块与上游逐字节一致**（见 AGENTS.md）。
 * 规模化翻译（219 页，Agent 起草、人类审阅）之后，靠人眼盯住每一段代码不现实——
 * 必须有一道**机械门禁**，把「译文偷偷改了代码」变成可判定的差异。
 *
 * 设计要点：
 * 1. 纯函数、零依赖（不碰 fs / 网络），因此可以被 CLI 复用、也可以被单测穷举；
 * 2. 只比**代码块**与**标题数量**，不比标题文字（译文标题本就该中文化）；
 * 3. 围栏信息（info string）里的上游工具元数据一律剥掉：译文只保留语言标记，
 *    上游的 `twoslash` / `import.meta.vitest` / `showLineNumbers` / `name="…"` /
 *    Expressive Code 注解（`title="…"`、`collapse={…}`、`ins={…}`、`del={…}`、
 *    行高亮 `{8}`、单词高亮 `"Error"` 等）都不算「改动」——它们在本站没有渲染语义；
 * 4. 代码体按**最小公共缩进** dedent 后再逐字节比较：译文可能把整块放进列表 /
 *    组件里导致整体多缩进，这不算改动；缩进之外的一个字符都算。
 */

export interface CodeBlock {
  /** 围栏后的 info string（原始文本，含工具元数据） */
  readonly info: string
  /** 块内原始文本：行用 "\n" 连接、已按最小公共缩进 dedent、无尾部换行 */
  readonly body: string
}

export interface CodeParityResult {
  readonly ok: boolean
  readonly upstreamCount: number
  readonly translatedCount: number
  readonly issues: ReadonlyArray<string>
}

export interface HeadingParityResult {
  readonly ok: boolean
  readonly upstreamCount: number
  readonly translatedCount: number
}

/** 差异信息里的单侧内容上限：一行最长 120 字符，避免把整段代码灌进 CI 日志 */
const MAX_SNIPPET = 120

/**
 * 上游工具元数据 token（译文一律剥掉，只留语言标记）。
 *
 * 关键决定：`title="…"` 也被视为工具元数据。依据是**仓库现有内容约定**：
 * 15 篇已发布译文与 `.proposals/.drafts/` 全部只保留语言标记；本站用原生 Shiki，
 * 没有 Expressive Code，`title=` 只会变成死元数据。若把它当作「改动」，
 * 门禁会对**每一页**误报，从而失去机械门禁的意义。
 */
const TOOLING_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /^twoslash$/,
  /^import\.meta\.vitest$/,
  /^showLineNumbers(?:=(?:true|false))?$/,
  // name="…" / title="…" / lang="tsx" 等 Expressive Code 键值注解
  /^(?:name|filename|title|lang|frame|collapse|ins|del|mark|highlight|focus|wrap|startLineNumber)=.*$/,
  /^wrap$/,
  // 行高亮：{8} / {3-15} / {6,12}
  /^\{[\d,\s-]*\}$/,
  // 单词高亮：'Error' / "<Buffer, Error>"
  /^"[^"]*"$/,
  /^'[^']*'$/
]

function isToolingToken(token: string): boolean {
  return TOOLING_TOKEN_PATTERNS.some((pattern) => pattern.test(token))
}

/**
 * 去掉上游工具元数据 token，其余信息保留；token 顺序归一（排序后拼接）。
 * 大小写敏感；空白归一（任意连续空白 → 单个空格）。
 */
export function normalizeFenceInfo(info: string): string {
  return tokenizeFenceInfo(stripRegexDirectives(info))
    .filter((token) => token !== "" && !isToolingToken(token))
    .sort()
    .join(" ")
}

/**
 * 剥掉 twoslash 的**正则式指令**，例如 `/{ mode: "result" }/`、`/Effect</`。
 *
 * 为什么必须在切词**之前**处理：这类指令会跨越空格（`/`、`{`、`mode:`、`"result"`…），
 * 一旦切成 token 就再也认不出这是一条指令，只会被判成"译文漏了内容"——
 * 而按本站规范译文本就该把它剥掉，于是**正确**的行为被误报为不一致。
 *
 * 边界处理：只匹配**以空白/行首开头、以空白/行尾结尾**的 `/…/` 片段，
 * 避免误伤 `title="src/app.ts"` 这类内部带斜杠的注解。
 */
function stripRegexDirectives(info: string): string {
  return info.replace(/(^|\s)\/[^/\n]*\/(\s|$)/g, " ")
}

/**
 * 按空白切分围栏信息串，但**不切断被引号包裹的片段**。
 *
 * 为什么不能用 `split(/\s+/)`：Expressive Code 的代码块标题里常有空格甚至竖线，
 * 例如 `ts twoslash "Config | Logger" import.meta.vitest name="..."`；
 * 粗暴切分会得到 `"Config`、`|`、`Logger"` 三个 token，既无法识别为元数据，
 * 又会让「上游有标题、译文按规范剥掉」这种**正确**的行为被误报为不一致。
 */
function tokenizeFenceInfo(info: string): ReadonlyArray<string> {
  const tokens: Array<string> = []
  let current = ""
  let quote: '"' | "'" | undefined = undefined
  for (const char of info.trim()) {
    if (quote !== undefined) {
      current += char
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (/\s/.test(char)) {
      if (current !== "") tokens.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (current !== "") tokens.push(current)
  return tokens
}

/** 每行的前导空白（空格 / Tab）长度 */
function leadingWhitespace(line: string): number {
  const match = /^[ \t]*/.exec(line)
  return match === null ? 0 : match[0].length
}

/**
 * 按最小公共缩进 dedent：空白行归一为空串（避免「只差空行缩进」的假差异）。
 * 只有在所有非空行都有公共缩进时才真正去缩进。
 */
function dedent(body: string): string {
  const lines = body.split("\n")
  let min = Number.POSITIVE_INFINITY
  for (const line of lines) {
    if (line.trim() === "") continue
    min = Math.min(min, leadingWhitespace(line))
  }
  if (!Number.isFinite(min) || min === 0) {
    return lines.map((line) => (line.trim() === "" ? "" : line)).join("\n")
  }
  return lines
    .map((line) => (line.trim() === "" ? "" : line.slice(Math.min(min, leadingWhitespace(line)))))
    .join("\n")
}

/**
 * 解析 Markdown/MDX 围栏代码块（``` 与 ~~~ 均可；围栏可带缩进；闭合围栏长度 >= 开启）。
 * 未闭合围栏不报错：把剩余内容当作一个块（门禁要能对「翻译到一半」的草稿给出结论，
 * 而不是崩溃）。
 */
export function extractCodeBlocks(markdown: string): ReadonlyArray<CodeBlock> {
  const lines = markdown.split(/\r?\n/)
  const blocks: Array<CodeBlock> = []

  let index = 0
  while (index < lines.length) {
    const opening = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(lines[index] ?? "")
    if (opening === null) {
      index += 1
      continue
    }

    const fence = opening[2] ?? "```"
    const fenceChar = fence[0]
    const fenceLength = fence.length
    const info = (opening[3] ?? "").trim()

    const bodyLines: Array<string> = []
    index += 1
    while (index < lines.length) {
      const line = lines[index] ?? ""
      const closing = /^([ \t]*)(`{3,}|~{3,})[ \t]*$/.exec(line)
      if (
        closing !== null &&
        (closing[2] ?? "")[0] === fenceChar &&
        (closing[2] ?? "").length >= fenceLength
      ) {
        index += 1
        break
      }
      bodyLines.push(line)
      index += 1
    }

    blocks.push({ info, body: dedent(bodyLines.join("\n")) })
  }

  return blocks
}

/** 截断到 MAX_SNIPPET 字符以内（含省略号），便于 CI 日志定位 */
function truncate(text: string): string {
  const flat = text.replace(/\r?\n/g, "\\n")
  return flat.length <= MAX_SNIPPET ? flat : `${flat.slice(0, MAX_SNIPPET - 3)}...`
}

function snippet(value: string | undefined): string {
  return value === undefined ? "(无)" : `\`${truncate(value)}\``
}

/** 定位代码体第一处不同的行：返回可读 issue（第几块、第几行、两侧内容） */
function bodyIssue(blockIndex: number, upstream: string, translated: string): string {
  const left = upstream.split("\n")
  const right = translated.split("\n")
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    if (left[i] !== right[i]) {
      return `第 ${blockIndex + 1} 个代码块正文第 ${i + 1} 行不一致：上游 ${snippet(left[i])} / 译文 ${snippet(right[i])}`
    }
  }
  return `第 ${blockIndex + 1} 个代码块正文不一致`
}

/**
 * 逐块比较上游与译文的代码块：
 * - 块数一致；
 * - 每块 normalizeFenceInfo 后一致；
 * - 代码体逐字节一致（已 dedent）。
 * 不一致时给出可读定位（第几块、第一处不同的行号与两侧内容，截断到 120 字符内）。
 */
export function compareCodeBlocks(upstream: string, translated: string): CodeParityResult {
  const upstreamBlocks = extractCodeBlocks(upstream)
  const translatedBlocks = extractCodeBlocks(translated)
  const issues: Array<string> = []

  if (upstreamBlocks.length !== translatedBlocks.length) {
    issues.push(
      `代码块数量不一致：上游 ${upstreamBlocks.length} 个 / 译文 ${translatedBlocks.length} 个`
    )
  }

  const pairs = Math.min(upstreamBlocks.length, translatedBlocks.length)
  for (let i = 0; i < pairs; i += 1) {
    const left = upstreamBlocks[i] as CodeBlock
    const right = translatedBlocks[i] as CodeBlock

    const normalizedLeft = normalizeFenceInfo(left.info)
    const normalizedRight = normalizeFenceInfo(right.info)
    if (normalizedLeft !== normalizedRight) {
      issues.push(
        `第 ${i + 1} 个代码块围栏信息不一致：上游 \`${truncate(left.info)}\` / 译文 \`${truncate(right.info)}\``
      )
    }

    if (left.body !== right.body) {
      issues.push(bodyIssue(i, left.body, right.body))
    }
  }

  return {
    ok: issues.length === 0,
    upstreamCount: upstreamBlocks.length,
    translatedCount: translatedBlocks.length,
    issues
  }
}

/** 统计 `##` / `###` 标题数量（跳过围栏代码块内的行） */
function countHeadings(markdown: string): number {
  let insideFence = false
  let fenceChar = ""
  let fenceLength = 0
  let count = 0

  for (const line of markdown.split(/\r?\n/)) {
    const opening = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(line)
    if (!insideFence && opening !== null) {
      insideFence = true
      fenceChar = (opening[2] ?? "")[0] ?? ""
      fenceLength = (opening[2] ?? "").length
      continue
    }
    if (insideFence) {
      const closing = /^([ \t]*)(`{3,}|~{3,})[ \t]*$/.exec(line)
      if (
        closing !== null &&
        (closing[2] ?? "")[0] === fenceChar &&
        (closing[2] ?? "").length >= fenceLength
      ) {
        insideFence = false
      }
      continue
    }
    if (/^[ \t]{0,3}#{2,3}\s/.test(line)) count += 1
  }

  return count
}

/**
 * 比较二级 / 三级标题（`##`、`###`）的**数量**是否一致。
 * 只比数量、不比文字：标题本就该译成中文。
 */
export function compareHeadings(upstream: string, translated: string): HeadingParityResult {
  const upstreamCount = countHeadings(upstream)
  const translatedCount = countHeadings(translated)
  return {
    ok: upstreamCount === translatedCount,
    upstreamCount,
    translatedCount
  }
}
