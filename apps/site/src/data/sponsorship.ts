/**
 * 赞助与成本的**唯一事实来源**（改这里，别在页面里硬编码）。
 *
 * ── 为什么把成本公开 ────────────────────────────────────────────────
 * 这个站靠"可核验"立身：答案给出可点回的引用、条目标注"机器生成·未经人审"、
 * 每页标注翻译基线。**把成本也公开，是同一件事的延伸** ——
 * 否则"我们需要支持"就只是一句无法验证的话。
 *
 * 数字口径：
 * - 服务器与磁盘取 GCP us-central1 的按需价（每月按 730 小时）；
 * - 域名按年费均摊到月；
 * - AI 是**唯一的变动成本**，按实测单价与硬上限给出区间，而不是拍一个数。
 *
 * ── 赞助通道默认留空 ────────────────────────────────────────────────
 * 维护者填入地址后页面自动显示真实链接；未填写时页面给**诚实说明**，
 * 绝不放假链接或空收款入口（与 community.ts 对微信群二维码的处理一致）。
 */
export interface CostLine {
  readonly label: string
  readonly usd: number
  readonly note?: string
}

/** 固定成本（每月）：不随访问量变化 */
export const fixedCosts: readonly CostLine[] = [
  {
    label: "服务器 · GCP e2-small（us-central1）",
    usd: 12.23,
    note: "2 vCPU / 2GB。站点是纯静态产物，机器主要跑 API 与 Postgres"
  },
  { label: "持久磁盘 · 10GB", usd: 0.4 },
  { label: "域名 · effect-ts.cn", usd: 0.8, note: "年费均摊到月" },
  { label: "HTTPS 证书 · Let's Encrypt", usd: 0, note: "免费，自动续期" }
]

/**
 * 变动成本：AI 调用。
 *
 * 四道闸把它锁住了，这也是敢公开数字的前提：
 *   1. 每日 token 硬上限（到顶后自动降级为**纯检索模式**，仍然给引用，只是不调模型）
 *   2. 单 IP 每日提问上限  3. 单 IP 每分钟上限  4. 答案缓存（同问不重复计费）
 */
export const aiCost = {
  /** 实测每次提问消耗的 token 区间（含查询改写与重排） */
  measuredTokensPerAsk: [1096, 1201] as const,
  /** 实测单价区间（deepseek-flash） */
  measuredUsdPerAsk: [0.0003, 0.0007] as const,
  /** 每日 token 硬上限 */
  dailyTokenCap: 2_000_000,
  /** 打满上限时的月成本区间 */
  worstCaseMonthlyUsd: [18, 36] as const,
  /** 当前实际用量（维护者按 /api/knowledge/stats 更新；空串表示未取到） */
  actualMonthlyUsd: 0
} as const

/** 赞助通道。填了地址，页面就显示真实入口；为空则显示"尚未开通"。 */
export const channels = {
  /** 形如 https://github.com/sponsors/<你的用户名>（海外/信用卡友好） */
  githubSponsors: "",
  /** 形如 https://afdian.com/a/<你的主页>（国内友好） */
  afdian: "",
  /** 公开可查的收款/赞助记录页（可留空） */
  ledgerUrl: ""
} as const

export const sponsorshipOpen: boolean =
  channels.githubSponsors !== "" || channels.afdian !== ""

/** 已收到支持的公示（没有就是空数组 —— 页面会说明"还没有人赞助"，不编造） */
export const supporters: readonly { readonly name: string; readonly since: string }[] = []

export const fixedMonthlyUsd: number = fixedCosts.reduce((sum, line) => sum + line.usd, 0)
