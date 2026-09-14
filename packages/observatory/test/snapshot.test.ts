/**
 * 快照自检（CI 门禁）：**已提交的证据不许自相矛盾**。
 *
 * 对 `data/snapshots/` 下的每一期快照跑一遍结构校验：汇总能否由明细重算、
 * 每条候选能否回溯到真实查询、去重规则说的和做的是否一致。
 * 这条门禁的价值与内容门禁同源 —— 数字看起来永远是对的，所以必须机器来盯。
 */
import { describe, expect, it } from "vitest"
import path from "node:path"
import { listSnapshots, verifySnapshot } from "../src/verify.js"

const snapshotsRoot = path.resolve(import.meta.dirname, "../data/snapshots")

describe("已提交快照的自洽性", () => {
  it("至少有一期快照（没有快照说明流水线还没跑过，报告就没有数据可依）", async () => {
    const snapshots = await listSnapshots(snapshotsRoot)
    expect(snapshots.length, "data/snapshots/ 下没有快照").toBeGreaterThan(0)
  })

  it("每一期快照都通过结构校验", async () => {
    const snapshots = await listSnapshots(snapshotsRoot)
    for (const snapshot of snapshots) {
      const result = await verifySnapshot(path.join(snapshotsRoot, snapshot))
      expect(result.issues, `快照 ${snapshot} 有问题：\n  ${result.issues.join("\n  ")}`).toEqual([])
      expect(result.candidates).toBeGreaterThan(0)
    }
  })
})
