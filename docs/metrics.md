# 度量与周报（effect-ts.cn）

> 一句话：**站点对外宣称"答案可核验"，那就必须能随时看见"到底有多少答案是可核验的"。**
> 这份文档说明我们收什么、不收什么、落在哪、怎么看。

## 1. 收什么（每一次 `/api/knowledge/ask`）

| 字段 | 含义 |
| --- | --- |
| `at` | 记账时刻 |
| `qHash` / `qLen` | 问题归一化后的 **sha256 前 16 位** / 字符数 |
| `mode` | `llm`（模型润色）还是 `extractive`（检索合成） |
| `refused` / `reason` | 是否拒答；`no-match`（站内没有）或 `untranslated`（中文还没译） |
| `cites` / `resolvable` | 本轮引用条数 / 其中带 `/cite/<digest>.json`（可独立解引用）的条数 |
| `scoped` | 是否"问这一页" |
| `rewritten` / `expanded` / `reranked` | 是否触发指代消解 / 术语化扩展 / 候选重排（**这三个布尔是"检索升级到底有没有在跑"的唯一证据**） |
| `cacheHit` | 是否命中答案缓存（命中即**零 token**） |
| `ms` | 端到端耗时 |

**不收**：问题原文、粘贴的代码、IP、UA。要"同一问题的重复率"只看 hash 就够；
度量不该成为隐私口径的例外（见 [ai-native.md §5](./ai-native.md)）。

## 2. 落在哪

1. **进程内环形缓冲**（默认 20,000 条）→ 直接由 `GET /api/knowledge/stats` 的 `usage` 段返回
   （今日 / 最近 7 天）。重启清零 —— 它防的是"看不见"，不是"精算"。
2. **stdout 单行 JSONL**（前缀 `ecn.usage`）→ 容器日志，**重启不丢**：

   ```bash
   docker logs ecn-api 2>&1 | grep ecn.usage > usage.jsonl   # 生产
   ```

   这与"访问记录的权威来源是宿主日志"是同一套运维模型。

要接多实例或精确历史时，把 `apps/api/src/contexts/assistant/infrastructure/usage-log-live.ts`
换成基于 Postgres 的实现即可 —— 端口（`application/ports/usage-log.ts`）不变。

## 3. 怎么看（周报）

```bash
pnpm report:weekly                                   # 打生产 API（最省事）
pnpm report:weekly --api http://127.0.0.1:8787       # 本地
node scripts/usage-report.mjs --usage usage.jsonl    # 离线：从容器日志现算
node scripts/usage-report.mjs --access access.log    # 带上流量段（宿主 Caddy 日志）
```

报告里的四段：

| 段 | 回答的问题 | 数据来源 |
| --- | --- | --- |
| **AI 问答** | 有多少人在用？答得准吗？钱花在哪？ | `/stats` 的 `usage` 段，或 `--usage` 的 JSONL |
| **流量** | 有多少人来了？从哪来？ | `--access`（Caddy 日志，解析逻辑与 `pnpm traffic` 共用一份） |
| **Agent 侧** | MCP 有没有被真的用起来？ | npm 周下载量（本地 MCP 无法上报调用量，下载量是代理指标） |
| **读法提示** | 下一步该修什么？ | 对上面数字的启发式判断（**不是结论**，样本 < 10 时不报警） |

**北极星是"可验证答率"**：回答里至少有一条可解引用引用的比例。
它低于 90% 时要先查引用为什么不可解引用，而不是去做新功能。

## 4. 不许悄悄变的东西（CI 门禁）

`apps/api/test/assistant/usage-log.test.ts` 把**账目字段清单冻结**了：
`ASK_USAGE_FIELDS` 与落盘 JSONL 的键集合都必须与测试里那份列表**完全一致**。
加字段要同时改三处（端口、落盘、测试），删字段会被测试拦下 ——
**报表悄悄空掉一列，比报表报错更难发现**。

同一条不变量也覆盖了请求侧：
`apps/api/test/assistant/ask-usage.test.ts` 断言"诊断与事实一致"
（扩展真的发生过 ⇒ `expanded` 必须为真；拒答 ⇒ 引用数必须为 0；重复提问 ⇒ 必须命中缓存）。
