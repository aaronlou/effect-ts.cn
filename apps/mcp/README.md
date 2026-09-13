# effect-ts-cn-mcp

**Effect 官方文档中文译文的 MCP Server** —— 让你的 AI 编码助手直接检索 234 页中文文档，
每条结果都带**可核验的引用**（能点回原文、能看到该译文对着哪次上游提交译的）。

> 非官方社区项目。站点：[effect-ts.cn](https://effect-ts.cn/) · 源码：[GitHub](https://github.com/aaronlou/effect-ts.cn)

## 为什么需要它

在中文环境里问 AI「Effect 的 Layer 怎么用」，模型只能拿英文训练数据**现场翻译**一个答案 ——
版本可能过时，v3/v4 可能混淆，也没有出处可查。

装上这个 MCP server 之后，你的助手拿到的是**现成的中文语料**，而且是带溯源的那种。

## 安装

零依赖、离线自包含（语料已内联进产物，不需要联网）。

```bash
npx -y effect-ts-cn-mcp
```

### Claude Code

```bash
claude mcp add effect-ts-cn -- npx -y effect-ts-cn-mcp
```

### Cursor / Claude Desktop / 其它 MCP 客户端

在 MCP 配置里加：

```json
{
  "mcpServers": {
    "effect-ts-cn": {
      "command": "npx",
      "args": ["-y", "effect-ts-cn-mcp"]
    }
  }
}
```

## 提供什么

| 工具 | 作用 |
| --- | --- |
| `search_docs` | 检索中文译文，返回小节 + 锚点 + 官方原文链接 |
| `get_page` | 取整页译文 Markdown |
| `ask` | 就站内译文提问，**只从译文里找依据**；找不到就直说"文档里没有讲"，不编 |
| `glossary` | 术语门禁（哪些词必须保留英文） |
| `translation_status` | 覆盖情况与上游基线 |
| `cite` | 取某条引用的核验记录：引文原文、内容指纹、锁定的上游链接 |

## 它不会做

- **不会编答案。** 找不到依据时它说"文档里没有讲"，而不是给一个看起来对的解释 ——
  学一个新库时，编出来的解释比一句"不知道"危险得多。
- **不会改代码块。** 译文里的代码块与上游**逐字节一致**，这是 CI 门禁强制的。
- **不收集你的任何数据。** 纯本地 stdio，不联网（除了你自己点引用链接）。

## 覆盖范围

官方文档 v4 + v3 共 **234 页**全量中文译文，每页 frontmatter 记录译者与上游基线 commit；
上游更新后会被标记为 `stale`。站上另有[报错百科](https://effect-ts.cn/errors/)
（真实报错的检索索引）与 [llms.txt](https://effect-ts.cn/llms.txt)。

## License

MIT。译文遵循上游 [Effect-TS/website](https://github.com/Effect-TS/website) 的 MIT 许可。
