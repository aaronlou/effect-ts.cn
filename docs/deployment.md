# 部署指南（effect-ts.cn）

> 目标：把静态站点公开发布出去；后端（社区功能）可选、可后置。
> 本仓库当前状态：**站点可独立公开发布**（内容 + 搜索 + RSS + llms.txt 均为构建期产物，不依赖后端）。

## 1. 架构

| 部分 | 形态 | 是否必需 |
| --- | --- | --- |
| `apps/site` | Astro 静态站点（构建产物 `apps/site/dist`） | 必需 |
| `apps/api` | Effect HTTP 服务（问答/身份等社区功能） | 可选（社区功能上线时再部署） |
| PostgreSQL | `apps/api` 的持久化 | 随 API |

站点在构建期生成全部页面（含未翻译占位页）、`/search-index.json`、`/rss.xml`、`/llms.txt`、`sitemap-index.xml`，
因此**静态托管即可获得完整体验**。

> **AI 能力也是降级而不是消失**：没有部署 API 时，⌘K 搜索与 `/ask`、`/debug` 会在浏览器里
> 直接用构建期索引 `/search-index.json` 做中文检索（明确标注"未连接问答服务"，
> 只给页面级候选与摘录，不给引用与拒答判定）。CI 里有静态检索门禁
> （`packages/knowledge/scripts/check-static-search.ts`）保证这份产物本身答得对、不硬凑。

## 2. 部署站点

### 构建

```bash
# 环境要求：Node ≥ 22、pnpm 11（packageManager 字段已固定版本）
pnpm install --frozen-lockfile
pnpm build            # contracts 编译 + api typecheck + astro 构建
# 产物目录：apps/site/dist
```

### 托管建议（任选其一）

| 平台 | 关键配置 |
| --- | --- |
| Cloudflare Pages | Build: `pnpm build`；Output: `apps/site/dist`；Node 22 |
| Vercel | 同上；Root 设为仓库根，Output Directory 覆盖为 `apps/site/dist` |
| Netlify | Build: `pnpm build`；Publish: `apps/site/dist` |
| 自有 Nginx / 对象存储 + CDN | 上传 `apps/site/dist` 静态文件即可 |

站点 URL 在 `apps/site/astro.config.mjs` 的 `site` 字段（当前 `https://effect-ts.cn`）——
换成正式域名后，canonical / sitemap / RSS 会自动使用它。

### 域名

`effect-ts.cn` 按托管商提示配置 DNS（通常 A/CNAME），HTTPS 由托管商自动签发。

## 3. 部署 API（可选）

```bash
# 参考 Dockerfile（本仓库提供：apps/api/Dockerfile）
docker build -f apps/api/Dockerfile -t ecn-api .
docker run -p 8787:8787 \
  -e API_PORT=8787 \
  -e DATABASE_URL='postgresql://user:pass@host:5432/effect_ts_cn' \
  ecn-api
```

| 环境变量 | 说明 |
| --- | --- |
| `API_PORT` | 监听端口（默认 8787，容器内固定监听 0.0.0.0） |
| `DATABASE_URL` | Postgres 连接串；**未设置时**使用进程内 InMemory 仓储（仅适合本地开发，重启即清空） |
| `ASK_RATE_LIMIT_PER_MINUTE` | 问答接口每分钟配额（默认 20） |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_TIMEOUT_MS` | 可选：配置后启用"模型润色"（OpenAI 兼容接口）。**未配置则使用 extractive 模式**（无模型、零成本、答案完全由检索结果合成） |
| `GLOSSARY_PATH` | 可选：术语黑名单路径（默认自动查找仓库内 `docs/glossary.json`） |

- 健康检查：`GET /api/health`；OpenAPI：`GET /openapi.json`
- 当前数据库表由启动时 `CREATE TABLE IF NOT EXISTS` 创建（见 `apps/api/migrations/README.md`）；
  正式迁移文件是 Phase 1 的待办。
- 站点与 API 同域时反向代理 `/api/*` 到该服务即可（本地开发已由 Astro dev proxy 处理）。
  **部署时请务必代理 `/api`**：站点的「问这一页 / 问文档 / 报错诊断」与首页后端状态徽章都依赖它；
  未代理时站点内容浏览完全正常，只是问答面板会提示"服务暂时不可用"。
- 问答侧还会用到：`/api/knowledge/stats`（模式与语料规模，面板据此显示"检索合成/模型润色"）。

> ⚠️ `apps/api/Dockerfile` 为参考实现，**未在本机验证**（当前环境 Docker daemon 未运行）。
> 首次部署时请本地 `docker build` 跑一遍再上生产。

## 4. 内容同步（自动化）

- `.github/workflows/ci.yml`：PR/push 跑内容门禁 + typecheck + test + build。
- `.github/workflows/upstream-sync.yml`：每日 03:00 UTC（也可 `workflow_dispatch` 手动触发）
  克隆官方内容仓库 → 生成上游快照 → 比对译文是否落后 → 检查侧边栏导航是否漂移
  → 有落后/漂移时自动开/更新 `upstream-sync` 标签的 Issue，产物上传为 artifact。
- 译文落后时的处理：更新对应页面的 `upstreamCommit`（以及内容），提交 PR。

## 5. 上线检查清单

- [ ] `pnpm typecheck && pnpm test && pnpm build` 全绿
- [ ] `pnpm content:check` 通过（译文 frontmatter / 路径镜像 / 术语 / 元数据残留）
- [ ] `astro.config.mjs` 的 `site` 为正式域名
- [ ] 抽查：首页、`/docs/`、任一译文页、任一未翻译占位页、`/glossary/`、`/rss.xml`、`/llms.txt`、404
- [ ] `robots.txt` 的 sitemap 地址为正式域名
- [ ] 页脚「非官方」声明 + 译文页的原文/基线标注可见
- [ ] （如部署 API）`/api/health` 返回 200、数据库连接正常
- [ ] 在 GitHub 仓库开启 Issues，并确认 `translation` 标签（认领入口使用）

## 6. 回滚

站点为纯静态：重新部署上一个成功构建即可（各托管平台都有"回滚到上次部署"）。
API 回滚 = 重新部署上一个镜像 tag；数据库变更需确认迁移可逆（当前无正式迁移）。

## 6.5 内容改动后的必做步骤

语料是**构建期产物**（`packages/knowledge/data/corpus.json`），新增/修改译文后必须重新生成，
否则问答与 MCP 会用到旧内容（CI 有"语料新鲜度"门禁会拦住）：

```bash
pnpm build            # 先构建站点（锚点从构建产物提取）
pnpm corpus:build     # 再生成语料
git add packages/knowledge/data/corpus.json
```

## 7. 已知限制（公开后待办）

- `<Tabs>` 目前按标签分块展示，无交互式切换（内容完整可见）。
- 站内搜索为构建期索引（标题 + 正文纯文本），未做中文分词与相关性排序。
- 官方 API 参考（`/docs/v4/api/...`）尚未翻译，相关链接会自动指向 effect.website。
- 社区功能（问答/身份/评论）尚未上线：后端骨架已完成，见 PLAN.md Phase 2。
- AI 能力（见 [docs/ai-native.md](./ai-native.md)）：报错诊断 v0（定位）已上线，
  但「报错百科」（可检索的历史案例）、可运行练习、AI 起草+人审 FAQ 尚未实现；
  MCP Server 目前只在仓库内运行（`pnpm mcp`），发布到 npm 是后续工作。
