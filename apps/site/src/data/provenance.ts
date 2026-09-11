/**
 * 译文 provenance 的**展示口径**（唯一事实来源）。
 *
 * 背景：站点 234 篇译文全部 `status: published`，且审校者一律是 `ecn-review`。
 * 这个身份表示的是「**机器可复核**」：代码块与上游逐字节一致、标题/组件/链接结构对齐、
 * 术语门禁 0 命中、引用锚点可达 —— 都是机器能验的部分。
 *
 * 它**不等于人类精读**。把 `ecn-review` 当作"已人工审校"展示，会让读者（以及
 * 按 llms.txt 消费本站的 Agent）高估内容的可靠性。所以这里统一口径：
 * 机器审校身份在页面上必须带上说明，而不是混在译者/审校名单里不加解释。
 *
 * 维护者精读后应在 `reviewers` 里**追加自己的名字**（见 docs/translation-guide.md）；
 * 想把"必须有人类审校者"变成硬门禁，用 `pnpm content:check --require-human-reviewer`
 * （校验器里的 MACHINE_REVIEWERS 是同一概念的服务端定义）。
 */
export const MACHINE_REVIEWER = "ecn-review"

/** 页脚括注：紧跟在机器审校身份后面 */
export const MACHINE_REVIEW_NOTE = "机器可复核，非人工精读"

/** 给 Agent / 统计页用的完整说明 */
export const MACHINE_REVIEW_DETAIL =
  "`ecn-review` 表示「机器可复核」：代码块与上游逐字节一致、标题/组件/链接结构对齐、" +
  "术语门禁 0 命中、引用锚点可达 —— 均为自动校验，**不含人类精读**。" +
  "需要人工审校保证的场景，请以官方英文原文为准，或参见仓库的审校流程。"

/** 该审校者是否属于「机器可复核」身份 */
export const isMachineReviewer = (reviewer: string): boolean => reviewer === MACHINE_REVIEWER
