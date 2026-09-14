# 人工审核抽样表（快照 2026-09-14）

> 抽样是**确定性**的（按 repo 名的 hash 排序，与 star 无关），所以同一份 dataset 每次抽到同一批；
> 别人可以用同样的命令复现这张表。
>
> 分母口径见 [methodology §7](../../docs/observatory/methodology.md)：置信度 ≥ 0.70 才自动判定，
> 低于这条线的记为 `uncertain` 且**不计入**统计。这张表要回答的是：
> **自动判定那部分有多准**（精确率），以及**uncertain 里有多少其实是能判的**（召回缺口）。

## 怎么填

最后一列填 **✅（同意）** 或 **❌（不同意）**；不同意的请在 Issue 里说明理由并附一个文件路径作为证据。
填完用下面的公式算，写进 `docs/observatory/classification.md`：

```
精确率 = ✅ 数 / 已填的"判定为 agent"行数
假阳性 = ❌ 中"机器说 agent、人说不是"的条数
召回缺口 = uncertain 行里人判为 agent 的条数 / uncertain 行数
```

**注意**：给区间，不要只给点估计（120 条的样本，95% 置信区间大致 ±9 个百分点）。

## 抽样分层

| 层（语言 × 机器判定） | 总体 | 抽中 |
| --- | ---: | ---: |
| Python × uncertain | 1097 | 27 |
| Python × agent | 934 | 23 |
| TypeScript × agent | 856 | 21 |
| TypeScript × uncertain | 552 | 14 |
| Go × uncertain | 247 | 6 |
| Go × agent | 217 | 5 |
| Rust × uncertain | 206 | 5 |
| TypeScript × not-agent | 204 | 5 |
| Python × not-agent | 192 | 5 |
| Rust × agent | 185 | 5 |
| Java × agent | 83 | 2 |
| Java × uncertain | 74 | 2 |
| Rust × not-agent | 11 | 1 |
| (未知) × uncertain | 1 | 1 |
| Java × not-agent | 1 | 1 |
| Go × not-agent | 1 | 1 |

合计抽样 **124** 条（目标 120）。

## 待审条目

