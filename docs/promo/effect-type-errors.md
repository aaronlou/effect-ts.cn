# Effect 的类型报错怎么读：认全 `Effect<A, E, R>` 这三个位置，一半报错自己就解释了

你照着官方文档写完一段 Effect 代码，按下保存，编辑器弹出这么一段：

```
src/app.ts(10,38): error TS2345: Argument of type 'Effect<string, never, Config | Logger | Db | Cache>'
  is not assignable to parameter of type 'Effect<string, never, never>'.
  Type 'Config | Logger | Db | Cache' is not assignable to type 'never'.
    Type 'Config' is not assignable to type 'never'.
```

你的第一反应大概是：**行，它说我的类型不对。然后呢？**

我卡在这一步很久。后来才明白：这段话里的每个词我都认识，但**那个尖括号里的三个位置我从来没搞清楚过**。搞清楚之后，大部分 Effect 报错不需要查资料就能自己解释一半。

这篇把那三个位置讲透，然后拿 5 个**真实的报错**逐条拆给你看。

（如果你还不知道 Effect 是什么：它是 TypeScript 的一个 effect system 库，把「可能失败、需要依赖、异步并发」这些东西全部收进类型里。这篇不介绍它本身，只讲怎么读它的报错——所以下面默认你已经动手写过一点了。）

---

## 先破除一个误解：报错其实不长

你可能听过"Effect 的报错又长又难读，能刷三屏"。我自己也一直这么以为，直到为了写这篇真的跑了一遍。

我写了 11 段会编译失败的 Effect 代码，用 `tsc --strict` 跑出真实报错，量了一下：

| 典型错误 | 输出行数 | 字符数 |
| --- | --- | --- |
| 把 Effect 当普通值做运算 | 1 | 159 |
| 忘了 `yield*` | 1 | 136 |
| `flatMap` 回调返回了普通值 | 1 | 137 |
| 把 `Stream` 当 `Effect` | 1 | 158 |
| `pipe` 中间某步类型不对 | 1 | 128 |
| 声明类型与实际不符 | 2 | 203 |
| `runPromise` 时缺一个依赖 | 2 | 221 |
| Layer 少提供一个依赖 | 2 | 225 |
| `runPromise` 时缺四个依赖 | 3 | 287 |
| **最长的一条**（完全没提供依赖） | **3** | **315** |

**最长 3 行、315 个字符；11 个样本里有一半以上只有 1 行。**

所以"Effect 报错刷三屏"多半是 Effect 2.x 时代的印象。现在的 TypeScript 推理和 Effect 3.x 的报错质量都比那时好得多。（当然，真实工程里堆了多层 Layer、Schema、Platform 之后，报错会比这长——但那是**类型本身复杂**，不是 Effect 在乱喷。）

**它真正的问题是另一件事：它默认你已经知道 `Effect<A, E, R>` 是什么。** 你不认识那三个位置，它就只是一串噪音。

那就先把这三个位置认全。

---

## 核心：`Effect<成功, 失败, 依赖>`

```ts
Effect<A, E, R>
```

| 位置 | 含义 | 你要问自己的问题 |
| --- | --- | --- |
| **A** | 成功时产出的值 | 「这段代码跑成功了，给我什么？」 |
| **E** | 失败时的错误类型 | 「它可能怎么失败？」 |
| **R** | 完成它需要的依赖 | 「跑它之前，我得先提供什么？」 |

举例，一眼看懂：

```ts
Effect<number, never, never>          // 成功给 number；不会失败；不需要任何依赖
Effect<User, Error, never>            // 成功给 User；可能抛 Error；不需要依赖
Effect<string, never, Database>       // 成功给 string；不会失败；但需要 Database
Effect<number, never, Config | Log>   // 需要 Config 或 Log（联合类型）
```

**读报错时，90% 的情况你只需要盯住 A 和 R：**

- **A 不匹配** → 你的值类型错了（最常见，也最好修）
- **R 不是 `never`** → 依赖还没提供，这种报错通常在 `runPromise` 那一行炸

还有一个必须记住的：**`never` 不是"错误"，是"空的"。**

- `E = never` 意思是「这段代码不会失败」
- `R = never` 意思是「它不需要任何依赖，可以直接跑」

`runPromise` 只接受 `R = never` 的 Effect，就是这个道理——它得能独立跑起来。

---

## 实战：5 个真实报错逐条拆

下面每一条都是我真实跑出来的输出，不是我编的。

### ① 把 Effect 当普通值做运算

```ts
const program: Effect.Effect<number> = Effect.succeed(42)
export const doubled = program * 2
```

```
error TS2362: The left-hand side of an arithmetic operation must be of type
'any', 'number', 'bigint' or an enum type.
```

**怎么读**：算术运算的左边得是数字。你给的是 `Effect<number, never, never>`——**它是一段"描述"，不是一个数字**。

这是新手第一个坎：`Effect.succeed(42)` 不会立刻给你 42，它给的是一段**还没运行的描述**。这就是 Effect 说的"惰性"。

