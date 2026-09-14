# baptisteArno/typebot.io

> 10,318★ · Effect 深度 **L4** · Effect 渗透度 **20.5%**
> 全仓扫描：2,137 个文件，其中 **53 个** `import` 了 effect · 命中 **13 项**能力
> 依赖：`effect` `@effect/platform-bun` `@effect/sql-pg` `@effect/opentelemetry`

## What does it do?

开源对话式应用（chatbot/表单）构建器 —— **一个真实产品，不是框架**。

## Why Effect?

它回答了一个比"Agent 框架"更普遍的问题：**一个普通产品在什么地方会真的需要 Effect？**

证据指向**数据层与可观测**，而不是"调 LLM"：

- `@effect/sql-pg`：数据库访问建模成 Effect（事务、连接生命周期、类型化错误）；
- `@effect/opentelemetry`：链路追踪是**默认装配**而不是事后补；
- `@effect/platform-bun`：运行时形态。

## 证据文件

```
apps/builder/src/features/results/api/handleStreamExportJob.ts
apps/builder/src/features/results/api/handleTriggerSendExportResultsToEmail.ts
apps/builder/src/features/folders/components/FolderContent.tsx
apps/builder/src/features/workspace/components/PeopleList.tsx
packages/auth/...  packages/config/...
```

**注意最后四个里的 `components/*.tsx`**：Effect 出现在 **UI 组件**里 ——
说明它不是被隔离在"后端服务"里，而是被当作数据获取/状态的一致抽象贯穿到了前端。

## Production Signals

真实产品（有定价与托管版）、monorepo（`apps/builder` + `apps/workflows` + `packages/*`）、活跃开发。

## Key Takeaways

1. **"Effect 只在后端"是误解**：这个项目把 Effect 用进了 React 组件的数据层；
2. 对本站内容策略的含义：**"用 Effect 做产品"的教程（数据层 + 可观测 + 前端数据获取）比"用 Effect 写 Agent"覆盖面大得多**；
3. 13 项能力命中说明 L4 的门槛（≥4 项 + 服务/资源/流）是能被真实项目自然满足的，不是我们放宽了标准。
