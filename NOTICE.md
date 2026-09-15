# 许可说明（NOTICE）

## 代码

本站代码以 **MIT** 许可发布，许可证全文见 [LICENSE](./LICENSE)。

## 内容（译文）

`apps/site/src/content/` 下的中文译文翻译自 Effect 官方文档仓库
[Effect-TS/website](https://github.com/Effect-TS/website)，遵循其 **MIT** 许可。

每个页面都在 frontmatter 里标注原文路径（`upstreamPath`）与翻译时所对照的上游 commit
（`upstreamCommit`），页面上也会给出官方原文地址 —— 这样任何一条译文都能回溯到它的英文原文
和当时的基线，而不只是"某处抄来的中文"。

## 商标与非官方声明

本站是**非官方**社区站，与 [effect.website](https://effect.website/) / Effectful Technologies
**无隶属关系**。Effect 相关名称与标识归其各自权利人所有，使用遵循官方品牌指引。

---

> **为什么这份文件不写在 LICENSE 里**：GitHub 的许可证识别要求 `LICENSE` 是**纯许可证正文**。
> 早先这份说明被追加在 MIT 正文之后，结果是整个仓库被判成 `NOASSERTION`（显示为 "Other"）——
> 仓库明明声明了 MIT，GitHub 和下游工具却读不出许可证。而"可识别的 OSS 许可证"是多个
> MCP 目录的**准入条件**（加上 `verify-submission-liveness` 这类检查也会报警）。
> 所以正文与说明分离：`LICENSE` 保持逐字标准，说明放这里。
