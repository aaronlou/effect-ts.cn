/**
 * 领域事件发布端口（跨上下文协作的接缝）。
 *
 * 现状：Phase 0 使用日志实现（进程内直接调用）。
 * 演进：跨上下文/可恢复需求出现后，替换为 outbox 表 + 消费者
 * （写库事务内落 outbox → 后台 Fiber 投递），见 PLAN.md §5.3。
 */
import { Context, Effect, Layer } from "effect"

/** 结构化的领域事件信封（具体事件在各自 context 中定义） */
export interface DomainEvent {
  readonly _tag: string
}

export interface EventPublisher {
  readonly publish: (event: DomainEvent) => Effect.Effect<void>
}

export const EventPublisher = Context.GenericTag<EventPublisher>("shared/EventPublisher")

/** 默认实现：记录日志（方便看到事件流，替代无用的 no-op） */
export const LoggingEventPublisher = Layer.succeed(EventPublisher, {
  publish: (event) =>
    Effect.log(`[domain-event] ${event._tag}`).pipe(
      Effect.annotateLogs("event", event)
    )
})
