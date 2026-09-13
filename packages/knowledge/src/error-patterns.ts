/**
 * 报错模式表：**确定性的「这类报错该看哪几页」映射**。
 *
 * ── 为什么需要它（而不是靠检索）─────────────────────────────────────
 * `/debug` 原本的路径是"从报错里提 API 名 → 检索"。这对**编译期类型报错**有效，
 * 但对**运行期报错**几乎失效 —— 因为后者的信号在**语义**里，不在 API 名上。
 *
 * 实测（7 条真实运行期报错，全部由实际跑代码产出）：
 *
 *   (FiberFailure) Error: Service not found: B
 *       → extractIdentifiers = **[]**  → 直接拒答
 *
 * 而 `Service not found` 恰恰是 Effect 最经典、最常被搜的运行期错误。
 * 更要紧的是：**它主要不是 Effect 用户遇到的，是"间接撞上 Effect"的人遇到的** ——
 * 装了个用 Effect 写的库，运行时崩了，看到这行字，完全不知道 Layer 是什么。
 * 这批人的搜索意图最明确，也最该被接住。
 *
 * 这类错误的正确答案是确定的（"你 yield* 了一个服务，但没提供对应 Layer" →
 * 《管理 Layer》），不需要模糊匹配 —— 模糊匹配反而会给出不相关的引用。
 *
 * ── 两条纪律 ────────────────────────────────────────────────────────
 * 1. **顺序敏感**：`Service not found` 的报错里同时含 `FiberFailure`，
 *    所以更具体的模式必须排在更宽泛的前面（下面的数组顺序就是优先级）。
 * 2. **只决定"看哪几页"，不往答案里塞事实**。答案仍然由检索到的文档正文构成 ——
 *    这张表提供的是**证据选择**，不是结论。仓库契约：任何答案的引用必须来自检索结果。
 */
import type { CorpusPage } from "./types.js"

export interface ErrorPattern {
  /** 稳定标识，用于测试与日志 */
  readonly id: string
  /** 识别特征。必须足够特征化 —— 宁可漏，不可错认 */
  readonly match: RegExp
  /** 这一类的简称（人读用） */
  readonly label: string
  /** 目标文档 slug，**按相关性排序**（v4 主线优先） */
  readonly slugs: readonly string[]
}

/**
 * 模式表。**数组顺序 = 匹配优先级**，新条目请插在合适的位置而不是无脑追加。
 */
export const ERROR_PATTERNS: readonly ErrorPattern[] = [
  {
    id: "service-not-found",
    match: /Service not found/i,
    label: "运行期找不到服务（缺少 Layer）",
    slugs: [
      "v4/requirements-management/layers",
      "v4/requirements-management/services",
      "v4/getting-started/running-effects"
    ]
  },
  {
    id: "async-fiber",
    match: /AsyncFiberException|cannot be resolved synchronously/i,
    label: "对异步 Effect 用了 runSync",
    slugs: ["v4/getting-started/running-effects", "v4/getting-started/creating-effects"]
  },
  {
    id: "timeout",
    match: /TimeoutException|Operation timed out/i,
    label: "Effect 超时",
    slugs: ["v4/error-management/timing-out", "v4/error-management/retrying"]
  },
  {
    id: "yield-not-effect",
    match: /is not iterable|cannot read property ['"]?Symbol\(Symbol\.iterator\)/i,
    label: "yield* 了一个不是 Effect 的值",
    slugs: ["v4/getting-started/using-generators", "v4/getting-started/the-effect-type"]
  },
  // ↓ 最宽泛的放最后：任何未被上面接住的 FiberFailure 都落到这里
  {
    id: "fiber-failure",
    match: /FiberFailure|AsyncFiberException/i,
    label: "FiberFailure：Effect 的运行期失败",
    slugs: [
      "v4/error-management/two-error-types",
      "v4/error-management/unexpected-errors",
      "v4/getting-started/running-effects"
    ]
  }
]

/**
 * 找出第一个匹配的模式（**顺序即优先级**）。
 *
 * 刻意只返回第一个：多个模式同时命中时，越具体的越可信；
 * 合并它们的文档集会把不相关的页面混进来，反而降低答案质量。
 */
export function matchErrorPattern(errorText: string): ErrorPattern | undefined {
  return ERROR_PATTERNS.find((pattern) => pattern.match.test(errorText))
}

/** 模式命中时的证据分：高于定义型标题兜底（12），表明"这是确定性映射" */
export const PATTERN_MATCH_SCORE = 20

/**
 * 按 slug 取出目标页的**前若干个切片**作为证据。
 *
 * 取前几片而不是全页：模式命中时我们要的是"这几页讲这件事"，
 * 而《管理 Layer》这类页面很长，全塞给模型会稀释掉真正的重点。
 */
export function chunksForPattern(
  pages: readonly CorpusPage[],
  pattern: ErrorPattern,
  options: { readonly maxPerPage?: number } = {}
): ReadonlyArray<{ readonly page: CorpusPage; readonly chunk: CorpusPage["chunks"][number] }> {
  const maxPerPage = options.maxPerPage ?? 2
  const bySlug = new Map(pages.map((page) => [page.slug, page]))
  const out: Array<{ page: CorpusPage; chunk: CorpusPage["chunks"][number] }> = []
  for (const slug of pattern.slugs) {
    const page = bySlug.get(slug)
    if (page === undefined) continue
    for (const chunk of page.chunks.slice(0, maxPerPage)) out.push({ page, chunk })
  }
  return out
}
