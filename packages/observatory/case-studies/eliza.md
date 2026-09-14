# elizaOS/eliza —— 反例：19k star，3 个文件

> 19,331★ · Effect 深度 **L2** · Effect 渗透度 **1.3%**
> 全仓扫描：**22,043** 个文件，其中只有 **3 个**真的 `import` 了 effect · 命中 **2 项**能力

## 为什么把它写成案例

**因为"star 高 + 是 Agent + package.json 里有 effect"这三条同时成立时，很容易被算成"Effect Agent"。**
全仓扫描给出的答案是否定的：2.2 万个文件里只有 3 个 import 了 effect，而且集中在两个插件里。

```
plugins/plugin-agent-orchestrator/src/services/smithers-macro-runner.ts
plugins/plugin-agent-orchestrator/src/services/smithers-task-runner.ts
plugins/plugin-workflow/src/services/smithers-runtime.ts
```

3 个文件、2 项能力（`schema`、`cluster`），依赖只有 `effect` 一个包。

## 这条数据的价值

1. **它是"依赖即使用"这个错误判据的反证**：按 `package.json` 判，eliza 是 Effect 项目；
   按"真的 import 并且成了架构"判，它只是一个插件里用了 Effect 的 Agent 平台。
2. **它解释了为什么 L1/L2 必须单独一档**：如果我们只报"用了 Effect 的项目数"，
   会把 eliza（19k★）和 opencode（207k★）放进同一个数字里 —— 那个数字没有信息量。
3. 它同时说明**L2 不等于"没用"**：`plugin-workflow` 里的 workflow runtime 用 Effect 表达编排是合理选择，
   只是它没有扩散到主体架构。

## Key Takeaways

- 统计"用了 Effect 的 Agent 项目"时，**必须给深度分档**，否则 star 高的浅用户会把结论带偏；
- 对采用者的建议：如果只在一个插件里用 Effect，收益接近"用了一个库"；
  想拿到 Effect 的价值（失败语义、资源安全、可组合），得像 opencode 那样把它放到执行模型下面。
