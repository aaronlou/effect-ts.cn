# 别再问 AI「这个库怎么用」了，把文档喂给它

先说一个你大概遇到过的场景。

你问 AI：「Effect 的 Layer 怎么用？」它答得很流畅，给了三段代码，讲了 `Layer.succeed`、`Layer.effect`、`Layer.provide` 的区别。你照着写，卡在第三个 API 上 —— 因为那个名字**在官方文档里根本搜不到**。

这不怪模型。它对一个具体的库的中文知识，来自**英文训练数据加现场翻译**：版本可能过时、v3 和 v4 可能混着讲、API 名可能记串，而且**它给出的东西你没法核对**。

我们习惯了"问 AI"，但更可靠的做法其实是反过来的：**别指望它记得，给它资料。**

## 一句话：MCP 是什么

[MCP](https://modelcontextprotocol.io/)（Model Context Protocol）是一个让 AI 助手调用外部工具的协议。你可以理解成**给 AI 装插件**：

装上一个文档检索服务，它就能在你提问时**真去查那份文档**，而不是从记忆里翻。

这比"把文档粘进 prompt"好在三件事：

| | 粘进 prompt | MCP |
| --- | --- | --- |
| 覆盖范围 | 你手动找的那几页 | 整个语料（234 页） |
| 上下文占用 | 全塞进对话，很快就爆 | 按需检索，只取相关小节 |
| 可核验 | 它引用的是你贴的那段 | 每条引用带锚点，能点回原文 |

## 装上之后是什么样

我做了个 **Effect 官方文档中文译文**的 MCP server。装上之后，同样是问「Effect 的 Layer 怎么用」，你的助手拿到的不是记忆，而是这个：

```
1. 《管理 Layer》› 组合 Layer › 组合 Layer（含代码示例）
2. 《Layer 的记忆化》（含代码示例）
3. 《DateTime》› 用于当前时区的 Layer

引用：
- 《管理 Layer》 /docs/v4/requirements-management/layers/#组合-layer-1（基线 a915662）
  引用 ID：ecn:v4/requirements-management/layers@a915662#组合-layer-1
  核验地址：/cite/fa40c2c6bf11f711.json（含原文片段、内容指纹与上游文件）
  原文：Layer 可以使用 Layer.provide 函数进行组合：
```

注意几个细节：

- **每一条都指到小节**（`#组合-layer-1`），不是笼统的"参考官方文档"；
- **带翻译基线**（`a915662`）—— 这一页是对着上游哪次提交译的，写明了；
- **有核验地址** —— 点开是个 JSON，里面有引文原文、内容指纹、上游文件的路径。

## 「可核验」这件事值得单独说

大部分 AI 回答的问题是：**你没法知道它是编的还是真的。**

所以这个服务给出的每条引用都能解开。核验记录长这样：

```json
{
  "citationId": "ecn:v4/getting-started/running-effects@16b1646#runpromise",
  "slug": "v4/getting-started/running-effects",
  "anchor": "runpromise",
  "deepLink": "/docs/v4/getting-started/running-effects/#runpromise",
  "officialUrl": "https://effect.website/docs/v4/getting-started/running-effects",
  "upstreamPath": "v4/getting-started/running-effects.mdx"
}
```

也就是说：**助手说的每一句话，你都能回到那一页、那一段，再对照英文原文确认。**

对学一个新库来说，这比"答案看起来对"重要得多 —— 你会照着它写代码，然后在一个不存在的 API 上卡半小时。

## 怎么装

零依赖、离线自包含（语料已经打进包里，不需要联网）。

**Claude Code：**

```bash
claude mcp add effect-ts-cn -- npx -y effect-ts-cn-mcp
```

**Cursor / Claude Desktop / 其它 MCP 客户端**，在配置里加：

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

装完你的助手就多了六个工具：`search_docs`（检索）、`get_page`（取整页）、`ask`（就译文提问）、`glossary`（术语）、`translation_status`（覆盖与基线）、`cite`（取核验记录）。

## 完整的一轮长什么样

值得看一眼它不是"另一个搜索框"，而是你助手的**一次工具调用**：

```
你：Effect 里的 Layer 和 Context 是什么关系？

助手 → 调用 search_docs("Layer Context 关系")
     ← 《管理服务》› 使用 Context.Service 定义 Service（含代码示例）
       《管理 Layer》› 组合 Layer（含代码示例）
       ...
助手：Context 用来"定义服务长什么样"（Tag），Layer 用来"给出这个服务的实现"。
      《管理服务》里给的例子是……（附引用链接）
```

关键是最后那一步里的引用 —— **它不是修辞，是可以点开的**。

## 装完怎么确认它生效了

在你的助手那边问一句：

```
列出你可用的 Effect 相关工具
```

它应该能说出 `search_docs` / `get_page` / `ask` 这几个。说不出来就是没连上 ——
可以先用 `npx -y effect-ts-cn-mcp` 单独跑一下，它会往 stderr 打一行启动信息。

## 它的边界，我也说清楚

写这种文章最容易犯的错是把工具吹得比实际好。所以：

- **它是检索层，不是问答神谕。** 检索质量取决于你的用词和文档用词的匹配程度。实测：问「怎么设置超时？」「怎么重试？」这类**词对得上**的，能精准命中；问「并发跑多个 Effect」这种用词和文档标题不一致的，可能会漂到相邻页面。（这个我还在改。）
- **找不到依据时它会直说「文档里没有讲」**，不编。这是刻意的：学新东西时，一个编出来的解释比一句"不知道"危险得多。
- **只覆盖 Effect。** 这是为它做的。
- **译文是机器起草 + 机器校验的**，没有经过人类逐篇精读。术语门禁、代码块与上游逐字节比对、引用可解引用都是自动门禁在守，但**它意味着可用，不意味着没有错**。

## 一个可以迁移的做法

这套做法的价值不止于 Effect。**任何一个中文资料稀缺的库，都值得给它一个"资料来源"。**

顺序是这样的：

1. 找到那份**权威文本**（官方文档、RFC、源码注释）
2. 让它**可被机器读取**（结构化、带锚点、能定位到段落）
3. 通过 MCP / HTTP / 静态文本**接进你的 AI 工作流**
4. 每条输出**可核验** —— 这一步最容易被跳过，但它决定了你敢不敢用

第 4 步是关键。没有它，你只是把"从记忆里编"换成了"从检索结果里编"。

---

> 这个 MCP server 背后是 [effect-ts.cn](https://effect-ts.cn/)：Effect 官方文档 v3 + v4 共 **234 页**全量中文译文，每页标注译者与上游基线 commit；另有 [报错百科](https://effect-ts.cn/errors/)（真实报错的检索索引）。
>
> 源码：[github.com/aaronlou/effect-ts.cn](https://github.com/aaronlou/effect-ts.cn)。非官方社区项目。
