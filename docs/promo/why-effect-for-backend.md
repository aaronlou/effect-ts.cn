# TypeScript 后端那些你自己手写的样板，Effect 一次性收掉

先看一段代码。我几乎可以肯定你写过它的某个版本——**调一个外部接口、存库、带重试和超时**：

```ts
interface User { readonly id: string; readonly name: string }
type Result<T> = { ok: true; value: T } | { ok: false; error: Error }

export async function fetchUser(id: string, deps: Deps): Promise<Result<User>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  let lastError: Error | undefined
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await deps.http.get(`/users/${id}`, { signal: controller.signal })
        if (!res.ok) throw new HttpError(String(res.status))
        const user = await res.json()
        await deps.db.save(user)
        deps.log.info("saved", { id })
        return { ok: true, value: user }
      } catch (cause) {
        lastError = cause as Error
        await new Promise((r) => setTimeout(r, 2 ** attempt * 100))
      }
    }
    return { ok: false, error: lastError ?? new Error("unknown") }
  } finally {
    clearTimeout(timer)
  }
}
```

（`Deps` 是你项目里那个依赖对象——http 客户端、数据库、logger；`HttpError` 是你自己那个错误类。细节不重要，看形状就行。）

这段代码**没有任何问题**。它是我会写、你也会写的代码。我们来看的只是它的比例。

---

## 数一数：这里面有多少行是业务逻辑

业务逻辑只有四行：

1. 请求 `/users/${id}`
2. 解析 JSON
3. 存库
4. 记一条日志

**剩下的全是搬运工**：`AbortController` 加 `setTimeout` 拼出来的超时、手写的重试循环加指数退避、两层 `try/catch`、`Result` 类型的包装和解包、`deps` 手动往下传。

这不是"代码写得不好"。**这是把运行时的关注点，用运行时的手段解决**——而 TypeScript 的类型系统在这些东西面前是瞎的。

## 问题的根子

看这个签名：

```ts
function fetchUser(id: string, deps: Deps): Promise<Result<User>>
```

调用它的人，能从中看出什么？

- 它**会不会失败**？看不出来。`Result<T>` 说了"可能失败"，但失败成什么样、有哪几种，全靠读实现。
- 它**需要什么依赖**？`Deps` 是个大对象，里面有什么得点进去看。
- 它**有超时吗**？看不出来。
- 它**重试几次**？看不出来。

所以每个项目都要把这些东西**各写一套**，而且写得都不一样。换个人接手，第一件事是把实现读一遍——因为**类型没告诉他任何事**。

这就是为什么"换个项目就要重新学一遍"。

**你可能会说：我们项目里有 `withRetry`、`withTimeout` 的封装，没这么难看。**

对，那些封装确实省掉了重复的代码。但它们省不掉**类型上的空白**。看一个典型封装的签名：

```ts
function withRetry<T>(fn: () => Promise<T>, times: number): Promise<T>
```

调用方从 `Promise<T>` 里还是看不出：它会失败成哪几种、失败时抛的是什么、有没有超时。**封装解决的是"代码重复"，没解决"类型不表达"**——而后者才是换个人接手就得重读实现的原因。

Effect 做的事情更彻底一点：它把这些信息**放进类型本身**，所以封装与不封装都不影响调用方能看到什么。

## Effect 的做法：把它们搬进类型

（一句话说明：Effect 是 TypeScript 的一个库，它把这些"运行时关注点"变成类型上的信息，让编译器替你检查。它不管 HTTP、不管数据库，只管**失败、依赖、并发、资源**这四件事怎么被表达。）

同一件事，用 Effect 写：