**怎么修**：要么在程序边界用 `Effect.runPromise` 跑起来，要么用 `Effect.map` 在 Effect 内部做运算：

```ts
const doubled = Effect.map(program, (n) => n * 2)   // Effect<number, never, never>
```

📖 [《Effect 类型》](https://effect-ts.cn/docs/v4/getting-started/the-effect-type/) · [《创建 Effect》](https://effect-ts.cn/docs/v4/getting-started/creating-effects/)

---

### ② 声明类型和实际不符

```ts
const program = Effect.gen(function* () { return yield* Effect.succeed("done") })
export const wrong: Effect.Effect<number, never, never> = program
```

```
error TS2322: Type 'Effect<string, never, never>' is not assignable to type 'Effect<number, never, never>'.
  Type 'string' is not assignable to type 'number'.
```

**怎么读**：这是**最友好的一类报错**，因为它自己把问题说清楚了——第二行直接告诉你 A 位置对不上。

把两个类型对齐看：

| | A | E | R |
| --- | --- | --- | --- |
| 你给的 `Effect<string, never, never>` | **string** | never | never |
| 它要的 `Effect<number, never, never>` | **number** | never | never |

**只有第一栏不一样。** 这种报错扫一眼 A 就够了。

📖 [《使用 Generator》](https://effect-ts.cn/docs/v4/getting-started/using-generators/)

---

### ③ 最长也最常见的一条：`runPromise` 时缺少依赖

```ts
const handler = Effect.gen(function* () {
  const db = yield* Db
  const cache = yield* Cache
  const log = yield* Logger
  const cfg = yield* Config
  // ...
})
export const run = Effect.runPromise(handler)   // ← 这里炸
```

```
error TS2345: Argument of type 'Effect<string, never, Config | Logger | Db | Cache>'
  is not assignable to parameter of type 'Effect<string, never, never>'.
  Type 'Config | Logger | Db | Cache' is not assignable to type 'never'.
    Type 'Config' is not assignable to type 'never'.
```

**怎么读**：这条看着最吓人，其实**信息量最大**。逐行拆（下面为方便阅读做了折行，真实输出是 3 行）：

| 它在说什么 | 你怎么理解 |
| --- | --- |
| `Effect<string, never, Config \| Logger \| Db \| Cache>` | 你这段代码**还需要这四个依赖** |
| `parameter of type 'Effect<string, never, never>'` | 但 `runPromise` 只接受**不需要任何依赖**的 |
| `'Config \| Logger \| Db \| Cache' is not assignable to 'never'` | 把上面那件事换句话说 |
| `'Config' is not assignable to 'never'` | 挑出第一个，告诉你最少缺 `Config` |

**A 和 E 两边完全一样，只有第三栏 R 不同。** 所以这一整坨其实只在说一句话：**你还没提供 `Config`、`Logger`、`Db`、`Cache`。**

**怎么修**：把它们补进 Layer，再 `Effect.provide`：

```ts
const AppLive = Layer.mergeAll(ConfigLive, LoggerLive, DbLive, CacheLive)
export const run = Effect.runPromise(Effect.provide(handler, AppLive))
```

这条报错值得单独记住：它出现频率远高于其它几条，而且行数最多、最容易被吓退——**理解了就发现它其实是最直白的一条。**

📖 [《管理 Layer》](https://effect-ts.cn/docs/v4/requirements-management/layers/) · [《运行 Effect》](https://effect-ts.cn/docs/v4/getting-started/running-effects/)

---

### ④ 把 `Stream` 当 `Effect`

```ts
export const program = Effect.gen(function* () { return yield* Stream.make(1, 2, 3) })
```

```
error TS2488: Type 'Stream<number, never, never>' must have a '[Symbol.iterator]()'
method that returns an iterator.
```

**怎么读**：`yield*` 会去调 `[Symbol.iterator]`，而 `Stream` 没有——它既不是可迭代对象，也不是 Effect。

关键是**看类型名的第一个词**：是 `Stream<...>` 而不是 `Effect<...>`。它们结构一样（同样三个参数），但是两个东西：

- `Effect<A, E, R>` —— **一个**值，跑一次
- `Stream<A, E, R>` —— **一串**值，可能持续不断

**怎么修**：用 `Stream.runCollect` / `Stream.runHead` 把 Stream 收敛成单个 Effect，或者改用 `Effect.forEach` 处理数组。

📖 [《Stream 简介》](https://effect-ts.cn/docs/v4/stream/introduction/)

---

### ⑤ `flatMap` 的回调必须返回 Effect

```ts
export const program = Effect.flatMap(Effect.succeed(1), (n) => n + 1)
```

```
error TS2322: Type 'number' is not assignable to type 'Effect<unknown, unknown, unknown>'.
```

**怎么读**：注意右边那三个 `unknown`——**这不是"未知类型"，是"推不出来"**。TypeScript 在它无法推断的地方会填 `unknown` 当占位符。

它在说：`flatMap` 的回调要返回一个 Effect，你返回了 `number`。

**这里也是新手最容易混的一处**：

- `Effect.map(f)`：`f` 返回**普通值**，Effect 自动帮你包起来
- `Effect.flatMap(f)`：`f` 必须**自己返回 Effect**

**怎么修**：

```ts
Effect.flatMap(Effect.succeed(1), (n) => Effect.succeed(n + 1))
```

📖 [《创建 Effect》](https://effect-ts.cn/docs/v4/getting-started/creating-effects/)

---

## 一个真正有用的技巧：依赖是从哪一步进来的？

这是我读完这些报错后最想分享的一条。

`runPromise` 的报错只告诉你**总共缺什么**（`Cache | Logger`），**不告诉你哪一步引入的**。链路一长，你就得从头找。

看这段 6 步的管道：

```ts
export const program = pipe(
  Effect.succeed(1),
  Effect.map(String),
  Effect.flatMap((k) => needsCache(k)),      // ← 引入 Cache
  Effect.map((v) => v ?? "miss"),
  Effect.flatMap((m) => needsLogger(m)),     // ← 引入 Logger
  Effect.map((s) => s.length)
)
export const run = Effect.runPromise(program)
```

报错只说到 `R = Cache | Logger` 为止。

**解法：把链路切成几段，每段写清它应该是什么类型。**

```ts
const step1: Effect.Effect<string, never, never>          = pipe(Effect.succeed(1), Effect.map(String))
const step2: Effect.Effect<string | null, never, Cache>   = Effect.flatMap(step1, needsCache)
const step3: Effect.Effect<string, never, Cache>          = Effect.map(step2, (v) => v ?? "miss")
const step4: Effect.Effect<string, never, Cache | Logger> = Effect.flatMap(step3, needsLogger)
```

看出来了吗——**R 那一栏是逐步累积的**：`never` → `Cache` → `Cache | Logger`。哪一步开始多出一个依赖，一目了然。

如果某一步你标错了，报错会**立刻指到那一行**。把上面那行 `step3` 故意改成以为「没有依赖」：

```ts
// 与上一段唯一的区别：第三栏从 Cache 改成了 never（错误标注）
const step3: Effect.Effect<string, never, never> = Effect.map(step2, (v) => v ?? "miss")
```

```
error TS2322: Type 'Effect<string, never, Cache>' is not assignable to type 'Effect<string, never, never>'.
  Type 'Cache' is not assignable to type 'never'.
```

**报错从 `runPromise` 那行挪到了 `step3` 这一行**，直接告诉你 `Cache` 是从这步进来的。这比在一百行之后读一个联合类型快得多。

---

## 三个看起来吓人、其实无害的东西

**1. `never` 不是错误。** `E = never` 是"不会失败"，`R = never` 是"不需要依赖"。看到它不要紧张。

**2. 报错里出现 `Effect.ts`、`Layer.ts` 这类文件名，不是你代码的问题。** 那是库内部的路径，只说明类型检查走到了库里面，你不需要去看那些文件。

**3. `unknown` 常常只是占位符。** 在 `Effect<unknown, unknown, unknown>` 里它表示"推不出来"，不是"这里真的是 unknown 类型"。通常是回调返回值形状不对，导致整条推断链断掉了。

---

## 小结

- `Effect<A, E, R>`：**成功值 / 错误类型 / 需要的依赖**
- 报错**不匹配 A** → 值类型错了
- 报错里 **R 不是 `never`** → 依赖还没提供（通常在 `runPromise` 那行炸）
- `never` = "空的"，不是"错误"
- 把长链路切成几段、每段标注类型 → 报错会挪到真正出错的那一步

说句实话：Effect 的学习曲线确实陡，但**陡的地方不在于概念有多难，而在于报错默认你已经懂了**。那三个位置一旦认全，你从"看不懂报错"到"能猜出问题"之间的距离，比想象中短得多。

---

> 上面每条报错对应的中文文档，都在 [effect-ts.cn](https://effect-ts.cn/) —— 官方文档的中文译文（v3 + v4 共 234 页，每页标注翻译时对照的上游 commit）。
>
> 如果你正卡着一段报错，也可以直接贴到 [报错诊断](https://effect-ts.cn/debug/)：它会提取报错里的 API 名与类型名，定位到相关的中文文档小节，并给出**可点回原文的引用**。**说清它的边界**：报错里出现具体 API（如 `Effect.runPromise`、`Layer.succeed`）时定位较准；如果报错里只有类型名、没有任何 API 调用，目前定位还不理想——那种情况用上面这套"读三个位置"的方法更管用。
>
> 我还在把这些高频报错整理成一份可检索的 [报错百科](https://effect-ts.cn/errors/)，目前条目很少，慢慢来。
>
> 站点是非官方的，有问题欢迎到 [GitHub 提 issue](https://github.com/aaronlou/effect-ts.cn/issues)。
>
> 如果这篇帮你少花了半小时，收藏一下就行 —— 下次再撞上这种报错，你多半会想回来对一眼。
