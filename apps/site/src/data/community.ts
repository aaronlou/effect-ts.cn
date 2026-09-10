/**
 * 社区入口的**唯一事实来源**。
 *
 * 本站是中文社区，所以对外只提供中文读者真正用得了的渠道：**微信群 + GitHub**。
 * 刻意**不透传 Discord 等海外 SNS** —— 那是官方全球社区的事，不是我们的入口。
 * 渠道变更请只改这里，不要在页面或文案里硬编码链接（否则会各处漂移）。
 */
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** 群二维码：维护者把图片放到 apps/site/public/community/wechat-group.png，页面自动显示 */
const WECHAT_QR_PUBLIC_PATH = "/community/wechat-group.png"
/** 两种解析方式都试一次：cwd 在 apps/site（pnpm --filter 构建）或相对模块定位 */
const WECHAT_QR_CANDIDATES = [
  path.resolve(process.cwd(), "public/community/wechat-group.png"),
  fileURLToPath(new URL("../../public/community/wechat-group.png", import.meta.url))
]

export const community = {
  /** 中文社区主频道 */
  wechat: {
    label: "微信群",
    qrImage: WECHAT_QR_PUBLIC_PATH,
    /** 二维码是否已随仓库发布。未发布时页面给**诚实说明**，绝不放假链接/假二维码 */
    qrAvailable: WECHAT_QR_CANDIDATES.some((file) => existsSync(file)),
    pendingNote:
      "微信群二维码尚未随仓库发布。维护者把群二维码放到 apps/site/public/community/wechat-group.png，本页即自动显示。",
    rulesUrl: "https://github.com/aaronlou/effect-ts.cn/blob/main/CODE_OF_CONDUCT.md"
  },
  /** 代码协作入口（可追溯，不是即时群聊） */
  github: {
    repo: "https://github.com/aaronlou/effect-ts.cn",
    issues: "https://github.com/aaronlou/effect-ts.cn/issues/new",
    upstream: "https://github.com/Effect-TS/effect"
  }
} as const
