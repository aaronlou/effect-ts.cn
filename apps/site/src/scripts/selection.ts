/**
 * 选区即问：把"用户选中了正文里的一段"变成一份**带锚点的快照**。
 *
 * 为什么单独成模块：`AgentDock`（被动的「问这段」）与 `SelectionAgent`（小效跑过去主动问一句）
 * 必须共用**同一份**选区判定与锚点解析 —— 否则会出现两套 `selectionchange` 监听、
 * 两套"什么算正文"的口径，早晚对不上。
 *
 * 设计要点：
 * - **选区是定位器，不是自由文本**。快照里带 `slug / version / anchor / commit`，
 *   这样"讲这段"可以被钉回 `v4/...#anchor@commit`，进而解引用成 `/cite/<digest>.json`。
 *   （切片 B 会把这些字段发给后端；切片 A 只用它做提示与"问这段"的预填。）
 * - **只认正文**：必须落在 `main` 内，且不在导航 / 侧栏 / 页脚 / 站内浮层里。
 *   注意官方文档页的侧边栏 `aside` 就在 `main` 里面，所以只判 `closest("main")` 是不够的。
 * - **长度上限 300 是契约约束，不是口味**：`AskRequestDto.question` 的 `maxLength` 是 500，
 *   而"讲讲"会把选中文本直接当问题提交。切片 B 引入 `selection.text`（上限 2000）后再放宽。
 */

/** 选中文本长度下限：太短（"的"、"x"）只会污染检索 */
export const MIN_SELECTION_LENGTH = 6

/** 选中文本长度上限：见文件头"契约约束" */
export const MAX_SELECTION_LENGTH = 300

/** 带 `id` 的标题即小节锚点（与 packages/content 从构建产物里提取的锚点同源） */
const HEADING_SELECTOR = "h1[id], h2[id], h3[id], h4[id]"

/**
 * 不算"正文"的容器：
 * - `nav/aside/header/footer`：站内导航，文档页的侧边栏就在 `main` 内部；
 * - `.search-overlay`：搜索 / 问答浮层；
 * - `#ecn-agent-dock` / `#ecn-selection-agent`：小效自己，别让它问自己；
 * - `.docs-meta` / `.docs-foot`：页面元信息与页脚许可声明，不是被解释的对象。
 */
const EXCLUDED_SELECTOR =
  "nav, aside, header, footer, .search-overlay, #ecn-agent-dock, #ecn-selection-agent, .docs-meta, .docs-foot"

export interface SelectionSnapshot {
  /** 规范化后的选中文本（空白折叠，便于做检索查询与去重） */
  readonly text: string
  /** 选区所在页面的 slug（文档页取自 `<html data-doc-slug>`，其它页面回退到路径） */
  readonly slug: string
  /** 文档版本（`v3` / `v4`），非文档页为空 */
  readonly version?: string
  /** 译文所对照的上游基线 commit（非文档页为空） */
  readonly commit?: string
  /** 选区起点之前最近的小节锚点；落在页首导言时为 `intro`（与 corpus 的页导言锚点一致） */
  readonly anchor?: string
  /** 选区是否落在代码块内 —— 决定气泡文案（"解释这段代码" vs "讲讲这段"） */
  readonly kind: "code" | "prose"
  /** 选区**末尾**一行末端的视口坐标：小效要跑到这里 */
  readonly end: { readonly x: number; readonly y: number; readonly bottom: number }
  /** 选区范围本身：滚动 / 改窗口大小时据此重新定位（DOM 变动时可能失效，调用方需 try/catch） */
  readonly range: Range
}

/** 折叠空白：跨行选中会把缩进与换行一起带进来，查询与去重都不需要它们 */
export function normalizeSelectionText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim()
}

let headingCache: { readonly scope: Element; readonly headings: ReadonlyArray<HTMLElement> } | null = null

function headingsOf(scope: Element): ReadonlyArray<HTMLElement> {
  if (headingCache === null || headingCache.scope !== scope) {
    // 只在首次（或换页）查询一次；文档页标题数量在几十的量级，缓存成本可忽略
    headingCache = { scope, headings: Array.from(scope.querySelectorAll<HTMLElement>(HEADING_SELECTOR)) }
  }
  return headingCache.headings
}

