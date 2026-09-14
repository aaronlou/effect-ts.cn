/**
 * 派生产物的自检（CI 门禁的延伸）：**已提交的 dataset 不许和明细打架**。
 *
 * `snapshot.test.ts` 管的是"发现阶段的证据能不能回溯"；这一份管"算出来的结论对不对得上"：
 * `stats.json` 的每个计数必须能由 `dataset.json` 重算、`effect-agents.csv` 里的每一行
 * 必须真的是 L2+。这两件事一旦漂移，报告里的数字就会与数据集不一致 ——
 * 而报告是给人看的、数据集是给人核的，两者对不上时没人知道该信哪个。
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { computeStats, type Dataset } from "../src/dataset.js"
import { splitCsv } from "./csv-helper.js"

const dataRoot = path.resolve(import.meta.dirname, "../data/dataset")

const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, "utf8")) as T

describe("Dataset v0.1 的自洽性", () => {
  it("stats.json 与 dataset.json 能对上（报告里的数字就是从这里来的）", async () => {
    const dataset = await readJson<Dataset>(path.join(dataRoot, "dataset.json"))
    const stats = await readJson<ReturnType<typeof computeStats>>(path.join(dataRoot, "stats.json"))
    const recomputed = computeStats(dataset)
    expect(stats.agents).toBe(recomputed.agents)
    expect(stats.total).toBe(recomputed.total)
    expect(stats.typeScriptAgents).toBe(recomputed.typeScriptAgents)
    expect(stats.effectAgents).toBe(recomputed.effectAgents)
    expect(stats.effectShareOfTypeScriptAgents).toBe(recomputed.effectShareOfTypeScriptAgents)
    expect(stats.effectByDepth).toEqual(recomputed.effectByDepth)
  })

  it("effect-agents.csv 里每一行都真的是 L2+ 的 TypeScript Agent", async () => {
    const csv = await readFile(path.join(dataRoot, "effect-agents.csv"), "utf8")
    const lines = csv.split("\n").filter((line) => line.trim() !== "")
    // 必须用带引号感知的解析器：description 列里有逗号，naive split 会静默错位
    const header = splitCsv(lines[0]!)
    const indexOf = (name: string): number => header.indexOf(name)
    expect(indexOf("effect_depth")).toBeGreaterThan(-1)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines.slice(1)) {
      const cells = splitCsv(line)
      const depth = cells[indexOf("effect_depth")]!
      const language = cells[indexOf("github_language")]!
      const isAgent = cells[indexOf("is_agent")]!
      expect(["L2", "L3", "L4"], `effect-agents.csv 里有非 L2+ 的行：${line.slice(0, 80)}`).toContain(depth)
      expect(language).toContain("TypeScript")
      expect(isAgent).toContain("true")
    }
  })

  it("dataset 的行数 = 候选池规模（不许在各阶段悄悄丢仓库）", async () => {
    const dataset = await readJson<Dataset>(path.join(dataRoot, "dataset.json"))
    const candidates = await readJson<{ candidates: ReadonlyArray<unknown> }>(
      path.resolve(import.meta.dirname, "../../../packages/observatory/data/snapshots/2026-09-14/candidates.json")
    ).catch(() => undefined)
    if (candidates === undefined) return // 快照不在（例如浅克隆）就跳过
    expect(dataset.rows.length).toBe(candidates.candidates.length)
  })

  it("每一行都带可回溯的 via（结论能一路回到具体查询）", async () => {
    const dataset = await readJson<Dataset>(path.join(dataRoot, "dataset.json"))
    const missing = dataset.rows.filter((row) => row.via.length === 0)
    expect(missing.map((row) => row.repo)).toEqual([])
  })
})
