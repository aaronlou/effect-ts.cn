/**
 * 极简 frontmatter 解析（本站 frontmatter 是受控的 yaml 子集）：
 *   key: scalar
 *   key:
 *     - item1
 *     - item2
 * 足够支撑翻译状态扫描；完整 YAML 交给 Phase 1 的正式管线。
 */

export type Frontmatter = Record<string, string | ReadonlyArray<string>>

export function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (match === null) {
    return { frontmatter: {}, body: raw }
  }
  const fm = parseBlock(match[1] ?? "")
  return { frontmatter: fm, body: raw.slice((match[0] ?? "").length) }
}

function parseBlock(block: string): Frontmatter {
  const result: Frontmatter = {}
  let currentKey: string | null = null

  for (const line of block.split(/\r?\n/)) {
    const listItem = /^-\s+(.*)$/.exec(line.trimStart())
    if (listItem !== null) {
      if (currentKey !== null) {
        const prev = result[currentKey]
        const value = cleanScalar(listItem[1] ?? "")
        result[currentKey] = Array.isArray(prev) ? [...prev, value] : [value]
      }
      continue
    }
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (pair !== null) {
      currentKey = pair[1] ?? null
      const value = cleanScalar(pair[2] ?? "")
      if (currentKey !== null) {
        result[currentKey] = value === "" ? [] : value
      }
    }
  }
  return result
}

function cleanScalar(value: string): string {
  const v = value.trim()
  if (v.length >= 2) {
    const first = v[0]
    const last = v[v.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1)
    }
  }
  return v
}

/** 单值取第一个元素；数组原样返回；缺省返回 undefined */
export function asString(fm: Frontmatter, key: string): string | undefined {
  const v = fm[key]
  if (v === undefined) return undefined
  if (Array.isArray(v)) return v[0]
  return typeof v === "string" ? v : undefined
}

export function asArray(fm: Frontmatter, key: string): ReadonlyArray<string> {
  const v = fm[key]
  if (v === undefined) return []
  if (Array.isArray(v)) return v
  return typeof v === "string" ? [v] : []
}