/**
 * 选区起点归属的小节锚点 = 起点**之前**最近的带 id 标题。
 * 起点落在第一个标题之前（页面导言）时退回 `intro` —— 这是 corpus 给页首导言留的锚点
 * （见 packages/content/src/corpus.ts 的 `PAGE_LEAD_ANCHOR`）。
 */
function anchorFor(node: Node, main: Element): string | undefined {
  let candidate: HTMLElement | undefined
  for (const heading of headingsOf(main)) {
    // 起点就在标题里（选中了整个标题）⇒ 归属这个标题
    if (heading.contains(node)) {
      candidate = heading
      continue
    }
    // 标题出现在起点之后 ⇒ 还没走到，停
    if ((node.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) break
    candidate = heading
  }
  if (candidate !== undefined) return candidate.id
  return main.querySelector<HTMLElement>("#intro")?.id
}

/** 读当前选区；不构成"正文里的一段"时返回 null（调用方据此保持安静） */
export function readSelection(): SelectionSnapshot | null {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null

  const text = normalizeSelectionText(selection.toString())
  if (text.length < MIN_SELECTION_LENGTH || text.length > MAX_SELECTION_LENGTH) return null

  const range = selection.getRangeAt(0)
  const start = range.startContainer
  const element = start instanceof Element ? start : start.parentElement
  const main = document.getElementById("main")
  if (element === null || main === null || !main.contains(element)) return null
  if (element.closest(EXCLUDED_SELECTOR) !== null) return null

  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
  const last = rects[rects.length - 1]
  if (last === undefined) return null

  const data = document.documentElement.dataset
  const path = location.pathname.replace(/\/+$/, "")
  return {
    text,
    slug: data.docSlug ?? path.replace(/^\/docs\//, ""),
    version: data.docVersion,
    commit: data.docCommit,
    anchor: anchorFor(start, main),
    kind: element.closest("pre, code") !== null ? "code" : "prose",
    end: { x: last.right, y: last.top, bottom: last.bottom },
    range
  }
}

/** 会话内去重用的指纹：同一段被反复选中时不要反复打扰 */
export function fingerprintOf(snapshot: SelectionSnapshot): string {
  const raw = `${snapshot.slug}#${snapshot.anchor ?? ""}@${snapshot.text}`
  let hash = 5381
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) + hash + raw.charCodeAt(index)) | 0
  }
  return `${(hash >>> 0).toString(36)}-${raw.length}`
}

export interface SelectionWatchOptions {
  /** 选区稳定多久才算"选完了"（默认 180ms；拖动选择期间的抖动不算） */
  readonly settleMs?: number
}

/**
 * 监听"选区稳定下来"这一件事。
 *
 * 三个事件都要听，因为它们各自覆盖一半场景：
 * - `pointerup`：鼠标 / 触屏拖选结束（最主要）；
 * - `keyup`：Shift+方向键选完（`selectionchange` 期间会狂发，只有 keyup 是终点）；
 * - `selectionchange`：兜底（程序化选中、双击选词后不抬手等）。
 */
export function watchSelection(
  handler: (snapshot: SelectionSnapshot | null) => void,
  options: SelectionWatchOptions = {}
): () => void {
  const settleMs = options.settleMs ?? 180
  let timer: number | undefined

  const schedule = (): void => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      handler(readSelection())
    }, settleMs)
  }

  document.addEventListener("selectionchange", schedule)
  document.addEventListener("pointerup", schedule)
  document.addEventListener("keyup", schedule)

  return () => {
    if (timer !== undefined) window.clearTimeout(timer)
    document.removeEventListener("selectionchange", schedule)
    document.removeEventListener("pointerup", schedule)
    document.removeEventListener("keyup", schedule)
  }
}

/** 让小效/面板接住一段选中文本：有 `question` 就直接问，否则只预填（沿用既有口径，绝不替你提交） */
export function dispatchAsk(detail: { question?: string; prefill?: string }): void {
  document.dispatchEvent(new CustomEvent("ecn:ask", { detail }))
}
