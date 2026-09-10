/**
 * 共享内核（Shared Kernel）：跨限界上下文复用的 Branded ID。
 * 用 Brand 让不同上下文的 ID 在类型上互不相通，杜绝“拿错 ID”这类低级错误。
 */
import { Brand } from "effect"

export type UserId = string & Brand.Brand<"UserId">
export const UserId = Brand.nominal<UserId>()

export type QuestionId = string & Brand.Brand<"QuestionId">
export const QuestionId = Brand.nominal<QuestionId>()

export type AnswerId = string & Brand.Brand<"AnswerId">
export const AnswerId = Brand.nominal<AnswerId>()

/** 标签：值对象（小写、trim 后去重，约束见 domain 工厂） */
export type Tag = string & Brand.Brand<"Tag">
export const Tag = Brand.nominal<Tag>()
