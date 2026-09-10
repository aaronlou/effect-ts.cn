/**
 * 引用协议 · 构建期部分（Node）。
 *
 * 为什么需要它：在此之前，"溯源"只是**页面上的标签**——Agent 拿到一条引用只能选择相信。
 * 现在给每条引用一个**可独立解引用的地址**与**内容指纹**，让"我们比模型记忆更可信"
 * 从口号变成**机器可执行的断言**。
 *
 * 两个刻意分开的概念：
 * - `citationDigest`：只由 (slug, anchor) 决定 → **页面重新翻译后地址不变**，
 *   因此旧引用不会 404，而是"地址不变、内容指纹变了"，Agent 据此判断**漂移**；
 * - `contentHash`：切片正文的指纹 → 检测引用对应的原文是否已变。
 *
 * 注意：这是**身份/漂移检测**用的截断 sha256（64 bit），不是安全哈希，不要用于签名。
 */
import { createHash } from "node:crypto"

/** 引用记录的 schema 版本：字段变更时 +1，消费方据此判断兼容性 */
export const CITE_SCHEMA_VERSION = 1

/** sha256 前 16 位十六进制（64 bit）：足以做身份与漂移检测 */
export function sha16(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 16)
}

/**
 * 引用的稳定摘要：`sha16(slug + "\n" + anchor)`。
 * 刻意**不含** baseline commit —— 否则每次译文更新都会让历史引用失效（404），
 * 而我们要的是"地址稳定、内容可比对"。
 */
export function citationDigest(slug: string, anchor: string): string {
  return sha16(`${slug}\n${anchor}`)
}

/** 切片正文的内容指纹（用于漂移检测） */
export function contentHash(text: string): string {
  return sha16(text)
}

/** 引用记录的静态地址；与站点路由 `/cite/<digest>.json` 对应 */
export function citeUrlOf(digest: string): string {
  return `/cite/${digest}.json`
}
