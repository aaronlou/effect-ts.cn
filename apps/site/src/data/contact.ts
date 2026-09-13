/**
 * 联系方式的**唯一事实来源**。
 *
 * 与 `community.ts` 同一套思路：页面不硬编码链接。
 * `email` 留空时联系页会给出诚实说明（指向 GitHub Issue），**不放假地址**。
 */
const REPO = "https://github.com/aaronlou/effect-ts.cn"

export const contact = {
  /**
   * 公开邮箱。留空 = 尚未公布，联系页会说明并指向 GitHub Issue。
   *
   * 建议填入一个真实可达的邮箱：AdSense 审核清单把"联系"列为默认检查项之一，
   * 而 GitHub Issue 虽然有链接，但审核方更认"页面上有一个邮箱"。
   */
  email: "",
  x: "https://x.com/lou_yuan82444",
  translationIssue: `${REPO}/issues/new?labels=translation`,
  aiFeedbackIssue: `${REPO}/issues/new?labels=ai-feedback`,
  repo: REPO
} as const
