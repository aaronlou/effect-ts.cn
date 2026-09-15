/**
 * 访问日志**判据的唯一来源**。
 *
 * 这些规则（探针 / 漏洞扫描 / 爬虫 / 静态资源 / 路径归一）本来就写在
 * `scripts/lib/access-log.mjs` 里，由 CLI 报表与周报共用。仓库里对这件事有明文规定：
 * 「字段映射与探针/扫描器/爬虫的判据**只允许有一份**」—— 所以后台报表**不重新实现**，
 * 而是引用同一个文件。
 *
 * 这个薄壳做两件事：
 *   1. 把那条很深的相对路径收敛到一处，免得每个调用点都写六级 `../../../../../../scripts/...`；
 *   2. **补上显式类型**。`.mjs` 在 `allowJs` 下推断出的类型不稳定（`fromCaddy` 的返回
 *      是个联合类型），这里声明成确定的形状，调用点才有真正的类型检查。
 *
 * ⚠️ 改这里的签名之前先改 `scripts/lib/access-log.mjs` —— 签名是手写的，
 * TS 无法验证它与实现是否还一致。`apps/api/test/traffic/` 里有针对真实日志行的断言兜着。
 */
import * as rules from "../../../../../../scripts/lib/access-log.mjs"

/** `fromCaddy` 归一化之后的字段（短名是历史原因，见 access-log.mjs 的注释） */
export interface AccessLogEntry {
  readonly t?: string
  readonly ip?: string
  readonly m?: string
  readonly u?: string
  readonly s?: number
  readonly b?: number
  readonly rt?: number
  readonly ref?: string
  readonly ua?: string
  readonly host?: string
}

export const fromCaddy = rules.fromCaddy as (raw: unknown) => AccessLogEntry
export const isBot = rules.isBot as (ua: string | undefined) => boolean
export const isProbe = rules.isProbe as (ua: string | undefined, path: string) => boolean
export const isScan = rules.isScan as (path: string) => boolean
export const isStatic = rules.isStatic as (path: string) => boolean
export const normalizePath = rules.normalizePath as (url: string) => string
