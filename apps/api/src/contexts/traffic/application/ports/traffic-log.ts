/**
 * Traffic 上下文 · 端口：访问日志。
 *
 * 定位：把"服务器上那份访问记录"抽象成"能按时间窗取出一批已分类的访问事件"。
 * 具体是 Caddy 日志、nginx 日志还是别的，domain 不关心 —— 它只认 `TrafficEvent`。
 */
import { Context, Data, type Effect } from "effect"
import type { TrafficEvent } from "../../domain/traffic-event.js"

/**
 * 日志读不到（目录没挂载、权限不对、文件被删）。
 *
 * **要显式建模而不是返回空数组**：空数组会被上层解读成"这段时间没人来"，
 * 而事实是"我们根本没读到数据"—— 这两件事在报表上是完全相反的结论。
 * 部署时忘了挂载 `/var/log/caddy` 就是这个错误，必须让人一眼看出来。
 */
export class TrafficLogUnavailable extends Data.TaggedError("TrafficLogUnavailable")<{
  readonly message: string
}> {}

export interface TrafficLogReadResult {
  readonly events: ReadonlyArray<TrafficEvent>
  /** 实际读到的日志文件数（含轮转备份）—— 0 说明挂载有问题 */
  readonly logFiles: number
}

export interface TrafficLogService {
  /**
   * 读取 `since` 之后的所有访问事件。
   *
   * 返回**全部原始事件**而不是聚合结果：分桶、去重、排名都是 domain 的事，
   * 换一种报表口径不该动适配器。
   */
  readonly readSince: (since: Date) => Effect.Effect<TrafficLogReadResult, TrafficLogUnavailable>
}

export const TrafficLog = Context.GenericTag<TrafficLogService>("traffic/TrafficLog")
