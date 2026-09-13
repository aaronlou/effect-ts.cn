/**
 * 报错签名：把一个具体的 TypeScript / Effect 报错，归约成一个**稳定的键**。
 *
 * 为什么需要它：`/debug` 每次都是从零开始诊断，同样的报错被问一千遍就花一千遍钱、
 * 而且什么都没沉淀下来。有了签名才能做三件事：
 *   1. **去重** —— 同一个报错只留一条百科条目，命中即零成本（复用现有答案缓存）；
 *   2. **可链接** —— 每个报错有自己的 URL，能贴给别人、能被搜索到；
 *   3. **可累积** —— 用户问得越多，这份库越厚，这是**唯一一个"用户增长 = 资产增长"的功能**。
 *
 * 全是纯函数（零 I/O），所以它可以被测试钉死 —— 而签名一旦不稳，
 * 要么同一报错裂成一堆条目，要么不同报错被错误合并，两种都会毁掉这个功能。
 */

/** 参与运算的 TypeScript / JS 内置类型：它们出现在几乎每条报错里，不构成任何区分度 */
const BUILTIN_NOISE = new Set([
  "Type", "Object", "String", "Number", "Boolean", "Array", "ReadonlyArray", "Promise",
  "Record", "Partial", "Required", "Readonly", "Pick", "Omit", "Exclude", "Extract",
  "NonNullable", "ReturnType", "Parameters", "Awaited", "InstanceType", "Function",
  "Symbol", "Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet", "Error", "JSON",
  "Iterator", "Iterable", "Generator", "AsyncGenerator", "PropertyKey", "ThisType",
  "Uppercase", "Lowercase", "Capitalize", "Uncapitalize", "TemplateLiteral",
  "ReadonlyMap", "ReadonlySet", "ArrayLike", "CallableFunction", "NewableFunction"
])

/**
 * TypeScript 英文诊断里的高频词。它们会被大写出现在句首，但不是类型名。
 *
 * 为什么必须滤掉：签名要用来**去重**，而这些词会随报错措辞变化 ——
 * `Argument of type 'Effect<A>'` 与 `Type 'Effect<A>' is not assignable` 是同一个问题，
 * 若把 `Argument` / `Type` 计进签名，同一个问题就会裂成两条百科条目。
 */
const MESSAGE_NOISE = new Set([
  "Argument", "Arguments", "Expected", "Actual", "Cannot", "Property", "Properties",
  "Parameter", "Parameters", "Element", "Elements", "Value", "Values", "Index",
  "Signature", "Overload", "Overloads", "Call", "Calls", "The", "This", "That",
  "Missing", "Required", "Assignable", "Assignment", "Declaration", "Declarations",
  "Operator", "Expression", "Expressions", "Constructor", "Method", "Methods",
  "Interface", "Module", "Modules", "Namespace", "Variable", "Constant", "Enum",
  "Class", "Classes", "Member", "Members", "Return", "Yield", "Await", "Async",
  "Conversion", "Comparison", "Condition", "No", "Not", "Only", "Because", "Types",
  "Indexed", "Mapped", "Inferred", "Resolved", "Generic", "Literal", "Union",
  "Intersection", "Tuple", "Keyword", "Modifier", "Accessor", "Getter", "Setter"
])

export interface ErrorSignature {
  /** 稳定短 id：`ts2345-1a2b3c`（用作数据库主键与 URL） */
  readonly id: string
  /** 出现在报错里的 TS 错误码，已排序去重（如 TS2345） */
  readonly codes: readonly string[]
  /** 参与的类型 / API 名，按出现次数排序（如 Effect.gen、Layer、Schema） */
  readonly symbols: readonly string[]
  /**
   * 特征是否足够。
   *
   * **这条闸很重要**：把"我这报错了帮我看看"这种没有任何特征的输入也沉淀成百科条目，
   * 只会把库变成噪声垃圾场。不够特征的就走原有的一次性诊断路径，不落库。
   */
  readonly confident: boolean
}

/** djb2 → base36：与站点其它指纹（selection.ts 的 fingerprintOf）同一套，短且稳定 */
const hash = (input: string): string => {
  let value = 5381
  for (let index = 0; index < input.length; index += 1) {
    value = ((value << 5) + value + input.charCodeAt(index)) | 0
  }
  return (value >>> 0).toString(36)
}

