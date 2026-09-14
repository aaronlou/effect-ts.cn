/**
 * Assistant 上下文 · 端口：答案缓存
 *
 * 为什么必须有：Effect 的报错与问题重复率极高，缓存能把成本与延迟压到近乎免费；
 * 同时它让我们在"模型不可用/超预算"时依然能快速给出**已验证过**的答案。
 */
import { Context, Effect } from "effect"

export interface AnswerCacheService {
  readonly getOrCompute: <A, E, R>(
    key: string,
    compute: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>
  /**
   * 只查不写：命中率是**成本指标**（命中即零 token），
   * 而 `getOrCompute` 的调用方无法区分"算出来的"与"取出来的"，所以单独开一个读口。
   * 允许它与随后的 `getOrCompute` 之间存在竞态 —— 度量不需要精确到并发级别。
   */
  readonly peek: (key: string) => Effect.Effect<boolean>
}

export const AnswerCache = Context.GenericTag<AnswerCacheService>("assistant/AnswerCache")
