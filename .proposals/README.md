# 提案队列（`.proposals/`）

Agent 起草的译文 / 落后页更新 / FAQ / 术语提案放这里。

**为什么要有这个东西**：Agent 时代最大的杠杆不是"让 Agent 读"，而是**让 Agent 产出可审阅的痕迹**。
但"机器写"只有在**人审 + 机械门禁**都成立时才安全 —— 这个目录就是那条通道。

## 契约（三条不可协商的规则）

1. **提案是文件，不是数据库**：一个 JSON = 一条提案，可 review、可 diff、可回滚、零后端。
2. **内容必须过与人工投稿相同的门禁**：校验器直接复用 `checkDocs`（frontmatter / 路径镜像 /
   术语黑名单 / 工具元数据残留），不存在"给机器放宽一点"的第二套标准。
3. **Agent 不得自称已发布**：`content.status` 只能是 `translating` / `reviewing`，
   `content.reviewers` 必须为空。改成 `published` 并填审校人是**人类维护者**的动作。

## 用法

```bash
# 1) 复制模板，改名为 <proposal-id>.json
cp .proposals/_template.translation.json .proposals/fallback-zh.json

# 2) 自检（会套用人工投稿的同一道闸）
pnpm --filter @ecn/content proposals:check

# 3) 列出待处理提案
pnpm --filter @ecn/content proposals:list

# 4) 人工审阅通过后落地（显式动作，默认不覆盖已有译文）
pnpm --filter @ecn/content proposals:apply fallback-zh
pnpm content:check && pnpm build && pnpm corpus:build
```

> `_` 前缀的文件（如模板）会被 `proposals:check` 跳过，不会被当成待处理提案。

## 一条提案长什么样

```jsonc
{
  "id": "fallback-zh",                 // 必须等于文件名（不含 .json）
  "kind": "translation",              // translation | stale-update | faq | glossary
  "createdAt": "2026-09-10T00:00:00.000Z",
  "draftedBy": {
    "kind": "agent",                  // agent | human
    "name": "claude-code",
    "model": "…",                     // kind=agent 时必填（provenance 不能缺）
    "promptVersion": "translate-v1"
  },
  "rationale": "…至少 20 字，写清为什么提这个…",
  "target": {
    "slug": "v4/error-management/fallback",     // 必须镜像 upstreamPath
    "upstreamPath": "v4/error-management/fallback.mdx",
    "upstreamCommit": "<40 位小写 hex>"          // stale-update 时必填
  },
  "content": "---\ntitle: …\nstatus: reviewing\n…\n---\n\n正文…",
  "notes": "给审阅者的额外说明（可选）"
}
```

## 审阅者清单

- [ ] `rationale` 是真理由，不是"AI 生成"
- [ ] 代码块与上游**逐字节一致**（工具元数据已剥掉、框架 import 已删）
- [ ] 术语未自创（`docs/glossary.json` 为准）
- [ ] 引用/链接指向真实存在的页面与锚点
- [ ] 通过后：改 `status: published`、填 `reviewers`、重跑 `build` + `corpus:build`
