# @ecn/observatory

> Effect × AI Agent 生态观测台 —— **可复现**的 GitHub 生态数据研究。
> 研究问题：[docs/observatory/research-question.md](../../docs/observatory/research-question.md)
> 口径（宪法）：[docs/observatory/methodology.md](../../docs/observatory/methodology.md)

## 一句话

不是"给 Effect 写软文"，而是建一套**允许结论失败**的数据系统：
先有数据、再有观点；每条候选都能回溯到具体查询；每个汇总数字都能由明细重算。

## 跑起来

```bash
pnpm --filter @ecn/observatory discover --snapshot 2026-09-14   # 发现候选 + 冻结快照
pnpm --filter @ecn/observatory test                              # 判据与快照自检（零网络）
```

产物在 `data/snapshots/<date>/`：`frame.json`（有界宇宙声明 + 版本 + 被抬高的星数下限）、
`candidates.json`（候选池，每条带 `via`）、`search-calls.json`（每次查询的账 + 被排除的名单）、
`summary.json`（语言分布 / stars 分位 / 活跃度）。

**快照禁止覆盖**：目录已存在即报错 —— 逐月快照的价值就在于"旧数据没被改过"。

## 门禁（防"证据自相矛盾"）

`test/snapshot.test.ts` 对已提交的每一期快照做结构校验：汇总能否由明细重算、
每条候选能否回溯到真实查询、去重规则说的和做的是否一致。
数字看起来永远是对的，所以必须机器来盯。

## 缓存与配额

`artifacts/observatory/cache/`（gitignore）缓存每一次 GitHub 响应。
不是省时间，是**正确性**：一次限流若被读成"这个仓库不依赖 effect"，就伪装成了一次成功筛选。
