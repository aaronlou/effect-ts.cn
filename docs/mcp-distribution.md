# MCP 分发：把 server 送到各个目录

> 目的：让"AI 回答中文 Effect 问题"时能检索到我们。工具的**可发现性**只有一条路可走 ——
> 出现在 Agent 会去查的地方。目录收录同时带来外链（SEO）和工具发现（AI 检索）。
>
> 这份文档记录**每个目录的实际机制**与当前状态。机制差别很大，不记下来下次得重新调研一遍。

## 现状

| 目录 | 机制 | 状态 | 谁做 |
| --- | --- | --- | --- |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | GitHub PR | **[#14430](https://github.com/punkpeye/awesome-mcp-servers/pull/14430) 已提交**（`check-submission` 通过） | 已做 |
| [MCPFind](https://mcpfind.org) | GitHub PR（`submissions/<name>.yml`） | **[#224](https://github.com/MCPFind/mcp-find/pull/224) 已提交**（两道校验都通过） | 已做 |
| [Glama](https://glama.ai/mcp/servers) | **从 awesome-mcp-servers 自动同步** + 自己的爬虫 | 等 PR 合并；仓库 topics 已补齐 | 无需操作 |
| [PulseMCP](https://www.pulsemcp.com) | **每周从官方 MCP Registry 自动同步** | 已在管道里（我们 09-13 进了 Registry） | 无需操作 |
| [Smithery](https://smithery.ai) | 上传 `.mcpb` bundle（本地 stdio）或 URL（需公网 HTTP 端点） | **已发布** → [siyuanlou/effect-ts-cn](https://smithery.ai/servers/siyuanlou/effect-ts-cn)（6 个工具已登记）；列表页缺描述/图标，需在控制台补 | 已发布 |
| [Cline Marketplace](https://github.com/cline/mcp-marketplace) | GitHub Issue | 素材已备齐（含 400×400 logo） | **需先真的用 Cline 装一次** |
| ~~mcpservers.org~~ | 网页表单（免费 / $39） | **按你的决定跳过** | — |
| ~~mcp.so~~ | 付费 $39（dofollow，DR 72） | **按你的决定跳过** | — |

已生效但**不是目录**的入口：npm 包 [`effect-ts-cn-mcp`](https://www.npmjs.com/package/effect-ts-cn-mcp)
与官方 [MCP Registry](https://registry.modelcontextprotocol.io)（`io.github.aaronlou/effect-ts-cn`，`status: active`）。

> **Registry 是这些目录的上游。** PulseMCP 每周从它同步；Glama 也从 awesome 列表与自己的爬虫取。
> 也就是说「进官方 Registry」这一件事已经间接铺开了好几条线 —— 这比逐个提交表单划算得多。


## 已做完的两件事

### awesome-mcp-servers（PR #14430）

- 分类 **💻 Developer Tools**，插在分类标题正下方（该分类是"最新在前"，不是字母序 —— 全文件各分类
  排序规则并不一致，跟着相邻条目的惯例走）
- 该仓库**明确欢迎自动化 Agent**：PR 标题以 `🤖🤖🤖` 结尾可快速合并（已加）
- 格式：`- [owner/repo](url) <图例 emoji> - 描述 + 安装命令`
- **刻意没加 Glama badge**：那个 badge 指向 `glama.ai/mcp/servers/<owner>/<repo>`，而我们还没被收录，
  贴上去就是个坏图。等 Glama 同步出页面后再补

### MCPFind（PR #224）

- 一个文件 `submissions/effect-ts-cn-mcp.yml`，schema 见其 `CONTRIBUTING.md`
- 类别选 `documentation`（该表定义就是 "Docs sites, knowledge bases, references"）
- 提交前**本地跑过它的两个门禁**：结构校验通过；存活性校验 `failures: []`
- 存活性校验最初报了许可证警告，顺带修掉了（见下）

### 顺带修掉的许可证问题

GitHub 把仓库判成 `NOASSERTION` —— 明明有 `LICENSE`、正文也是标准 MIT，
但说明被追加在 MIT 正文之后，licensee 匹配不上。

这不只是显示问题：**"可识别的 OSS 许可证"是多个目录的准入条件**，MCPFind 的存活性检查也会 WARN。
`LICENSE` 已恢复为逐字标准 MIT，说明迁到 [NOTICE.md](../NOTICE.md)，`gh api repos/aaronlou/effect-ts.cn/license`
现在返回 `spdx: MIT`。

## 需要你做的：Smithery 发布

> **状态：已发布** → <https://smithery.ai/servers/siyuanlou/effect-ts-cn>
> （namespace 是 **`siyuanlou`**，不是 GitHub 的 `aaronlou` —— 见「踩过的坑二」）

Smithery 的本地分发通道只收 **MCPB bundle**（它也是 Claude Desktop 双击安装的格式）。
我们走不了 URL 那条路 —— 我们的 MCP 是 stdio 的，服务端没有公网 HTTP 端点。

```bash
# 1) 打包（会先重建零依赖单文件，然后 zip，再解压跑一次 stdio 冒烟）
pnpm mcp:mcpb
#   ✔ dist/effect-ts-cn-0.1.0.mcpb  1.2 MB
#   ✔ 冒烟通过：解压后启动，返回 6 个工具；manifest 声明的都在，且 inputSchema 与实现一致

# 2) 发布。Smithery 用 API key 鉴权，不走浏览器交互 ——
#    在 https://smithery.ai/account/api-keys 建一个，然后：
export SMITHERY_API_KEY=sk_xxx

# ⚠️ 第一次发布**不要传 -n**：让 CLI 自己解析 namespace（见下方「踩过的坑二」）
npx @smithery/cli mcp publish ./apps/mcp/dist/effect-ts-cn-0.1.0.mcpb

# 跑通之后再固化显式名字：
# npx @smithery/cli mcp publish ./apps/mcp/dist/effect-ts-cn-0.1.0.mcpb -n <namespace>/effect-ts-cn
```

bundle 之所以只有 1.2 MB：宿主自带 Node，`dist/cli.js` 又是 esbuild 打好的零依赖单文件
（语料内联，7.5 MB → deflate 后 1.2 MB），所以既不带 `node_modules` 也不带运行时。
bundle 里还带了 `icon.png`（就是站点那张 `logo-400.png`）。

`apps/mcp/mcpb/manifest.json` 里的 `version` 必须与 `package.json` 一致 —— 打包脚本会断言，
不一致直接失败（否则分发出去的 bundle 会声称自己是个不存在的版本）。图标同理：
manifest 声明了 `icon.png` 而包里没有，脚本也会拒绝出包。

### 踩过的坑：manifest 的 `tools` 必须带 `inputSchema`

第一次发布失败，服务端回：

```
Deployment failed: 400 {"error":"Invalid input: expected object, received undefined;
Invalid input: expected object, received undefined; ...（共 6 次）"}
```

**同一句话 6 次、不提字段名** —— 那个 6 就是我们 manifest 里 `tools` 的条数。

原因：Smithery CLI 把 bundle manifest 的 `tools` **原样**当作 MCP 的 Tool 列表塞进 `serverCard`
（`dist/index.js` 里 `serverCard: { serverInfo, ...(r.tools ? { tools: r.tools } : {}) }`），
而 MCP 规范的 Tool 要求 `inputSchema` 必填。我们最初只写了 `{name, description}` ——
**MCPB 规范自己的示例也只有这两个字段**，所以照着规范写反而错。服务端于是对 6 个工具
各报一次"某个 object 字段是 undefined"。

CLI 侧只检查 `name` 是不是字符串，所以错误要等上传到服务端才会出现。

修法：给每个工具补上与实现一致的 `inputSchema`。并且加了断言 —— 打包时解压、启动、
`tools/list`，把 manifest 里每个工具的 `inputSchema` 与 server 实际返回的**做语义比较**
（递归排序 key 后比对，不受键序影响）。故意改坏一个类型会被拦下并打印两边差异。

> 这类失败的特征值得记住：**错误条数等于某个数组的长度时，去找那个数组里每个元素缺了什么字段。**

### 踩过的坑二：`-n <namespace>/...` 会绕过 namespace 解析

补上 `inputSchema` 后 400 消失了，接着是：

```
? Server "aaronlou/effect-ts-cn" doesn't exist yet. Create it? Yes
✗ 404 {"error":"Namespace not found"}
```

原因在 CLI 的分支上：

```js
let o = t.name                                        // 传了 -n 就直接用
if (!o) { ... let h = await xw(r) ... }               // 没传 -n 才走解析
```

而 `xw()` 做的是 `client.namespaces.list()`：**0 个 → 引导新建并认领；1 个 → 直接用；多个 → 让你选。**

所以传 `-n aaronlou/effect-ts-cn` 意味着**完全跳过这段**，把 `aaronlou` 直接发给服务端；
它不是该账号已认领的 namespace，于是 404。注意 `Server ... doesn't exist yet. Create it?`
那句提问是**误导性的** —— 它问的是 server，缺的是 namespace，说 Yes 也救不回来。

正确做法：**不传 `-n`，让 CLI 自己去解析。**

```bash
# 先看账号下有哪些 namespace（只读）
npx @smithery/cli namespace list
npx @smithery/cli whoami

# 然后交给 CLI 解析（它会列出/新建/认领，并询问 server 名，填 effect-ts-cn）
npx @smithery/cli mcp publish ./apps/mcp/dist/effect-ts-cn-0.1.0.mcpb

# 或者确认了 namespace 之后再显式指定
npx @smithery/cli mcp publish ./apps/mcp/dist/effect-ts-cn-0.1.0.mcpb -n <你的namespace>/effect-ts-cn
```

> 教训：**当一个 CLI 同时支持"自动解析"和"手动指定"时，手动指定往往跳过的不只是默认值，
> 还有前置的校验与创建步骤。** 先用自动路径把环境跑通，再改成显式参数固化。

### 发布后的实测结果（2026-09-15）

刚发布时 `https://api.smithery.ai/servers/siyuanlou/effect-ts-cn` 返回：

```jsonc
{
  "qualifiedName": "siyuanlou/effect-ts-cn",
  "displayName": "effect-ts-cn",
  "description": "",          // ← 空
  "iconUrl": null,            // ← 空
  "remote": false,            // ← 不是托管服务
  "deploymentUrl": null,
  "tools": ["search_docs","get_page","ask","glossary","translation_status","cite"],  // ← 6 个都在
  "connections": [{ "type": "stdio", "bundleUrl": "…/d08dde7c-…" }]
}
```

**三个结论：**

1. **6 个工具全部登记成功** —— 「踩过的坑一」的修复确实生效了。
2. **`description` 与 `iconUrl` 不在 bundle 的可控范围内。** 原因在 CLI 组装的 `serverCard`：
   它只带 `serverInfo: { name, version }`，**不带** MCPB manifest 里的 `description` / `icon`。
   所以这两项改 bundle 没用，只能在 Smithery 控制台的服务页上补（**已补**，
   见下方验证）。也别去改服务端 `initialize` 返回的 `title` —— 那个字段不参与这里。
3. **`remote: false`，没有托管端点。** CLI 会打印一个
   `MCP URL: https://effect-ts-cn--siyuanlou.run.tools`，但对 stdio 分发**这个地址是空的**
   —— 实测 `/`、`/mcp`、两种主机名顺序全是 404 / "Server not found"。
   **不要把它当成可用的远程端点写进文档或别处。** 它是给 `remote: true`（自己带公网 URL）
   那类服务用的。

**控制台补完之后（已核实）：**

```bash
# 这两个端点**会给出不同的字段**，只查一个会得出错误结论
curl -s https://api.smithery.ai/servers/siyuanlou/effect-ts-cn       # description 仍为空（残缺视图）
curl -s https://registry.smithery.ai/servers/siyuanlou/effect-ts-cn  # description 已填、iconUrl 已有
```

`registry.smithery.ai` 与公开页面的 `<meta name="description">` / `og:description` 都是新描述；
图标端点 `https://api.smithery.ai/servers/siyuanlou/effect-ts-cn/icon` 返回
`HTTP 200 image/png 400×400`，**SHA-256 与 `apps/site/public/logo-400.png` 逐字节一致**。

> 这条也值得单独记：**同一份记录的两个官方端点可以不一致**（一个 lags / 只给部分字段）。
> 只查 `api.smithery.ai` 会让人以为控制台的修改没生效 —— 差点误报成"你的操作没成功"。
> 判断"改没改上"要找**权威来源**（这里是 registry 端点 + 公开页面的 meta）。

## 需要你做的：Cline Marketplace

机制是**开一个 GitHub Issue**（模板 `mcp-server-submission.yml`），素材已经备齐：

- 仓库 URL：<https://github.com/aaronlou/effect-ts.cn>
- Logo：`apps/site/public/logo-400.png`（正好 400×400，也从 <https://effect-ts.cn/logo-400.png> 可取）
- 安装说明：仓库根目录的 [`llms-install.md`](../llms-install.md)（Cline 找的就是这个名字）
- 提交入口：<https://github.com/cline/mcp-marketplace/issues/new?template=mcp-server-submission.yml>

**我没有替你提交，原因是模板里有一个必勾的声明**：

> I have tested that Cline can successfully set up this server using only the README.md and/or llms-install.md file

我没有真的用 Cline 装过它，所以不能勾这个框 —— 勾了就是替你做了一次假的陈述。
已经验证到的是：干净目录里 `npx -y effect-ts-cn-mcp` 能起来，`initialize` 返回
`effect-ts-cn@0.1.0`，`tools/list` 返回 6 个工具。但那**不等于** Cline 端到端跑通。

所以要做的就一步：用 Cline 装一次，确认能起来，然后提交 Issue 并如实勾选。

## 已决定跳过的

- **mcpservers.org**（免费档 / $39 dofollow DR71）—— 跳过
- **mcp.so**（$39 dofollow DR72）—— 跳过

记录一下当时的取舍，免得以后重新纠结：这个站目前**没有任何有分量的外链**，
而外链正是排名为零的根因，所以"买一条 DR 70+ 的 dofollow"本身不荒唐。
不买的理由是**顺序**：免费渠道（官方 Registry → PulseMCP 自动同步、awesome 列表 → Glama 自动同步）
还没跑完一轮，基线未知；先知道免费部分能带来多少，再决定要不要花钱补。
另外那两家的 DR 是**它们自己页面上的数字**，第三方工具未必一致。

## 顺带补的两件事

- **GitHub topics 补了 `mcp-server`**（此前只有 `mcp` / `model-context-protocol`）。
  Glama 这类爬虫会看 topics，缺一个可能的发现入口不值得。
- **[`llms-install.md`](../llms-install.md)** —— Cline 一类 Agent 做一键安装时会找这个文件。
  内容刻意写了"不要做的事"（不要配 API key、不要把 `citations: []` 当故障），
  因为这两条是这套 server 最容易被配错的地方。

## 不建议做的

- **不要用 `mcp-submit` 这类"一键提交所有目录"的第三方包**。调研时看到过它：只有 `0.1.0`
  一个版本、依赖 `@octokit/rest` 会以你的身份开 PR、而且是交互式的。
  为省两次手写换一个未审的自动化提交器，风险不对等。
- **不要为了上 Smithery 的 URL 通道临时开公网 MCP 端点**。那是一条真实的产品改动
  （Streamable HTTP 传输、限流、成本闸门），不是分发动作。要做就单独做、单独评估。
