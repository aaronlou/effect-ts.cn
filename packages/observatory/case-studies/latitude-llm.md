# latitude-dev/latitude-llm

> 4,642★ · Effect 深度 **L4** · Effect 渗透度 **79.6%**（全仓最高之一）
> 全仓扫描：4,648 个文件，其中 **1,115 个**真的 `import` 了 effect · 命中 **9 项**能力
> 依赖：`effect` `@effect/opentelemetry`

## What does it do?

LLM 应用的观测与评测平台（把 prompt / 会话 / 评测跑在一条可追溯的链路上）。

## Why Effect？

这个项目的渗透度是本次调查里最高的（79.6%），而且它的用法集中在**服务端中间件**：

```
apps/api/src/middleware/auth.ts
apps/api/src/middleware/organization-context.ts
apps/api/src/middleware/partner-auth.ts
apps/api/src/middleware/touch-buffer.ts
```

中间件是"每个请求都要穿过、且必须显式声明依赖"的地方 —— 恰好是 Effect 的
`Layer` + `Context` 最擅长、而 Express/Koa 中间件最难做对的地方
（依赖靠挂载顺序隐式传递，测起来要起整个 app）。

配套能力命中：服务与依赖注入、类型化错误、并发原语、Scope、可观测性、集群与工作流。

## 与 opencode 的对比：同一种选择，不同的动机

| | opencode | latitude-llm |
| --- | --- | --- |
| 渗透度 | 52.5% | **79.6%** |
| 用 Effect 解决的核心问题 | Agent 执行模型（工具/会话/取消） | 请求级依赖与可观测（中间件、追踪） |
| 共同点 | **都把 Effect 放在"每个请求/每个任务都要穿过"的那一层** | |

两个项目规模与领域都不同，却做了同一个结构选择：
**把 Effect 放在横切层（runtime / middleware），而不是放在某个业务模块里。**
这解释了为什么 L4 的占比（23/33）远高于 L2/L3 —— 一旦把 Effect 放到横切层，它就会自然扩散到全仓。

## Production Signals

有 open-source 与托管版、monorepo（`apps/api` + `apps/web` + `packages/*`）、活跃开发、有 CI 与测试。

## Key Takeaways

1. **79.6% 的渗透度**说明效果不是来自"用了 Effect 的某个 API"，而是来自**结构性选择**；
2. 对采用者的建议：如果只打算在一个模块里试 Effect，收益接近"用了一个库"；
   把它放到中间件/runtime 这一层，才会拿到取消、依赖注入与可观测的复利；
3. 这是本站内容策略的又一个印证：**中文世界缺的是"Effect 怎么用在横切层"的实操**，
   而不是又一篇 `Effect.gen` 入门。