```ts
import { Context, Data, Duration, Effect, Schedule, type Cause } from "effect"

// 错误类用 Effect 的约定定义（为什么必须这样，见文末「怎么开始」一节）
export class HttpError extends Data.TaggedError("HttpError")<{ readonly status: number }> {}
export class DbError extends Data.TaggedError("DbError")<{ readonly table: string }> {}

export const fetchUser = (id: string): Effect.Effect<
  User,                                          // 成功时给你什么
  HttpError | DbError | TimeoutException,        // 它可能怎么失败
  HttpClient | Database | Logger                 // 跑它之前必须提供什么
> =>
  Effect.gen(function* () {
    const http = yield* HttpClient
    const db = yield* Database
    const log = yield* Logger

    const res = yield* http.get(`/users/${id}`)
    const user = yield* res.json
    yield* db.save(user)
    yield* log.info("saved", { id })
    return user
  }).pipe(
    Effect.retry(Schedule.exponential(Duration.millis(100)).pipe(Schedule.compose(Schedule.recurs(3)))),
    Effect.timeout(Duration.seconds(3))
  )
```

**上面那个签名不是我编的，是编译器会检查的**（这段代码可以编译通过，签名里的每个类型都对得上）。三个类型参数分别是什么，见[《Effect 类型》](https://effect-ts.cn/docs/v4/getting-started/the-effect-type/)；`yield*` 那套写法见[《使用 Generator》](https://effect-ts.cn/docs/v4/getting-started/using-generators/)。

对比一下这两段：

| | 手写版 | Effect 版 |
| --- | --- | --- |
| 业务逻辑 | 4 行 | 6 行 |
| 搬运工 | 约 25 行 | **0 行** |
| 超时 | 手拼 `AbortController` | `.pipe(...)` + [Effect.timeout](https://effect-ts.cn/docs/v4/error-management/timing-out/) |
| 重试 + 退避 | 手写循环 | `.pipe(...)` + [Effect.retry](https://effect-ts.cn/docs/v4/error-management/retrying/) |
| 错误有几类 | 类型上看不出来 | **写在签名里** |
| 需要什么依赖 | `Deps` 大对象 | **写在签名里** |
| 漏掉依赖 | 运行时才发现 | **编译不过** |

## 三个"编译器会替你记住"的地方

这才是重点。上面那些省下来的行数只是方便，真正不一样的是**下面这三件事会变成编译错误**：

**① 忘了处理某种失败 → 编译不过**

```ts
// 我声明它「不会失败」
const p: Effect.Effect<User, never, never> = fetchUser("1")
```

```
error TS2322: Type 'Effect<User, HttpError | DbError | TimeoutException, HttpClient | Database | Logger>'
  is not assignable to type 'Effect<User, never, never>'.
  Type 'HttpError | DbError | TimeoutException' is not assignable to type 'never'.
```

你**没法假装它会失败的方式比实际少**。手写版里，`Result<T>` 只说了"可能失败"；这里编译器把**具体哪几种**摆在你面前。

**② 忘了提供依赖 → 编译不过**

```ts
export const run = Effect.runPromise(fetchUser("1"))
```

```
error TS2345: Argument of type 'Effect<User, DbError | TimeoutException, HttpClient | Database | Logger>'
  is not assignable to parameter of type 'Effect<User, DbError | TimeoutException, never>'.
  Type 'HttpClient | Database | Logger' is not assignable to type 'never'.
    Type 'HttpClient' is not assignable to type 'never'.
```

`runPromise` 只接受"不需要任何依赖"的 Effect。所以**你不可能忘记注入 `Database`**——忘不掉，编译期就拦住了。手写版里，`deps` 少传一个字段是在运行时炸的。

依赖是怎么提供的、为什么要用 Layer，见[《管理 Layer》](https://effect-ts.cn/docs/v4/requirements-management/layers/)；`runPromise` 所在的程序边界见[《运行 Effect》](https://effect-ts.cn/docs/v4/getting-started/running-effects/)。

**③ 错误类型是签名的一部分，所以它不会悄悄消失**

`HttpError`、`DbError`、`TimeoutException` 都在类型里。任何一个处理分支写错，编译器都会指出来。

---

## 代价，我也说清楚

上面这些听起来很美好，所以更要说清楚它不适合什么：

- **不好学。** 概念多（`Effect`、`Layer`、`Fiber`、`Scope`、`Schedule`……），一开始写得别扭，**报错也看不懂**——因为报错默认你已经知道 `Effect<A, E, R>` 这三个位置是什么。
- **写小脚本完全不值得。** 一个 200 行的爬虫用 Effect，是给自己找麻烦。
- **只有上面那四件事真的变成主要成本时，它才开始回本。** 项目大了、人多了、要长期维护了、错误处理的正确性有要求了——这时候它才开始赚。

**如果只是想做个小工具，请用你顺手的方式。** 这不是客套话：Effect 的抽象是有成本的，用在它不划算的地方，是双输。

## 什么样的情况值得考虑

| 适合 | 不适合 |
| --- | --- |
| 服务要长期维护，会换人接手 | 一次性的脚本、原型 |
| 错误处理要求高（钱、订单、权限） | 内部小工具 |
| 依赖多（数据库、缓存、外部 API、队列） | 单文件、无外部依赖 |
| 需要并发、重试、超时、取消 | 简单的 CRUD |
| 团队多人协作 | 只有你一个人且项目三个月就结束 |

一个粗略的判断：**如果你发现自己在第三个项目里又写了一遍重试函数，那就是可以看看 Effect 的时候了。**

## 怎么开始（别一上来就重写项目）

先装上（只有一个包，没有 tsconfig 插件要配）：

```bash
npm i effect
```

最实际的第一步：**找一个纯函数**——一个会失败、可能有依赖的独立函数——用 Effect 重写它，然后在**程序的边界**（HTTP handler / CLI 入口）用 `Effect.runPromise` 跑起来。

就这样。不要碰框架、不要动整个项目的架构。先让一个函数跑通，感受一下"类型里写着它会怎么失败"是什么体验。

**一个一定要记住的实践**：错误类用 `Data.TaggedError` 定义，不要写 `class X extends Error {}`。

```ts
import { Data } from "effect"

// ✘ 结构上与别的错误类完全相同
class HttpError extends Error {}
class DbError extends Error {}

// ✔ 带 _tag 判别字段
class HttpError extends Data.TaggedError("HttpError")<{ readonly status: number }> {}
class DbError extends Data.TaggedError("DbError")<{ readonly table: string }> {}
```

理由是实测的：**两个没有各自字段的错误类是"结构相同"的类型**，TypeScript 在联合类型里会把它们去掉一个——`HttpError | DbError` 会退化成其中一个，于是你既看不到完整的失败类型，也用不了 `Effect.catchTag` 按标签精确收窄。

```ts
// 用 Data.TaggedError 之后，收窄是可靠的：
Effect.catchTag(p, "HttpError", (e) => Effect.log(String(e.status)))
// 类型：Effect<void, DbError, never>   ← HttpError 被精确移除
```

这是 Effect 自己的约定，不是额外规矩。

**另外建议把 `Effect.gen` 的返回类型显式写出来**：

```ts
export const fetchUser = (id: string): Effect.Effect<User, HttpError | DbError, HttpClient> =>
  Effect.gen(function* () { /* ... */ })
```

不是为了绕过什么推断问题——推断是对的——而是因为**这个签名就是这个函数最重要的一句文档**，写出来别人不用点进实现。

---

## 一句话总结

手写版把"会不会失败、需要什么依赖、超时几次"放在**实现里**，只有读过代码的人知道。
Effect 版把它们放在**类型里**，编译器帮你记着。

省下那 25 行搬运工只是顺带的好处。**真正值钱的是：那些你以前只能在 code review 时靠人眼发现的东西，现在编译器会替你拦下来。**

---

> 文中链接指向的是 [effect-ts.cn](https://effect-ts.cn/) —— 官方文档的中文译文，共 234 页（v3 + v4），[《创建 Effect》](https://effect-ts.cn/docs/v4/getting-started/creating-effects/) 这类入门页都在。每页标注了翻译时对照的上游版本。
>
> 站点是非官方社区站。有问题欢迎 [提 issue](https://github.com/aaronlou/effect-ts.cn/issues)。
