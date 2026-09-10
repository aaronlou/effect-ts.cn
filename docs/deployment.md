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
| `DEEPSEEK_API_KEY` | 可选：**一条配置启用 DeepSeek**（默认 `https://api.deepseek.com` + `deepseek-chat`）。见 §3.5 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_TIMEOUT_MS` | 可选：任意 OpenAI 兼容服务（OpenAI / Ollama / vLLM / 自建网关）。**都不配则使用 extractive 模式**（无模型、零成本、答案完全由检索结果合成） |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | 可选：覆盖 DeepSeek 默认地址/模型（走代理时用） |
| `GLOSSARY_PATH` | 可选：术语黑名单路径（默认自动查找仓库内 `docs/glossary.json`） |

- 健康检查：`GET /api/health`；OpenAPI：`GET /openapi.json`
- 当前数据库表由启动时 `CREATE TABLE IF NOT EXISTS` 创建（见 `apps/api/migrations/README.md`）；
  正式迁移文件是 Phase 1 的待办。
- 站点与 API 同域时反向代理 `/api/*` 到该服务即可（本地开发已由 Astro dev proxy 处理）。
  **部署时请务必代理 `/api`**：站点的「问这一页 / 问文档 / 报错诊断」与首页后端状态徽章都依赖它；
  未代理时站点内容浏览完全正常，问答面板会**降级**为浏览器内检索（明确标注"未连接问答服务"），
  右下角常驻 Agent 胶囊也会显示"本地检索"。
- 问答侧还会用到：`/api/knowledge/stats`（模式、模型名与语料规模，面板据此显示"检索合成 / 模型润色（deepseek-chat）"）。

### 3.5 接入 DeepSeek（可选，10 秒）

```bash
cp .env.example .env      # API 启动时按固定顺序加载（见下方"查找顺序"）
# 编辑 .env：DEEPSEEK_API_KEY=sk-...（https://platform.deepseek.com/api_keys）
pnpm --filter @ecn/api llm:check          # ← 一条命令验证真的接上了
```

**`.env` 查找顺序**（先命中者生效；命令行 / 容器注入的环境变量永远优先）：
`apps/api/.env.local` → `apps/api/.env` → 仓库根 `.env.local` → 仓库根 `.env`。
`pnpm dev` 已把后四个文件加入 watch：改完 Key 会自动重启 API，不用手动重启。

`llm:check` 会打印**配置来源**与**决策结果**（提供方 / 模型 / 地址 / 超时 / Key 长度），并用真实模型跑一次
"问答 + 报错诊断"，同时验证三条不变量仍然成立：

1. **引用只来自检索** —— 模型拿不到 URL 的构造权，提示词里也禁止它输出链接；
2. **拒答不进入模型** —— 站内没有依据时直接说"不知道"，不会得到一段流畅的臆测；
3. **术语门禁仍然生效** —— 模型输出命中黑名单（如把 Layer 译成"图层"）即回退 extractive。

其它可选项：`DEEPSEEK_MODEL=deepseek-reasoner`（推理模型，更慢更贵，超时会自动放大到 120s；
该模型不接受 `temperature`，代码会自动省略）；或 `LLM_BASE_URL`/`LLM_API_KEY` 接任意
OpenAI 兼容服务（含本地 Ollama：`LLM_BASE_URL=http://127.0.0.1:11434/v1`、`LLM_API_KEY=ollama`）。

> 模型只做"润色/诊断"：**证据由检索层给出**。因此换模型、去掉模型（或 Key 失效）
> 都不会让答案失去可溯源性 —— 只会从"模型润色"退回"检索合成"。

> ⚠️ `apps/api/Dockerfile` 为参考实现，**未在本机验证**（当前环境 Docker daemon 未运行）。
> 首次部署时请本地 `docker build` 跑一遍再上生产。

### 3.6 用 Docker 部署（一台服务器全包）

仓库里现在有三个 Docker 相关文件，**全部在 CI 里构建并冒烟**（`ci.yml` 的 `docker` job）：

| 文件 | 作用 |
| --- | --- |
| `apps/api/Dockerfile` | API 镜像（Node 22 + pnpm + tsx 直跑 TS；含 contracts/knowledge/术语表） |
| `apps/site/Dockerfile` | 站点镜像（多阶段：pnpm 构建 → Nginx 托管 `dist`） |
| `apps/site/nginx.conf` | Nginx 配置：静态托管 + `/_astro` 长缓存 + `/api/` 反代到 `api:8787` |
| `infra/docker-compose.prod.yml` | 生产编排：`web` + `api` + `db`（Postgres，仅内网） |

```bash
# 在仓库根目录
cp .env.example .env      # 填 DEEPSEEK_API_KEY（留空 = extractive 模式，零成本可跑）
docker compose -f infra/docker-compose.prod.yml up -d --build
docker compose -f infra/docker-compose.prod.yml ps
curl -s localhost:8080/api/health          # 经站点容器反代 → API
open http://localhost:8080/                # 站点（默认端口可用 WEB_PORT 覆盖）
```

**两种形态，按需选**：

1. **静态站 + API 容器**（推荐，最省）：站点继续用静态托管（Cloudflare Pages / 对象存储 + CDN / Nginx），
   只把 API 跑成容器，并在托管侧把 `/api/*` 反代到它。改动最小、CDN 收益最大。
2. **全 Docker Compose**（上面这条命令）：适合"一台 VPS 全包"，站点容器自带 Nginx 与反代，无需额外配置。

**上线注意**：

- 数据库端口**不对外暴露**（compose 里只有 `expose`，没有 `ports`）；备份用
  `docker compose -f infra/docker-compose.prod.yml exec db pg_dump -U effect effect_ts_cn > backup.sql`。
- 站点容器依赖同名服务 `api`（Nginx 里写的是 `proxy_pass http://api:8787`）；若改成别的主机，改 `apps/site/nginx.conf`。
- HTTPS：单机场景建议在前面再放一层 Caddy/Nginx 或云负载均衡；compose 本身只暴露 HTTP。
- 回滚：镜像带 `:latest` 标签，建议推送到镜像仓库时打 `:<commit>` 标签，回滚就是换标签重启。

### 3.7 端口冲突与 HTTPS（服务器上已有其它站点）

绝大多数情况是：**服务器上已经有一套 Caddy/Nginx 占着 80/443**，你不能再起一个抢端口的服务。
本仓库的编排就是按这个前提设计的，三条纪律：

| 服务 | 端口策略 |
| --- | --- |
| `db` | 只 `expose 5432`，**不发布到宿主**（外网与其它容器都碰不到） |
| `api` | 只 `expose 8787`，**不发布到宿主** |
| `web` | 只绑 **`127.0.0.1:${WEB_PORT:-18080}`**（回环，不公网可达），把 80/443 留给现有反向代理 |

上线前先做端口体检：

```bash
pnpm docker:ports        # 列出：宿主监听端口+进程、docker 已发布端口、候选端口是否空闲
# 若 18080 也被占用：在 .env 里改 WEB_PORT=18081 再 up
```

#### 用 Caddy 提供 HTTPS

**接法 A（最常见）：Caddy 跑在宿主机**，把域名指到我们的回环端口。在现有 `Caddyfile` 里加：

```caddyfile
effect-ts.cn, www.effect-ts.cn {
    encode zstd gzip
    reverse_proxy 127.0.0.1:18080
}
```

Caddy 会自动申请并续期证书（前提：80/443 由它监听、域名已解析到本机）。
完整片段（含"只验收不接域名"的自签方案）在 **`infra/Caddyfile.effect-ts.cn`**。

**接法 A2：443 被现有 Nginx 占用**（老服务器常见）。同样**不要**新起一个 Nginx 去抢 443，
而是把新域名作为 `server_name` 加进现有 Nginx —— 完整配置见 **`infra/nginx-effect-ts.cn.conf`**：

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name effect-ts.cn www.effect-ts.cn;   # ← 与现有站点共用 443，靠 server_name 分流
    ssl_certificate     /etc/letsencrypt/live/effect-ts.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/effect-ts.cn/privkey.pem;
    location / { proxy_pass http://127.0.0.1:18080; proxy_set_header Host $host; }
}
```

证书用 certbot：`certbot --nginx -d effect-ts.cn -d www.effect-ts.cn`（或 `certonly --webroot`）。

#### 为什么"443 已被占用"不等于"不能部署"

端口是**进程独占**的，但**域名不是**：反向代理在 TLS 握手时按 SNI、在 HTTP 层按 `Host` 分流，
一个 443 可以服务任意多个站点，每个站点有自己的证书与上游。本机实测（同一端口两个域名）：

```
# 同一个 Caddy 监听一个端口，两个站点块
old.localhost   → 我是服务器上原有的另一个站点（old.localhost）
effect-ts.cn    → HTTP 200  <title>首页 · Effect 中文社区
effect-ts.cn/api/health → HTTP 200
Caddy 日志（按域名分别签发证书）：
  "identifier":"effect-ts.cn"
  "identifier":"old.localhost"
证书 SAN：DNS:effect-ts.cn      ← 证书是"按域名"的，不是"按端口"的
```

**所以：现有站点继续用 443，我们的新站点也走同一个 443，互不影响。**

**同机多站点注意事项**

1. **不要**再起第二个监听 80/443 的进程（会 `address already in use`）；只改现有反向代理的配置。
2. **DNS 先指对**：`A/AAAA effect-ts.cn → 服务器 IP`，否则证书签不下来（HTTP-01/TLS-ALPN 都会失败）。
3. 注意现有配置里的 **default_server / catch-all**：若其它站点是默认服务器，先确认我们的 `server_name` 块已加载，
   且请求确实命中它（`curl -sI https://effect-ts.cn` 看返回的是不是我们的内容）。
4. **HSTS 是按主机生效**的，别的站点开 `includeSubDomains` 不会波及 `effect-ts.cn`；但如果你给本站也开 HSTS，
   务必先确认 HTTPS 正常。
5. 资源与安全隔离：同机多站点共享 CPU/内存。我们这套很轻（Nginx 静态 + Node API + Postgres），
   但 Postgres 与其它项目的数据库要**不同库名/口令**，容器名用 `ecn-` 前缀（已默认），回环端口各自错开。
6. 自测顺序：`curl -s http://127.0.0.1:18080/api/health`（绕过反代，验证容器）→
   `curl -sI https://effect-ts.cn`（验证反代与证书）→ 浏览器打开站点点一次 AI 问答（验证 `/api` 链路）。

**接法 B：Caddy 也跑在 Docker 里**（另一个 compose）——容器间直连，**零宿主端口**：

```bash
docker network create caddy          # 已存在会报错，忽略
# 在 caddy 的 compose 里给 caddy 服务加 networks: [caddy]
pnpm docker:up:caddy                 # = base compose + infra/docker-compose.caddy-network.yml
```

```caddyfile
effect-ts.cn {
    encode zstd gzip
    reverse_proxy ecn-web:80
}
```

**这套链路是实测过的**（本机 Docker，`tls internal` + 非 80/443 端口以避免影响其它站点）：

```
ecn-web  127.0.0.1:18080->80/tcp     ← 只回环
ecn-api  8787/tcp                    ← 无宿主端口
ecn-db   5432/tcp                    ← 无宿主端口
curl -k https://localhost:8443/            → 200（Caddy → ecn-web:80 → 静态页）
curl -k https://localhost:8443/api/health  → 200（→ ecn-web 反代 → api → Postgres）
Caddy 日志：certificate obtained successfully（identifier=localhost）
```

**其它注意事项**

- 若 80/443 被**现有 Nginx** 占用而你想迁到 Caddy：先让 Caddy 用 `tls internal` 或高位端口跑通链路，
  再择机切换监听端口，避免域名中断。
- 同一台机器上多个 compose 项目要设不同 `container_name` 前缀（本项目用 `ecn-`）与不同 `WEB_PORT`。
- 防火墙只需放行 80/443（给 Caddy）；`18080` 是回环，不必放行。

## 4. 内容同步（自动化）

- `.github/workflows/ci.yml`：PR/push 跑内容门禁 + typecheck + test + build。
- `.github/workflows/upstream-sync.yml`：每日 03:00 UTC（也可 `workflow_dispatch` 手动触发）
  克隆官方内容仓库 → 生成上游快照 → 比对译文是否落后 → 检查侧边栏导航是否漂移
  → 有落后/漂移时自动开/更新 `upstream-sync` 标签的 Issue，产物上传为 artifact。
- 译文落后时的处理：更新对应页面的 `upstreamCommit`（以及内容），提交 PR。

## 5. 上线检查清单

- [ ] `pnpm typecheck && pnpm test && pnpm build` 全绿
- [ ] `pnpm content:check` 通过（译文 frontmatter / 路径镜像 / 术语 / 元数据残留）
- [ ] `pnpm cite:check` 通过（引用可解引用：摘要 / 内容指纹 / `/cite/*` 与语料一致）
- [ ] `pnpm proposals:check` 通过（`.proposals/` 里没有未通过的 Agent 提案）
- [ ] `astro.config.mjs` 的 `site` 为正式域名
- [ ] 抽查：首页、`/docs/`、任一译文页、任一未翻译占位页、`/glossary/`、`/rss.xml`、`/llms.txt`、404
- [ ] `robots.txt` 的 sitemap 地址为正式域名
- [ ] 页脚「非官方」声明 + 译文页的原文/基线标注可见
- [ ] （如部署 API）`/api/health` 返回 200、数据库连接正常
- [ ] 在 GitHub 仓库开启 Issues，并确认 `translation` 标签（认领入口使用）
- [ ] 把微信群二维码放到 `apps/site/public/community/wechat-group.png` —— 社区页会自动显示它；
      未放时页面给"二维码待发布"的**诚实提示**，不会放假链接（中文社区的群聊入口以微信群为准，不用海外 SNS）

## 6. 回滚

站点为纯静态：重新部署上一个成功构建即可（各托管平台都有"回滚到上次部署"）。
API 回滚 = 重新部署上一个镜像 tag；数据库变更需确认迁移可逆（当前无正式迁移）。

## 6.5 内容改动后的必做步骤

语料是**构建期产物**（`packages/knowledge/data/corpus.json`），新增/修改译文后必须重新生成，
否则问答与 MCP 会用到旧内容（CI 有"语料新鲜度"门禁会拦住）。

存在一个**往返依赖**，值得记住：

- `corpus` 的锚点**从站点构建产物提取**（`apps/site/dist`）→ 先要 `build`；
- 而引用记录端点 `/cite/<digest>.json` 由语料驱动 → `build` 之前要 `corpus` 是最新的。

因此标准动作是**两趟**（第二趟约 8 秒）：

```bash
pnpm build            # 1) 构建页面：新页面/新标题的锚点来源
pnpm corpus:build     # 2) 依据当前内容生成语料（引用摘要 + 内容指纹）
pnpm build            # 3) 再构建一次，让 /cite/* 反映新语料

git add packages/knowledge/data/corpus.json
```

只改了正文、没有增删标题时，`pnpm corpus:build && pnpm build` 一趟即可。

自检（本地就能发现"产物与语料不一致"）：

```bash
pnpm content:check    # 译文规则
pnpm cite:check       # 引用摘要 / 指纹 / /cite/* 与语料一致
```

> CI 里不存在顺序问题：CI 的 `build` 与 `cite:check` 都以**已提交的 corpus** 为准，
> 而 `dist/` 从不提交（`.gitignore` 已忽略）。上面这套顺序是为了**本地开发**不踩坑。

## 7. 已知限制（公开后待办）

- `<Tabs>` 目前按标签分块展示，无交互式切换（内容完整可见）。
- 站内搜索为构建期索引（标题 + 正文纯文本），未做中文分词与相关性排序。
- 官方 API 参考（`/docs/v4/api/...`）尚未翻译，相关链接会自动指向 effect.website。
- 社区功能（问答/身份/评论）尚未上线：后端骨架已完成，见 PLAN.md Phase 2。
- AI 能力（见 [docs/ai-native.md](./ai-native.md)）：报错诊断 v0（定位）已上线，
  但「报错百科」（可检索的历史案例）、可运行练习、AI 起草+人审 FAQ 尚未实现；
  MCP Server 目前只在仓库内运行（`pnpm mcp`），发布到 npm 是后续工作。
