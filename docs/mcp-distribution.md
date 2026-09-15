# MCP 分发：把 server 送到各个目录

> 目的：让"AI 回答中文 Effect 问题"时能检索到我们。工具的**可发现性**只有一条路可走 ——
> 出现在 Agent 会去查的地方。目录收录同时带来外链（SEO）和工具发现（AI 检索）。
>
> 这份文档记录**每个目录的实际机制**与当前状态。机制差别很大，不记下来下次得重新调研一遍。

## 现状

| 目录 | 机制 | 状态 | 谁做 |
| --- | --- | --- | --- |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | GitHub PR | **[#14430](https://github.com/punkpeye/awesome-mcp-servers/pull/14430) 已提交**（`check-submission` 通过） | 已做 |
| [MCPFind](https://mcpfind.org) | GitHub PR（`submissions/<name>.yml`） | **[#224](https://github.com/MCPFind/mcp-find/pull/224) 已提交** | 已做 |
| [Glama](https://glama.ai/mcp/servers) | **从 awesome-mcp-servers 自动同步** | 等上面那个 PR 合并 | 无需操作 |
| [Smithery](https://smithery.ai) | 上传 `.mcpb` bundle（本地 stdio）或 URL（需公网 HTTP 端点） | bundle 已能一键打出 | 需登录后发布 |
| [PulseMCP](https://www.pulsemcp.com) | 网页表单 | 未提交 | 需人工（要填邮箱） |
| [mcpservers.org](https://mcpservers.org) | 网页表单（免费 / $39） | 未提交 | 需人工（要填邮箱） |
| [mcp.so](https://mcp.so) | 付费 $39（dofollow，DR 72） | 未提交 | **需你决定是否花钱** |

已生效但**不是目录**的入口：npm 包 [`effect-ts-cn-mcp`](https://www.npmjs.com/package/effect-ts-cn-mcp)
与官方 [MCP Registry](https://registry.modelcontextprotocol.io)（`io.github.aaronlou/effect-ts-cn`，`status: active`）。

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

Smithery 的本地分发通道只收 **MCPB bundle**（它也是 Claude Desktop 双击安装的格式）。
我们走不了 URL 那条路 —— 我们的 MCP 是 stdio 的，服务端没有公网 HTTP 端点。

```bash
# 1) 打包（会先重建零依赖单文件，然后 zip，再解压跑一次 stdio 冒烟）
pnpm mcp:mcpb
#   ✔ dist/effect-ts-cn-0.1.0.mcpb  1.2 MB
#   ✔ 冒烟通过：解压后启动，返回 6 个工具（manifest 声明的都在）

# 2) 发布（这一步需要登录 Smithery，只能你来）
npx @smithery/cli mcp publish ./apps/mcp/dist/effect-ts-cn-0.1.0.mcpb -n aaronlou/effect-ts-cn
```

bundle 之所以只有 1.2 MB：宿主自带 Node，`dist/cli.js` 又是 esbuild 打好的零依赖单文件
（语料内联，7.5 MB → deflate 后 1.2 MB），所以既不带 `node_modules` 也不带运行时。

`apps/mcp/mcpb/manifest.json` 里的 `version` 必须与 `package.json` 一致 —— 打包脚本会断言，
不一致直接失败（否则分发出去的 bundle 会声称自己是个不存在的版本）。

## 需要你做的：两个网页表单

都需要填**联系邮箱**，我不替你编一个：

- **PulseMCP** — <https://www.pulsemcp.com/submit>
- **mcpservers.org** — <https://mcpservers.org/submit>（免费档 2 周内审；$39 档 24 小时 + dofollow DR71）

两处可复用同一段文案：

> Effect 中文文档（effect-ts.cn）—— Effect (TypeScript) 官方文档的中文译文检索。
> 234 页（v3 + v4），零依赖、离线自包含、无需 API key。每条结果带可核验引用：
> 能点回原文小节，也能看到该译文对着哪次上游提交译的；站内没有依据时明确拒答。
> npm: `effect-ts-cn-mcp` · 安装：`npx -y effect-ts-cn-mcp`
> 仓库：<https://github.com/aaronlou/effect-ts.cn> · 官网：<https://effect-ts.cn/>

## 需要你决定的：付费 dofollow 链接

两个目录把"dofollow 外链"做成了付费项：

| 目录 | 价格 | 内容 |
| --- | --- | --- |
| mcp.so | $39 一次性 | 免审即发、认证徽章、优先展示、**dofollow 链接**（自称 DR 72） |
| mcpservers.org | $39 一次性 | 24 小时审完、官方徽章、搜索优先、**dofollow 链接**（自称 DR 71） |

判断依据（你来定，我不替你花钱）：这个站目前**没有任何有分量的外链**，而外链正是排名为零的根因。
$39 换一条 DR 70+ 的 dofollow，在"买外链"这件事上属于很便宜的一档。
但要注意两点：这两家的 DR 是**它们自己页面上的数字**，第三方工具未必一致；
以及免费档通常也收录（只是 nofollow、审得慢），所以付费买的主要是 dofollow 与速度。

## 不建议做的

- **不要用 `mcp-submit` 这类"一键提交所有目录"的第三方包**。调研时看到过它：只有 `0.1.0`
  一个版本、依赖 `@octokit/rest` 会以你的身份开 PR、而且是交互式的。
  为省两次手写换一个未审的自动化提交器，风险不对等。
- **不要为了上 Smithery 的 URL 通道临时开公网 MCP 端点**。那是一条真实的产品改动
  （Streamable HTTP 传输、限流、成本闸门），不是分发动作。要做就单独做、单独评估。
