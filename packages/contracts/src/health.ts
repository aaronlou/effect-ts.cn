/**
 * 健康检查契约 —— 供前端展示“本站后端由 Effect 驱动”的实时状态。
 */
import { Schema } from "effect"

export const HealthInfo = Schema.Struct({
  status: Schema.Literal("ok", "degraded"),
  service: Schema.String,
  version: Schema.String,
  timestamp: Schema.Date
})

export type HealthInfo = Schema.Schema.Type<typeof HealthInfo>
