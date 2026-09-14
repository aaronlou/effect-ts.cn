# ComposioHQ/composio

> 30,160★ · Effect 深度 **L4** · Effect 渗透度 **3.7%**（全仓 80+ 个 package 里只有 3 个依赖 effect）
> 全仓扫描：1,345 个 `.ts` 文件，其中 **286 个**真的 `import` 了 effect · 命中 **12 项**能力
> 依赖：`effect` `@effect/platform-bun`

## What does it do?

给 Agent 提供"工具集成层"（几百个 SaaS 工具的认证与调用），以及一个 CLI。

## Why Effect?

**这是一篇"渗透度低但用法深"的反例。** 3.7% 的渗透度说明 Effect 没有铺满全仓；
但 286 个文件 import 了它、12 项能力命中，说明**在它铺到的地方是重用法**：

- CLI 要处理大量**进程与外设交互**（keyring、二进制打包、跨平台构建）——Scope 与资源管理；
- 工具调用的**失败是常态**（第三方 API 会挂）——类型化错误 + 重试；
- 输出流要边跑边给——Stream。

## 证据文件（来自全仓扫描的真实命中）

```
ts/packages/cli-keyring/src/effect.ts
ts/packages/cli/scripts/_release-artifacts.ts
ts/packages/cli/scripts/_shared.ts
ts/packages/cli/scripts/build-all-binaries.ts
ts/packages/json-schema-to-effect-schema/...
```

第四个文件名本身就是一个结论：**`json-schema-to-effect-schema`** ——
这家把"JSON Schema → Effect Schema"做成了一等公民。工具生态的元数据是 JSON Schema，
而运行时校验与类型要用 Effect Schema，中间必须有一座桥。**这是"Agent 工具契约"在工程上真实的形状。**

## Effect Usage

| 能力 | 说明 |
| --- | --- |
| 服务与依赖注入 / Config | CLI 与构建脚本的装配 |
| 类型化错误 | 工具调用失败的建模 |
| Stream | 命令输出流 |
| Scope 资源管理 | keyring / 进程 |
| `@effect/platform-bun` | 二进制分发形态 |
| CLI（`@effect/cli`） | 11 项命中里含 `cli` |
| 可观测性 | 命中 |

## Production Signals

企业/组织维护（Composio 公司）、有 release、有 CI、多语言 monorepo（`ts/` 与 `python/` 并存）。

## Key Takeaways

1. **渗透度与深度是两个维度**：低渗透度（3.7%）+ 高深度（L4）的组合真实存在，
   只用"依赖了 effect 与否"来统计会把它和"顺带用一下"混为一谈；
2. **"JSON Schema ↔ Effect Schema"的桥**是 Agent 工具生态里被低估的基础设施问题；
3. 全仓扫描的价值在这里体现：只看根 `package.json`，它几乎必然被判成"不用 Effect"。
