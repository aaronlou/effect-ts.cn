/**
 * `@ecn/content` 的对外出口。
 *
 * 为什么现在才加：内容管线 CLI 一直自给自足，没有跨包消费者。
 * 观测台要复用**已经用真实数据校准过**的 Effect 判定与全仓扫描
 * （`ecosystem.ts` 的判据 + `ecosystem-collect.ts` 的 tarball 扫描），
 * 而不是把它抄一遍 —— 抄一遍意味着两套判据，早晚会给出两个数字。
 */
export * from "./ecosystem.js"
export * from "./ecosystem-collect.js"
