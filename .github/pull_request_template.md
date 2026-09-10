<!-- 谢谢你的 PR！请填写下面信息，并确认自查项。 -->

## 这个 PR 做了什么

<!-- 一句话说明；若是译文，请写页面路径 -->

## 类型

- [ ] 新增/更新译文
- [ ] 站点功能或样式
- [ ] 后端（apps/api）
- [ ] 内容管线 / CI
- [ ] 文档（README / 指南 / 规划）

## 自查（CI 会跑同样的检查）

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 通过
- [ ] `pnpm build` 通过
- [ ] （译文）`pnpm content:check` 通过：frontmatter 必填、路径与 `upstreamPath` 镜像、无禁用译法、无 `twoslash`/`@astrojs/starlight` 等残留
- [ ] （译文）代码块内容与上游**逐字节一致**，仅保留语言标记
- [ ] （译文）已保留官方组件标签（`<Aside>`/`<Steps>`/`<Tabs>`/`<TabItem>`），未保留框架 import

## 关联 Issue

<!-- 例如：Closes #12 -->
