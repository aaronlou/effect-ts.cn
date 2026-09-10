/**
 * 统一错误契约（wire 层）。
 *
 * 职责：让所有 HTTP 错误在 API 边界收敛为一种可序列化形状 { _tag, message, ... }，
 * 前端与 OpenAPI 只认这一套。领域层/应用层的领域错误绝不直接外泄，
 * 由 interfaces 层（anti-corruption）映射到这里。
 *
 * 实现：Schema.TaggedError —— 同一个类既是“可抛出的错误”，
 * 又是 HttpApiEndpoint.addError 所需的 Schema（自动序列化/反序列化）。
 */
import { Schema } from "effect"

export class BadRequestError extends Schema.TaggedError<BadRequestError>()(
  "BadRequestError",
  { message: Schema.String }
) {}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  { message: Schema.String }
) {}

export class ForbiddenError extends Schema.TaggedError<ForbiddenError>()(
  "ForbiddenError",
  { message: Schema.String }
) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  { message: Schema.String }
) {}

export class ConflictError extends Schema.TaggedError<ConflictError>()(
  "ConflictError",
  { message: Schema.String }
) {}

/** 限流（答案接口按 IP/会话配额） */
export class RateLimitedError extends Schema.TaggedError<RateLimitedError>()(
  "RateLimitedError",
  { message: Schema.String, retryAfterSeconds: Schema.Number }
) {}

/** 兜底内部错误（只暴露给日志，不携带内部细节） */
export class InternalServerError extends Schema.TaggedError<InternalServerError>()(
  "InternalServerError",
  { message: Schema.String }
) {}

/** 全部错误的联合（OpenAPI / 前端解码用） */
export const ApiErrorSchema = Schema.Union(
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitedError,
  InternalServerError
)

export type ApiError = Schema.Schema.Type<typeof ApiErrorSchema>
