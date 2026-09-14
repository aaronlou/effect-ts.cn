/**
 * 极简 CSV 行解析（**只给测试用**）。
 *
 * 为什么必须有：`dataset.csv` 的 `description` 列里有逗号与引号，
 * 用 `line.split(",")` 解析会**静默错位** —— 测试会因此报出"数据有问题"，
 * 而实际上是测试自己的解析错了（第一次写这条断言时就踩了）。
 */
export const splitCsv = (line: string): ReadonlyArray<string> => {
  const fields: Array<string> = []
  let current = ""
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else current += char
    } else if (char === '"') {
      quoted = true
    } else if (char === ",") {
      fields.push(current)
      current = ""
    } else current += char
  }
  fields.push(current)
  return fields
}
