# anomalyco/opencode

> 207,170★ · Effect 深度 **L4** · Effect 渗透度 **52.5%**（主体包里一半运行时依赖 effect）
> 全仓扫描：3,271 个 `.ts` 文件，其中 **950 个**真的 `import` 了 effect · 命中 **14 项** Effect 能力
> 依赖：`effect` `@effect/platform-node` `@effect/sql-sqlite-bun` `@effect/opentelemetry`

## What does it do?

终端里的编码 Agent（coding agent）：读代码、改代码、跑命令，带一套工具系统与会话状态。

## Why Effect?

**因为这个项目的核心难点根本不是"调 LLM"，而是：**

- **一次会话里并发跑多个子任务**（工具调用、文件监听、子会话），要能隔离失败、能取消；
- **进程与资源的生命周期**（子进程、SQLite 连接、文件句柄）必须在取消/异常时也释放；
- **会话状态要事务化**（编辑中途失败不能留下半截状态）；
- **多 provider、多模型**要在同一套抽象下替换（依赖注入）。

这四件事恰好是 Effect 的主场，也解释了它为什么是 L4 而不是 L2：**Agent 的执行模型直接建立在 Effect 上。**

## Agent Loop：Agent 本身就是一个 Effect Service

`packages/core/src/agent.ts`（原文节选）：

```ts
import { Array, Context, Effect, Layer, Types } from "effect"

export interface Interface extends State.Transformable<Draft> {
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  readonly resolve: (id?: ID | string) => Effect.Effect<Info | undefined>
  readonly select: (id?: ID | string) => Effect.Effect<Selection>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Agent") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = State.create<Data, Draft>({ ... })
    ...
  })
)
```

三件事同时发生：**接口用 `Effect.Effect` 描述**（含失败与依赖）、**实现用 `Layer.effect` 装配**、
**状态用 `State` 事务化**。Agent 在这里不是"一个循环"，而是一个可以注入、可以替换、可以被取消的服务。

## Tool System：Schema 既是校验器又是给 LLM 的工具描述

`packages/core/src/tool/bash.ts`（原文节选）：

```ts
import { Duration, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"

export const Input = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.String.pipe(Schema.optional).annotate({
    description: "Working directory. Defaults to the active Location; ...",
  }),
  timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_TIMEOUT_MS)).pipe(Schema.optional).annotate({
    description: `Timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS} ...`,
  }),
})

const Output = Schema.Struct({
  exit: Schema.Number.pipe(Schema.optional),
  truncated: Schema.Boolean,
  timeout: Schema.Boolean.pipe(Schema.optional),
  output: Schema.String,
  warnings: Schema.Array(Schema.String).pipe(Schema.optional),
})
```

**这是"Tool Input/Output → Schema"最干净的实现**：同一份 `Schema.Struct` 同时承担
①运行时校验、②类型推导、③**生成给模型的工具描述**（`annotate({ description })`）。
漂移风险被结构性消除——改一处，模型看到的说明与运行时校验一起变。

## Effect Usage（能力证据，来自全仓扫描）

| 能力 | 证据 |
| --- | --- |
| 服务与依赖注入 | `Context.Service` + `Layer.effect`（`packages/core/src/agent.ts`） |
| Schema 校验 | 工具输入输出全量 Schema（`packages/core/src/tool/bash.ts`） |
| Scope 资源管理 | `effect/unstable/process` 的 `ChildProcess`（同上） |
| Stream 流处理 | 会话消息流（`packages/app/src/utils/session-message.ts`） |
| Fiber 与并发 | 子会话与工具并发 |
| 并发原语 | `primitives` 能力命中 |
| 类型化错误 | `ToolFailure` 是**类型化的失败**，不是抛异常 |
| `@effect/sql` | `@effect/sql-sqlite-bun`：会话与消息持久化 |
| 可观测性 | `@effect/opentelemetry` |
| Config | 配置作为 Effect Service |
| HttpApi / platform | `@effect/platform-node` |
| cluster | 工作流/集群能力命中 |

## Production Signals

- 20 万+ star、活跃开发（快照日 180 天内有 push）、多包 monorepo（`packages/*` 20+）；
- 有 release、有测试（3,271 个扫描文件里包含大量 `.spec.ts`）、有桌面端（`packages/app` 是 Electron/Tauri 应用）；
- **同源谱系**：`Kilo-Org/kilocode`、`XiaomiMiMo/MiMo-Code` 的包结构与 opencode 一致（`packages/opencode`/`packages/schema`/`packages/llm`），属于**代码衍生版**而非独立实现。
  不标注这一点，生态会看起来比实际更多样。

## Key Takeaways

1. **它是"Effect 作为 Agent Runtime"的完整样板**：Agent、工具、会话状态、持久化、可观测全在 Effect 的抽象里；
2. **Schema 驱动工具契约**是本项目最值得抄的一处：一份定义，三处受益（校验/类型/模型说明）；
3. 渗透度 52.5% 说明这不是"某个角落用了 Effect"，而是**主体架构选择**。
