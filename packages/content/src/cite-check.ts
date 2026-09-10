/**
 * 引用协议门禁：语料 ↔ 构建产物一致性。
 *
 * 为什么需要：`/cite/<digest>.json` 是**对外承诺的取证接口**。如果摘要算错、
 * 指纹对不上、或构建产物里根本没有这个文件，那"引用可核验"就是空话 ——
 * 而比空话更糟的是**看起来能核验**。
 *
 * 覆盖四件事（单位是**小节 / 锚点**，不是检索切片）：
 * 1. 每个带锚点的小节都有 `citeDigest`，且等于 `sha256(slug + "\n" + anchor)` 前 16 位；
 * 2. `citeDigest` 全局唯一（两个小节不能抢同一个地址 —— 否则引用会指向错误的证据）；
 * 3. `contentHash` 等于**整个小节**正文的指纹，且同一小节内所有切片一致；
 * 4. 构建产物里存在 `/cite/<digest>.json` 与 `/cite/index.json`，且记录内指纹自洽。
 */
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { Corpus, CorpusChunk } from "@ecn/knowledge"
import { citationDigest, contentHash } from "./citation.js"

export interface CiteCheckIssue {
  readonly level: "error" | "warning"
  readonly message: string
}

export interface CiteCheckResult {
  /** 去重后的引用记录数（= 可解引用的小节数） */
  readonly citations: number
  readonly errors: ReadonlyArray<CiteCheckIssue>
  readonly warnings: ReadonlyArray<CiteCheckIssue>
}

export async function checkCitations(options: {
  readonly corpusFile: string
  readonly htmlDir?: string
}): Promise<CiteCheckResult> {
  const errors: Array<CiteCheckIssue> = []
  const warnings: Array<CiteCheckIssue> = []
  const error = (message: string): void => {
    errors.push({ level: "error", message })
  }

  let corpus: Corpus
  try {
    corpus = JSON.parse(await readFile(options.corpusFile, "utf8")) as Corpus
  } catch (cause) {
    return {
      citations: 0,
      errors: [{ level: "error", message: `无法读取语料 ${options.corpusFile}：${String(cause)}` }],
      warnings
    }
  }

  /** digest → 首次声明它的位置（用于检测地址冲突） */
  const owners = new Map<string, string>()

  for (const page of corpus.pages) {
    const sections = new Map<string, Array<CorpusChunk>>()
    for (const chunk of page.chunks) {
      if (chunk.anchor === undefined) {
        if (chunk.citeDigest !== undefined || chunk.contentHash !== undefined) {
          error(`${chunk.id}: 无锚点却带引用字段 —— 页级切片不应生成引用记录`)
        }
        continue
      }
      const list = sections.get(chunk.anchor)
      if (list === undefined) sections.set(chunk.anchor, [chunk])
      else list.push(chunk)
    }

    for (const [anchor, chunks] of sections) {
      const where = `${page.slug}#${anchor}`
      const first = chunks[0]
      if (first?.citeDigest === undefined) {
        error(`${where}: 缺 citeDigest（内容改动后请重跑 pnpm corpus:build）`)
        continue
      }
      const digest = first.citeDigest

      const expectedDigest = citationDigest(page.slug, anchor)
      if (digest !== expectedDigest) {
        error(`${where}: citeDigest 与 (slug, anchor) 不匹配（${digest} ≠ ${expectedDigest}）`)
      }

      const owner = owners.get(digest)
      if (owner !== undefined) {
        error(`${where} 与 ${owner} 共用同一引用地址 ${digest} —— 引用会指向错误的证据`)
      } else {
        owners.set(digest, where)
      }

      // 同一小节内所有检索切片必须共享同一份引用元信息
      for (const chunk of chunks) {
        if (chunk.citeDigest !== digest) {
          error(`${chunk.id}: 同一小节内的 citeDigest 不一致`)
          break
        }
      }

      const sectionText = chunks.map((chunk) => chunk.text).join("\n\n")
      const expectedHash = contentHash(sectionText)
      const storedHash = first.contentHash
      if (storedHash === undefined) {
        error(`${where}: 缺 contentHash`)
      } else if (storedHash !== expectedHash) {
        error(`${where}: contentHash 与小节正文不符 —— 漂移检测会误报`)
      } else {
        for (const chunk of chunks) {
          if (chunk.contentHash !== storedHash) {
            error(`${chunk.id}: 同一小节内的 contentHash 不一致`)
            break
          }
        }
      }
    }
  }

  if (corpus.stats.citations !== owners.size) {
    error(`语料统计不一致：stats.citations=${corpus.stats.citations}，实际去重后 ${owners.size}`)
  }

  if (options.htmlDir !== undefined) {
    const citeDir = path.join(options.htmlDir, "cite")
    if (!existsSync(path.join(citeDir, "index.json"))) {
      error(`构建产物缺 /cite/index.json（${path.join(citeDir, "index.json")}）`)
    }

    const missing: Array<string> = []
    let checkedRecords = 0
    for (const digest of owners.keys()) {
      const file = path.join(citeDir, `${digest}.json`)
      if (!existsSync(file)) {
        if (missing.length < 5) missing.push(digest)
        continue
      }
      checkedRecords++
      try {
        const record = JSON.parse(await readFile(file, "utf8")) as {
          digest?: string
          contentHash?: string
          chunkText?: string
        }
        if (record.digest !== undefined && record.digest !== digest) {
          error(`${digest}.json: digest 字段自相矛盾（${record.digest}）`)
        }
        const expected = contentHash(record.chunkText ?? "")
        if (record.contentHash !== undefined && record.contentHash !== expected) {
          error(`${digest}.json: contentHash 与 chunkText 不符 —— 引用核验会失败`)
        }
      } catch (cause) {
        error(`${digest}.json: 解析失败（${String(cause)}）`)
      }
    }

    if (missing.length > 0) {
      error(
        `构建产物缺引用记录：${owners.size - checkedRecords} 个（示例 ${missing.join(", ")}）—— 请先 pnpm build`
      )
    }
  }

  return { citations: owners.size, errors, warnings }
}
