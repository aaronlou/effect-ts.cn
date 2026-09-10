/**
 * 提供给 MDX 渲染的组件映射：译文里保留官方 Starlight 标签（<Aside>/<Badge>/<Steps>/<Tabs>/<TabItem>），
 * 由这里映射到本站的轻量实现。见 docs/translation-guide.md。
 */
import Aside from "./Aside.astro"
import Badge from "./Badge.astro"
import Steps from "./Steps.astro"
import TabItem from "./TabItem.astro"
import Tabs from "./Tabs.astro"

export const mdxComponents = { Aside, Badge, Steps, Tabs, TabItem }