/**
 * 抹掉"同一报错在不同机器上必然不同"的部分。
 *
 * 实测要处理的四类噪声：
 * - **绝对路径**：`/Users/alice/proj/node_modules/effect/...` 与 `/home/bob/...` 是同一个报错；
 * - **行列号**：`:12:34` 会随文件改动漂移；
 * - **堆栈帧**：`at foo (/path/x.ts:1:2)` 与报错本身无关；
 * - **Windows 路径**：`C:\proj\...`。
 */
export function normalizeErrorText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    // Windows 绝对路径
    .replace(/\b[A-Za-z]:\\[^\s:)]+/g, "<file>")
    // POSIX 绝对路径（至少两层目录，且像源码文件）；后面可能跟 :line:col
    .replace(/\/(?:[^\s/()]+\/){2,}[^\s/():]*\.(?:tsx?|mts?|cts?|jsx?|mjs|cjs)(?::\d+(?::\d+)?)?/g, "<file>")
    // 裸露的 :行:列
    .replace(/:\d+:\d+/g, "")
    // 堆栈帧整行（`    at foo (/x.ts:1:2)` 已被上面的路径规则处理，这里收拾残留）
    .replace(/^\s*at\s+.*$/gm, "")
}

const CODE_PATTERN = /\bTS(\d{4,5})\b/g
/** 限定名（Effect.gen / Context.Tag / Schema.Struct）优先，因为它们区分度最高 */
const QUALIFIED_PATTERN = /\b[A-Z][A-Za-z0-9_]*(?:\.[A-Za-z_$][\w$]*)+\b/g
const CAPITALIZED_PATTERN = /\b[A-Z][A-Za-z0-9_]{1,}\b/g

export function errorSignature(rawError: string, options: { readonly maxSymbols?: number } = {}): ErrorSignature {
  const text = normalizeErrorText(rawError)
  const maxSymbols = options.maxSymbols ?? 6

  const codes = [...new Set([...text.matchAll(CODE_PATTERN)].map((m) => `TS${m[1]}`))].sort()

  // 限定名（Effect.gen）比裸类型名（Effect）更有区分度，先收集并给更高权重
  const frequency = new Map<string, number>()
  const bump = (token: string, weight: number): void => {
    // 限定名同时把根名计入（Effect.gen → 也数一次 Effect），
    // 因为报错里常常混着 `Effect.gen(...)` 与 `Effect<...>` 两种写法
    frequency.set(token, (frequency.get(token) ?? 0) + weight)
  }
  for (const match of text.matchAll(QUALIFIED_PATTERN)) {
    const qualified = match[0]
    bump(qualified, 3)
    bump(qualified.split(".")[0]!, 2)
  }
  for (const match of text.matchAll(CAPITALIZED_PATTERN)) {
    bump(match[0], 1)
  }

  const symbols = [...frequency.entries()]
    // 错误码本身不是符号（它已经单列在 codes 里）
    .filter(([token]) => !/^TS\d+$/.test(token))
    .filter(([token]) => !BUILTIN_NOISE.has(token) && !MESSAGE_NOISE.has(token))
    .filter(([token]) => !BUILTIN_NOISE.has(token.split(".")[0]!) && !MESSAGE_NOISE.has(token.split(".")[0]!))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, maxSymbols)
    .map(([token]) => token)
    .sort()

  const confident = codes.length > 0 || symbols.length >= 2
  const primary = codes[0]?.toLowerCase() ?? "nocode"
  const id = `${primary}-${hash(`${codes.join(",")}|${symbols.join(",")}`)}`

  return { id, codes, symbols, confident }
}

/** 给条目起一个可读标题（列表页用）：`TS2345 · Effect / Layer` */
export function describeSignature(signature: ErrorSignature): string {
  const code = signature.codes[0]
  const names = signature.symbols.filter((s) => !s.includes(".")).slice(0, 3)
  if (code === undefined) return names.join(" · ") || "未识别的报错"
  return names.length === 0 ? code : `${code} · ${names.join(" / ")}`
}
