/**
 * 搜索引擎站长工具的**所有权验证 token**（唯一事实来源）。
 *
 * ── 为什么需要这个文件 ────────────────────────────────────────────────
 * 没有站长工具，我们对"流量从哪来、人在搜什么词"**只能猜**。
 * 而这个站的内容策略（该补哪类页面）完全取决于真实查询词 ——
 * 所以这是所有推广工作的前置条件，不是可选项。
 *
 * ── 两种验证方式，任选其一 ────────────────────────────────────────────
 *
 * **① HTML 标记（推荐，改这个文件就行）**
 *   在 Search Console 选「HTML 标记」方式，它给你一段
 *   `<meta name="google-site-verification" content="xxxx" />`，
 *   把 content 的值填到下面，提交部署，然后回去点「验证」。
 *   好处：不用碰 DNS 控制台；坏处：要走一次 CI + 部署（约 5 分钟）。
 *
 * **② DNS TXT（不用部署，但要动火山引擎控制台）**
 *   在 Search Console 选「DNS 记录」方式，它给你一条 TXT。
 *   本站 DNS 托管在火山引擎（ns1/ns2.volcengine-dns.com），
 *   在那边加一条 TXT 记录即可，验证是即时的。
 *   好处：不用重新部署，且对子域名也生效。
 *
 * 两者都做也没坏处（验证方式互为备份）。
 */
export const verification = {
  /** Search Console 的 HTML 标记 content 值。留空 = 不输出该 meta。 */
  google: "",
  /**
   * Bing Webmaster Tools 的 `msvalidate.01` 值。留空 = 不输出。
   *
   * 为什么 Bing 也值得做：**ChatGPT 的联网搜索走 Bing 索引**，Copilot 也是。
   * 只做 Google 是这几年很常见的一个疏漏。
   * （Bing 支持从 Search Console 直接导入站点，导入后仍建议补上这个 meta 以防万一。）
   */
  bing: "",
  /** 其它站长工具（如百度）的验证 meta：name → content */
  others: {} as Readonly<Record<string, string>>
} as const
