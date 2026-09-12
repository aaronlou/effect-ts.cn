/**
 * 变现与统计的**唯一开关**（改这里，别在各页面硬编码）。
 *
 * ── 为什么默认全部关闭 ─────────────────────────────────────────────
 * 1. **AdSense 对大陆访客基本无效**：Google 的广告域名在大陆不可达，
 *    广告不渲染 ⇒ 没有曝光 ⇒ 没有收益，只在版面上留一块空白。
 *    能产生收益的是境外访客，而这个站的受众大部分在大陆。
 * 2. 开发者是全网最会装广告拦截的人群，文档站塞广告还会同时伤到
 *    "这是个可信的中文文档站"这件事本身。
 * 3. **未获 AdSense 批准前加载脚本毫无意义**，而且会拖慢首屏。
 * 所以：**批准之后**再把 `ads.enabled` 改成 true。
 *
 * 改完需要重新构建站点（CI 会在 push 后自动重建并推送镜像，服务器 pull 即可）。
 */
export interface AdSlotConfig {
  /** AdSense 后台为每个广告位生成的 `data-ad-slot` 数字 */
  readonly slotId: string
  /** 该位置预留的高度（px）—— **必须预留**，否则广告加载完会把正文顶下去（CLS） */
  readonly reserveHeight: number
}

export interface MonetizationConfig {
  readonly ads: {
    readonly enabled: boolean
    /** 形如 `ca-pub-1234567890123456`；为空则一切不变 */
    readonly client: string
    /**
     * 只投**非个性化**广告。
     *
     * 默认 true 是刻意的：个性化广告对 EEA/UK 访客需要**经过认证的 CMP** 先取得同意，
     * 否则违反 Google 的 EU 用户同意政策。非个性化广告把合规负担降到最低
     * （仍需隐私政策披露，见 /privacy/）。要做个性化广告就接一个 CMP 再改成 false。
     */
    readonly nonPersonalized: boolean
    readonly slots: {
      /** 文档正文**末尾**（绝不插入正文中间） */
      readonly articleEnd: AdSlotConfig
      /** 列表页（博客/生态榜）底部 */
      readonly listEnd: AdSlotConfig
    }
  }
  readonly analytics: {
    /** 自建统计（Umami）：同样默认关闭，部署好并把 websiteId 填进来再开 */
    readonly enabled: boolean
    /** 统计脚本地址；与站点同源（走 Caddy 反代），因此**在大陆可用** */
    readonly scriptUrl: string
    readonly websiteId: string
  }
}

export const MONETIZATION: MonetizationConfig = {
  ads: {
    enabled: false,
    client: "",
    nonPersonalized: true,
    slots: {
      articleEnd: { slotId: "", reserveHeight: 280 },
      listEnd: { slotId: "", reserveHeight: 280 }
    }
  },
  analytics: {
    enabled: false,
    scriptUrl: "/stats/script.js",
    websiteId: ""
  }
}

/** 广告是否真的可以渲染：开关打开 **且** client 与 slotId 都填了 */
export const adsRenderable = (slot: AdSlotConfig): boolean =>
  MONETIZATION.ads.enabled && MONETIZATION.ads.client.trim() !== "" && slot.slotId.trim() !== ""