| # | 仓库 | 语言 | ★ | 机器判定 | 类型 | 置信度 | 证据强度 | Effect | 描述 | 人工判定 |
| ---: | --- | --- | ---: | --- | --- | ---: | --- | --- | --- | :---: |
| 1 | [barckley75/resolve-claude-mcp](https://github.com/barckley75/resolve-claude-mcp) | Python | 360 | uncertain | uncertain | 0.45 | metadata | not-scanned | Connect DaVinci Resolve Studio to Claude AI through the Mode |  |
| 2 | [tvytlx/ai-agent-deep-dive](https://github.com/tvytlx/ai-agent-deep-dive) | Python | 5826 | uncertain | uncertain | 0.60 | paths | not-scanned | AI Agent 源码深度研究报告 |  |
| 3 | [TurixAI/TuriX-CUA](https://github.com/TurixAI/TuriX-CUA) | Python | 3160 | uncertain | uncertain | 0.60 | manifest | not-scanned | This is the official website for TuriX Computer-use-Agent |  |
| 4 | [LeonChaoX/qinyan-academic-skills](https://github.com/LeonChaoX/qinyan-academic-skills) | Python | 892 | uncertain | uncertain | 0.60 | paths | not-scanned | A curated, multilingual library of 182 installable AI agent  |  |
| 5 | [motherduckdb/mcp-server-motherduck](https://github.com/motherduckdb/mcp-server-motherduck) | Python | 521 | uncertain | uncertain | 0.60 | paths | not-scanned | Local MCP server for DuckDB and MotherDuck |  |
| 6 | [hitsz-ids/synthetic-data-generator](https://github.com/hitsz-ids/synthetic-data-generator) | Python | 2437 | uncertain | uncertain | 0.45 | metadata | not-scanned | SDG is a specialized framework designed to generate high-qua |  |
| 7 | [RasaHQ/rasa](https://github.com/RasaHQ/rasa) | Python | 21325 | uncertain | uncertain | 0.60 | paths | not-scanned | 💬   Open source machine learning framework to automate text |  |
| 8 | [Ayanami0730/deep_research_bench](https://github.com/Ayanami0730/deep_research_bench) | Python | 829 | uncertain | uncertain | 0.45 | metadata | not-scanned | DeepResearch Bench: A Comprehensive Benchmark for Deep Resea |  |
| 9 | [coji/natural-japanese](https://github.com/coji/natural-japanese) | Python | 1065 | uncertain | uncertain | 0.45 | metadata | not-scanned | 仕事の日本語を、読みやすくわかりやすく書く・直すための Agent Skill です。 |  |
| 10 | [ScrapeGraphAI/Scrapegraph-ai](https://github.com/ScrapeGraphAI/Scrapegraph-ai) | Python | 30916 | uncertain | uncertain | 0.40 | paths | not-scanned | Python scraper based on AI |  |
| 11 | [FrancyJGLisboa/agent-skills-platform](https://github.com/FrancyJGLisboa/agent-skills-platform) | Python | 2384 | uncertain | uncertain | 0.45 | metadata | not-scanned | Build tested agent skills and govern their lifecycle through |  |
| 12 | [2061360308/DouYinSparkFlow](https://github.com/2061360308/DouYinSparkFlow) | Python | 370 | uncertain | uncertain | 0.45 | metadata | not-scanned | 抖音续火花工具，抖音自动续火花，douyin，支持 GitHub Actions 自动运行（开箱即用的 Workflow |  |
| 13 | [petehsu/KiroProxy](https://github.com/petehsu/KiroProxy) | Python | 390 | uncertain | uncertain | 0.40 | paths | not-scanned | 用于开发者工作流的 Kiro 接入兼容层与请求路由服务Open-source compatibility and rou |  |
| 14 | [google-gemma/gemma-skills](https://github.com/google-gemma/gemma-skills) | Python | 987 | uncertain | uncertain | 0.45 | metadata | not-scanned | Skills for the Gemma and model/agent interactions |  |
| 15 | [mine-ai-xyz/mine-ai](https://github.com/mine-ai-xyz/mine-ai) | Python | 375 | uncertain | uncertain | 0.60 | paths | not-scanned | Open-source reference implementations for AI-enabled payment |  |
| 16 | [Bin-Huang/camoufox-cli](https://github.com/Bin-Huang/camoufox-cli) | Python | 341 | uncertain | uncertain | 0.45 | metadata | not-scanned | Anti-detect browser automation CLI & Skills for AI agents —  |  |
| 17 | [decodingai-magazine/llm-twin-course](https://github.com/decodingai-magazine/llm-twin-course) | Python | 4386 | uncertain | uncertain | 0.25 | manifest | not-scanned | 🤖 𝗟𝗲𝗮𝗿𝗻 for 𝗳𝗿𝗲𝗲 how to 𝗯𝘂𝗶𝗹𝗱 an end-to-end � |  |
| 18 | [chen-006/meow-llm-detector](https://github.com/chen-006/meow-llm-detector) | Python | 1335 | uncertain | uncertain | 0.60 | paths | not-scanned | 用于检测ai模型是否真实 |  |
| 19 | [HKUDS/VideoRAG](https://github.com/HKUDS/VideoRAG) | Python | 3365 | uncertain | uncertain | 0.60 | paths | not-scanned | [KDD'2026] "VideoRAG: Chat with Your Videos" |  |
| 20 | [Mathews-Tom/armory](https://github.com/Mathews-Tom/armory) | Python | 318 | uncertain | uncertain | 0.60 | paths | not-scanned | Curated, production-grade skills for AI coding agents. Battl |  |
| 21 | [nWave-ai/nWave](https://github.com/nWave-ai/nWave) | Python | 610 | uncertain | uncertain | 0.40 | paths | not-scanned | AI agents that guide you from idea to working code, with you |  |
| 22 | [LambdaTest/agent-skills](https://github.com/LambdaTest/agent-skills) | Python | 367 | uncertain | uncertain | 0.45 | metadata | not-scanned | AI agent skills for TestMu AI (Formerly LambdaTest). |  |
| 23 | [yuqie6/ProductFlow](https://github.com/yuqie6/ProductFlow) | Python | 303 | uncertain | uncertain | 0.40 | paths | not-scanned | gpt-image-2 画图工作台 / Self-hosted workbench for AI copy, poste |  |
| 24 | [handsome-rich/Awesome-Auto-Research-Tools](https://github.com/handsome-rich/Awesome-Auto-Research-Tools) | Python | 1193 | uncertain | uncertain | 0.10 | metadata | not-scanned | A curated collection of automated research tools, covering l |  |
| 25 | [tuan3w/obsidian-template](https://github.com/tuan3w/obsidian-template) | Python | 1120 | uncertain | uncertain | 0.10 | metadata | not-scanned | Starter templates for Obsidian |  |
| 26 | [chengyi-ai/native-subtitle-quote-image](https://github.com/chengyi-ai/native-subtitle-quote-image) | Python | 678 | uncertain | uncertain | 0.45 | metadata | not-scanned | 保留视频内嵌字幕，精确取帧并生成 3:4 社交长图的 Agent Skill |  |
| 27 | [Human-Agent-Society/CORAL](https://github.com/Human-Agent-Society/CORAL) | Python | 981 | uncertain | uncertain | 0.60 | paths | not-scanned | Open-source autoresearch powered by autonomous coding agents |  |
| 28 | [greyhaven-ai/autocontext](https://github.com/greyhaven-ai/autocontext) | Python | 1292 | agent | mcp-agent | 0.99 | manifest | not-scanned | a recursive self-improving harness designed to help your age |  |
| 29 | [microsoft/agent-framework](https://github.com/microsoft/agent-framework) | Python | 13505 | agent | agent-runtime | 0.83 | paths | not-scanned | A framework for building, orchestrating and deploying AI age |  |
| 30 | [bcefghj/smart-cs-multi-agent](https://github.com/bcefghj/smart-cs-multi-agent) | Python | 413 | agent | mcp-agent | 0.99 | manifest | not-scanned | 智能客服多Agent系统 — 企业级面试项目全攻略 \| Supervisor编排 + 分层记忆 + MCP + 全链路追 |  |
| 31 | [runagent-dev/runagent](https://github.com/runagent-dev/runagent) | Python | 482 | agent | multi-agent | 0.92 | manifest | not-scanned | RunAgent simplifies serverless deployment of your AI agents. |  |
| 32 | [plasma-ai/fractal](https://github.com/plasma-ai/fractal) | Python | 717 | agent | single-agent | 0.72 | paths | not-scanned | Hierarchical agent loops with recursive self-organization. |  |
| 33 | [QJHWC/PaperForge](https://github.com/QJHWC/PaperForge) | Python | 629 | agent | research-agent | 0.72 | paths | not-scanned | End-to-end AI-powered academic paper writing system — from i |  |
| 34 | [666ghj/BettaFish](https://github.com/666ghj/BettaFish) | Python | 42209 | agent | workflow-agent | 0.85 | manifest | not-scanned | 微舆：人人可用的多Agent舆情分析助手，打破信息茧房，还原舆情原貌，预测未来走向，辅助决策！从0实现，不依赖任何框架。 |  |
| 35 | [cognizant-ai-lab/neuro-san-studio](https://github.com/cognizant-ai-lab/neuro-san-studio) | Python | 1077 | agent | single-agent | 0.85 | manifest | not-scanned | A playground for neuro-san |  |
| 36 | [ashishpatel26/500-AI-Agents-Projects](https://github.com/ashishpatel26/500-AI-Agents-Projects) | Python | 37690 | agent | multi-agent | 0.92 | manifest | not-scanned | The 500 AI Agents Projects is a curated collection of AI age |  |
| 37 | [win4r/ClawTeam-OpenClaw](https://github.com/win4r/ClawTeam-OpenClaw) | Python | 1453 | agent | multi-agent | 0.77 | paths | not-scanned | ClawTeam fork fully adapted for OpenClaw — multi-agent swarm |  |
| 38 | [Scottcjn/Rustchain](https://github.com/Scottcjn/Rustchain) | Python | 791 | agent | workflow-agent | 0.83 | paths | not-scanned | Sybil-resistant AI agent network with hardware-attested iden |  |
| 39 | [relari-ai/continuous-eval](https://github.com/relari-ai/continuous-eval) | Python | 517 | agent | single-agent | 0.80 | manifest | not-scanned | Data-Driven Evaluation for LLM-Powered Applications |  |
| 40 | [peteromallet/desloppify](https://github.com/peteromallet/desloppify) | Python | 3120 | agent | agent-runtime | 0.77 | paths | not-scanned | Agent harness to make your slop code well-engineered and bea |  |
| 41 | [neuml/txtai](https://github.com/neuml/txtai) | Python | 12947 | agent | research-agent | 0.83 | paths | not-scanned | 💡 All-in-one AI framework for semantic search, LLM orchestr |  |
| 42 | [zhudotexe/kani](https://github.com/zhudotexe/kani) | Python | 609 | agent | mcp-agent | 0.99 | manifest | not-scanned | kani (カニ) is a highly hackable microframework for tool-calli |  |
| 43 | [brycewang-stanford/StatsPAI](https://github.com/brycewang-stanford/StatsPAI) | Python | 318 | agent | workflow-agent | 0.77 | paths | not-scanned | StatsPAI is the first Agent-native Python library for causal |  |
| 44 | [ZJU-REAL/ClawGUI](https://github.com/ZJU-REAL/ClawGUI) | Python | 1341 | agent | single-agent | 0.85 | manifest | not-scanned | Build, Evaluate, and Deploy GUI Agents — online RL training, |  |
| 45 | [bytedance/deer-flow](https://github.com/bytedance/deer-flow) | Python | 82370 | agent | research-agent | 0.85 | manifest | not-scanned | An open-source long-horizon SuperAgent harness that research |  |
| 46 | [claw-eval/claw-eval](https://github.com/claw-eval/claw-eval) | Python | 773 | agent | agent-runtime | 0.80 | manifest | not-scanned | Claw-Eval is an evaluation harness for evaluating LLM as age |  |
| 47 | [TEN-framework/ten-framework](https://github.com/TEN-framework/ten-framework) | Python | 11121 | agent | workflow-agent | 0.77 | paths | not-scanned |  Open-source framework for conversational voice AI agents |  |
| 48 | [Context-Engine-AI/Context-Engine](https://github.com/Context-Engine-AI/Context-Engine) | Python | 400 | agent | mcp-agent | 0.99 | manifest | not-scanned | Context-Engine MCP - Agentic Context Compression Suite |  |
| 49 | [xunbu/docutranslate](https://github.com/xunbu/docutranslate) | Python | 1300 | agent | mcp-agent | 0.99 | manifest | not-scanned | 文档（小说、论文、字幕）翻译工具（支持 pdf/word/excel/json/epub/srt...）Document |  |
| 50 | [ghost-in-the-droid/android-agent](https://github.com/ghost-in-the-droid/android-agent) | Python | 352 | agent | workflow-agent | 0.85 | manifest | not-scanned | Open-source framework to drive a real phone with AI agents:  |  |
| 51 | [im4codes/imcodes](https://github.com/im4codes/imcodes) | TypeScript | 973 | agent | mcp-agent | 0.99 | manifest | L0 | The IM for agents. Shared Agent Context & Memory, supervised |  |
| 52 | [nexu-io/codex-slides](https://github.com/nexu-io/codex-slides) | TypeScript | 892 | agent | mcp-agent | 0.99 | manifest | L0 | 🎨 Open-source AI slide studio inside Codex: image-native de |  |
| 53 | [agentic-in/inferoa](https://github.com/agentic-in/inferoa) | TypeScript | 561 | agent | agent-runtime | 0.72 | paths | L0 | Inference-native Tokenmaxxing Agent Harness for Loop Enginee |  |
| 54 | [clay-good/OpenLore](https://github.com/clay-good/OpenLore) | TypeScript | 304 | agent | mcp-agent | 0.99 | manifest | L0 | Deterministic, local-first memory and guardrails for AI codi |  |
| 55 | [zai-org/Synapse](https://github.com/zai-org/Synapse) | TypeScript | 508 | agent | mcp-agent | 0.99 | manifest | L0 | Self-hosted AI workspace with shareable AI teammates, shared |  |
| 56 | [Agenta-AI/agenta](https://github.com/Agenta-AI/agenta) | TypeScript | 4750 | agent | workflow-agent | 0.85 | manifest | L1 | Agenta is a workspace where you and your team build agents a |  |
| 57 | [aidenybai/react-grab](https://github.com/aidenybai/react-grab) | TypeScript | 7616 | agent | single-agent | 0.72 | paths | L0 | Copy any UI element for your agent |  |
| 58 | [expo-ai-chatbot/expo-ai-chatbot-lite](https://github.com/expo-ai-chatbot/expo-ai-chatbot-lite) | TypeScript | 460 | agent | multi-agent | 0.97 | manifest | L0 | — |  |
| 59 | [nrwl/nx](https://github.com/nrwl/nx) | TypeScript | 29325 | agent | workflow-agent | 0.85 | manifest | L0 | The Monorepo Platform that amplifies both developers and AI  |  |
| 60 | [Charlie85270/Dorothy](https://github.com/Charlie85270/Dorothy) | TypeScript | 346 | agent | mcp-agent | 0.99 | manifest | L0 | Dorothy, the wife your AI agents needs. |  |
| 61 | [decocms/studio](https://github.com/decocms/studio) | TypeScript | 405 | agent | mcp-agent | 0.99 | manifest | L0 | Open-source control plane for your AI agents. Connect tools, |  |
| 62 | [n8n-io/n8n](https://github.com/n8n-io/n8n) | TypeScript | 204204 | agent | mcp-agent | 0.99 | manifest | L0 | Fair-code workflow automation platform with native AI capabi |  |
| 63 | [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui) | TypeScript | 12136 | agent | mcp-agent | 0.99 | manifest | L0 | Typescript/React Library for AI Chat 💬🚀 |  |
| 64 | [OpenLegged/URDF-Studio](https://github.com/OpenLegged/URDF-Studio) | TypeScript | 474 | agent | single-agent | 0.80 | manifest | L0 | URDF-Studio is a web-based visual URDF robot modeler with 3D |  |
| 65 | [cdinnison/ray-finance](https://github.com/cdinnison/ray-finance) | TypeScript | 303 | agent | single-agent | 0.80 | manifest | L0 | An open-source AI financial advisor that learns your situati |  |
| 66 | [jau123/MeiGen-AI-Design-MCP](https://github.com/jau123/MeiGen-AI-Design-MCP) | TypeScript | 1756 | agent | mcp-agent | 0.99 | manifest | L0 | Supports GPT Image 2, Seedance & ComfyUI, with a 1,400+ prom |  |
| 67 | [Deodat-Lawson/LaunchStack](https://github.com/Deodat-Lawson/LaunchStack) | TypeScript | 886 | agent | workflow-agent | 0.97 | manifest | L0 | AI-powered StartUp Accelerator Engine built with Next.js, La |  |
| 68 | [CaviraOSS/LongMemory](https://github.com/CaviraOSS/LongMemory) | TypeScript | 4495 | agent | mcp-agent | 0.99 | manifest | L0 | Local persistent memory store for LLM applications including |  |
| 69 | [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode) | TypeScript | 27293 | agent | multi-agent | 0.85 | manifest | L4 | Kilo is the all-in-one agentic engineering platform. Build,  |  |
| 70 | [trailhq/Graft](https://github.com/trailhq/Graft) | TypeScript | 7506 | agent | coding-agent | 0.85 | manifest | L0 | Turbocharge Claude Code, Cursor, Codex, Gemini & every codin |  |
| 71 | [aws-samples/bedrock-engineer](https://github.com/aws-samples/bedrock-engineer) | TypeScript | 486 | agent | mcp-agent | 0.99 | manifest | L0 | Universal AI Agent using Amazon Bedrock, capable of customiz |  |
| 72 | [numman-ali/n-skills](https://github.com/numman-ali/n-skills) | TypeScript | 1046 | uncertain | uncertain | 0.45 | metadata | L0 | Curated plugin marketplace for AI agents - works with Claude |  |
| 73 | [AlexSergey/rockpack](https://github.com/AlexSergey/rockpack) | TypeScript | 1132 | uncertain | uncertain | 0.10 | metadata | L0 | Zero-config React with built-in SSR, automated quality gates |  |
| 74 | [leiting-eric/DailyBrief](https://github.com/leiting-eric/DailyBrief) | TypeScript | 354 | uncertain | uncertain | 0.60 | manifest | L0 | AI 每日新闻简报 · GitHub 热门 + X 热门文章 + 行情技术分析 · 23 个数据源聚合 + LLM 中文 |  |
| 75 | [steven-jianhao-li/zotero-AI-Butler](https://github.com/steven-jianhao-li/zotero-AI-Butler) | TypeScript | 1714 | uncertain | uncertain | 0.60 | paths | L0 | 【Zotero AI 管家】调用大模型，自动精读论文库里的论文，总结为Zotero笔记。支持主流大模型平台！您只需像往常 |  |
| 76 | [Tiledesk/design-studio](https://github.com/Tiledesk/design-studio) | TypeScript | 465 | uncertain | uncertain | 0.60 | paths | L0 | Tiledesk's open-source visual, no-code designer where LLM/GP |  |
| 77 | [actions/typescript-action](https://github.com/actions/typescript-action) | TypeScript | 2415 | uncertain | uncertain | 0.10 | metadata | L0 | Create a TypeScript Action with tests, linting, workflow, pu |  |
| 78 | [tarampampam/random-user-agent](https://github.com/tarampampam/random-user-agent) | TypeScript | 760 | uncertain | uncertain | 0.60 | paths | L0 | 😎 Browser extension that automatically replaces the User-Ag |  |
| 79 | [builderz-labs/marketing-dashboard](https://github.com/builderz-labs/marketing-dashboard) | TypeScript | 461 | uncertain | uncertain | 0.65 | paths | L0 | Local-first marketing operations control center for CRM, out |  |
| 80 | [Ahmet-Dedeler/ai-llm-comparison](https://github.com/Ahmet-Dedeler/ai-llm-comparison) | TypeScript | 424 | uncertain | uncertain | 0.45 | metadata | L0 | A website where you can compare every AI Model ✨ |  |
| 81 | [nanbingxyz/mcpsvr](https://github.com/nanbingxyz/mcpsvr) | TypeScript | 315 | uncertain | uncertain | 0.45 | metadata | L0 | Discover Exceptional MCP Servers |  |
| 82 | [EvanBacon/serve-sim](https://github.com/EvanBacon/serve-sim) | TypeScript | 2783 | uncertain | uncertain | 0.60 | paths | L0 | The `npx serve` of Apple Simulators. |  |
| 83 | [Jakubantalik/thinking-orbs](https://github.com/Jakubantalik/thinking-orbs) | TypeScript | 2679 | uncertain | uncertain | 0.45 | metadata | L0 | Dotted thought-orb loading indicators for AI & agent UIs, 9  |  |
| 84 | [my-claude-utils/clsh](https://github.com/my-claude-utils/clsh) | TypeScript | 526 | uncertain | uncertain | 0.45 | metadata | L0 | Access your terminal and your AI agent from any device — pho |  |
| 85 | [1weiho/open-slide](https://github.com/1weiho/open-slide) | TypeScript | 7572 | uncertain | uncertain | 0.40 | paths | L0 | A slide framework built for agents. |  |
| 86 | [DavidCarliez/trustmebro](https://github.com/DavidCarliez/trustmebro) | Go | 468 | uncertain | uncertain | 0.45 | metadata | not-scanned | Bypass llm guardrails by confusing it with fabricated tool o |  |
| 87 | [suzuki-shunsuke/pinact](https://github.com/suzuki-shunsuke/pinact) | Go | 1196 | uncertain | uncertain | 0.60 | paths | not-scanned | pinact is a CLI to edit GitHub Workflow and Composite action |  |
| 88 | [aws/amazon-ssm-agent](https://github.com/aws/amazon-ssm-agent) | Go | 1157 | uncertain | uncertain | 0.65 | paths | not-scanned | An agent to enable remote management of your EC2 instances,  |  |
| 89 | [beelzebub-labs/beelzebub](https://github.com/beelzebub-labs/beelzebub) | Go | 2173 | uncertain | uncertain | 0.40 | paths | not-scanned | A secure low code deception runtime framework, leveraging AI |  |
| 90 | [harbur/captain](https://github.com/harbur/captain) | Go | 777 | uncertain | uncertain | 0.45 | metadata | not-scanned | Captain - Convert your Git workflow to Docker :whale: contai |  |
| 91 | [thewizardshell/froggit](https://github.com/thewizardshell/froggit) | Go | 485 | uncertain | uncertain | 0.45 | metadata | not-scanned | Simplify your Git workflow with visual feedback, keyboard-dr |  |
| 92 | [gastownhall/beads](https://github.com/gastownhall/beads) | Go | 27131 | agent | multi-agent | 0.72 | paths | not-scanned | Beads - A memory upgrade for your coding agent |  |
| 93 | [devspace-sh/devspace](https://github.com/devspace-sh/devspace) | Go | 5182 | agent | multi-agent | 0.83 | paths | not-scanned | DevSpace - The Fastest Developer Tool for Kubernetes ⚡ Autom |  |
| 94 | [infiniflow/ragflow](https://github.com/infiniflow/ragflow) | Go | 90636 | agent | multi-agent | 0.83 | paths | not-scanned | RAGFlow is a leading open-source Retrieval-Augmented Generat |  |
| 95 | [inngest/inngest](https://github.com/inngest/inngest) | Go | 5829 | agent | multi-agent | 0.85 | manifest | not-scanned | The leading workflow orchestration platform.  Run stateful s |  |
| 96 | [rilldata/rill](https://github.com/rilldata/rill) | Go | 2879 | agent | single-agent | 0.83 | paths | not-scanned | The fastest business intelligence tool for humans and agents |  |
| 97 | [neiii/bridle](https://github.com/neiii/bridle) | Rust | 437 | uncertain | uncertain | 0.60 | paths | not-scanned | TUI / CLI config manager for agentic harnesses (Amp, Claude  |  |
| 98 | [nobodywho-ooo/nobodywho](https://github.com/nobodywho-ooo/nobodywho) | Rust | 1107 | uncertain | uncertain | 0.40 | paths | not-scanned | NobodyWho is an inference engine that lets you run LLMs loca |  |
| 99 | [googleworkspace/cli](https://github.com/googleworkspace/cli) | Rust | 30982 | uncertain | uncertain | 0.60 | paths | not-scanned | Google Workspace CLI — one command-line tool for Drive, Gmai |  |
| 100 | [Muvon/octocode](https://github.com/Muvon/octocode) | Rust | 472 | uncertain | uncertain | 0.65 | paths | not-scanned | Structural code intelligence for AI agents — semantic search |  |
| 101 | [withcoral/coral](https://github.com/withcoral/coral) | Rust | 4946 | uncertain | uncertain | 0.65 | paths | not-scanned | One SQL interface over APIs, files, and live sources — built |  |
| 102 | [elevenlabs/ui](https://github.com/elevenlabs/ui) | TypeScript | 2384 | not-agent | llm-app | 0.80 | manifest | L0 | ElevenLabs UI is a component library and custom registry bui |  |
| 103 | [badchars/darknet-mcp-server](https://github.com/badchars/darknet-mcp-server) | TypeScript | 442 | not-agent | other | 0.99 | manifest | L0 | 66-tool MCP server for dark web intelligence — breach data,  |  |
| 104 | [modelcontextprotocol/mcpb](https://github.com/modelcontextprotocol/mcpb) | TypeScript | 2106 | not-agent | other | 0.99 | manifest | L0 | Desktop Extensions: One-click local MCP server installation  |  |
| 105 | [AnotiaWang/deep-research-web-ui](https://github.com/AnotiaWang/deep-research-web-ui) | TypeScript | 2207 | not-agent | llm-app | 0.80 | manifest | L0 | (Supports DeepSeek R1) An AI-powered research assistant that |  |
| 106 | [software-mansion/argent](https://github.com/software-mansion/argent) | TypeScript | 2804 | not-agent | other | 0.99 | manifest | L0 | An agentic toolkit to control, debug, and profile iOS and An |  |
| 107 | [TheR1D/shell_gpt](https://github.com/TheR1D/shell_gpt) | Python | 12283 | not-agent | llm-app | 0.80 | manifest | not-scanned | A command-line productivity tool powered by AI large languag |  |
| 108 | [MeetKai/functionary](https://github.com/MeetKai/functionary) | Python | 1595 | not-agent | llm-app | 0.80 | manifest | not-scanned | Chat language model that can use tools and interpret the res |  |
| 109 | [PaddlePaddle/FastDeploy](https://github.com/PaddlePaddle/FastDeploy) | Python | 3715 | not-agent | llm-app | 0.80 | manifest | not-scanned | High-performance Inference and Deployment Toolkit for LLMs a |  |
| 110 | [FireRedTeam/FireRedASR2S](https://github.com/FireRedTeam/FireRedASR2S) | Python | 679 | not-agent | llm-app | 0.80 | manifest | not-scanned | A SOTA Industrial-Grade All-in-One ASR system with ASR, VAD, |  |
| 111 | [DestinyLinker/MingLi-Bench](https://github.com/DestinyLinker/MingLi-Bench) | Python | 2390 | not-agent | llm-app | 0.80 | manifest | not-scanned | A benchmark for evaluating LLMs on Chinese traditional fortu |  |
| 112 | [afshinm/zerobox](https://github.com/afshinm/zerobox) | Rust | 716 | agent | agent-runtime | 0.80 | manifest | not-scanned | Lightweight, cross-platform process sandboxing powered by Op |  |
| 113 | [xintaofei/codeg](https://github.com/xintaofei/codeg) | Rust | 3432 | agent | coding-agent | 0.85 | manifest | not-scanned | Collaborative multi-agent AI coding workspace: aggregate ses |  |
| 114 | [fabio-rovai/open-ontologies](https://github.com/fabio-rovai/open-ontologies) | Rust | 496 | agent | workflow-agent | 0.77 | paths | not-scanned | AI-native ontology engine: a Rust MCP server with tools for  |  |
| 115 | [mxsm/rocketmq-rust](https://github.com/mxsm/rocketmq-rust) | Rust | 1516 | agent | workflow-agent | 0.77 | paths | not-scanned | 🚀Apache RocketMQ build in  Rust🦀. Faster, safer, and with  |  |
| 116 | [1jehuang/jcode](https://github.com/1jehuang/jcode) | Rust | 19649 | agent | agent-runtime | 0.83 | paths | not-scanned | The most RAM efficient harness |  |
| 117 | [getrebuild/rebuild](https://github.com/getrebuild/rebuild) | Java | 1066 | agent | mcp-agent | 0.72 | paths | not-scanned | 最新版全面支持AI智能！通过自然语言操作业务数据，支持 Skills/工具/知识库/MCP。高度可配置化的国产企业管理系 |  |
| 118 | [conductor-oss/conductor](https://github.com/conductor-oss/conductor) | Java | 32200 | agent | workflow-agent | 0.83 | paths | not-scanned | Conductor is an event driven agentic workflow engine providi |  |
| 119 | [h-mdm/hmdm-android](https://github.com/h-mdm/hmdm-android) | Java | 351 | uncertain | uncertain | 0.45 | metadata | not-scanned | Mobile Device Management (MDM) System for Android (mobile ag |  |
| 120 | [apache/camel-spring-boot-examples](https://github.com/apache/camel-spring-boot-examples) | Java | 357 | uncertain | uncertain | 0.05 | paths | not-scanned | Apache Camel Spring Boot Examples |  |
| 121 | [agent-sh/computer-use-linux](https://github.com/agent-sh/computer-use-linux) | Rust | 535 | not-agent | other | 0.99 | manifest | not-scanned | Linux desktop control over MCP — AT-SPI, GNOME Shell, Waylan |  |
| 122 | [huohuoer/wechat-cli](https://github.com/huohuoer/wechat-cli) | — | 2296 | uncertain | uncertain | 0.45 | metadata | not-scanned | A CLI tool to query your local WeChat data — chat history, c |  |
| 123 | [cyberkaida/reverse-engineering-assistant](https://github.com/cyberkaida/reverse-engineering-assistant) | Java | 829 | not-agent | other | 0.99 | manifest | not-scanned | MCP server for reverse engineering tasks in Ghidra 👩‍💻 |  |
| 124 | [zhoushoujianwork/easyeda-agent](https://github.com/zhoushoujianwork/easyeda-agent) | Go | 429 | not-agent | other | 0.99 | manifest | not-scanned | 嘉立创EDA专业版(EasyEDA Pro)自动化：给 AI harness 装上画板的「手」—— 一套 typed 原 |  |
