/**
 * 极简 frontmatter 解析（本站 frontmatter 是受控的 yaml 子集）：
 *   key: scalar
 *   key: [a, b]            # 行内数组
 *   key:
 *     - item1
 *     - item2
 *   parent:
 *     child: value         # 一层嵌套 → 产出 "parent.child" 键
 * 足够支撑译文状态扫描与官方侧边栏元数据（sidebar.order/label/hidden）。
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

function parseValue(value: string): string | ReadonlyArray<string> {
  const v = value.trim()
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim()
    if (inner === "") return []
    return inner.split(",").map((item) => cleanScalar(item))
  }
  return cleanScalar(v)
}

function parseBlock(block: string): Frontmatter {
  const result: Frontmatter = {}
  let currentKey: string | null = null

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "")
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue

    // 列表项（归属于最近的顶层 key）
    const listItem = /^-\s+(.*)$/.exec(line.trimStart())
    if (listItem !== null) {
      if (currentKey !== null) {
        const prev = result[currentKey]
        const value = cleanScalar(listItem[1] ?? "")
        result[currentKey] = Array.isArray(prev) ? [...prev, value] : [value]
      }
      continue
    }

    // 顶层 key
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (pair !== null) {
      const key = pair[1] ?? null
      currentKey = key
      const value = (pair[2] ?? "").trim()
      if (key !== null) {
        result[key] = value === "" ? [] : parseValue(value)
      }
      continue
    }

    // 一层嵌套：parent.child
    const nested = /^\s+([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (nested !== null && currentKey !== null) {
      result[`${currentKey}.${nested[1]}`] = parseValue(nested[2] ?? "")
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

/** 单值取第一个元素；数组取首个；缺省返回 undefined */
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

export function asNumber(fm: Frontmatter, key: string): number | undefined {
  const v = asString(fm, key)
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function asBoolean(fm: Frontmatter, key: string): boolean | undefined {
  const v = asString(fm, key)
  if (v === undefined) return undefined
  if (v === "true") return true
  if (v === "false") return false
  return undefined
}
