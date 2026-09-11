/**
 * 迁移执行器：纯函数部分（不连数据库）。
 *
 * 为什么值得单独测：迁移顺序错了不会报错、只会**静默建错结构** ——
 * 必须在执行前把「排序 / 编号重复 / 递归子目录」这几件事钉死。
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { collectMigrations } from "../../src/bootstrap/migrations"

let dir: string

const fixture = async (relative: string, content = "SELECT 1;"): Promise<void> => {
  const full = path.join(dir, relative)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, content, "utf8")
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ecn-migrations-"))
})

afterAll(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
})

describe("collectMigrations", () => {
  it("按数字前缀升序排列，并且递归子目录（qna/0001_init.sql 这种布局）", async () => {
    await fixture("qna/0002_answers.sql")
    await fixture("qna/0001_init.sql")
    await fixture("identity/0010_users.sql")
    await fixture("not-a-migration.sql") // 没有数字前缀 → 忽略
    await fixture("README.md") // 非 sql → 忽略

    const files = await Effect.runPromise(collectMigrations(dir))
    expect(files.map((file) => file.id)).toEqual([1, 2, 10])
    expect(files.map((file) => file.name)).toEqual(["init", "answers", "users"])
  })

  it("编号重复 → 报错（宁可启动失败，也不乱序执行）", async () => {
    const dup = await mkdtemp(path.join(tmpdir(), "ecn-migrations-dup-"))
    try {
      await writeFile(path.join(dup, "0001_a.sql"), "SELECT 1;", "utf8")
      await writeFile(path.join(dup, "0001_b.sql"), "SELECT 1;", "utf8")
      const result = await Effect.runPromise(Effect.either(collectMigrations(dup)))
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left.reason).toBe("duplicate-id")
        expect(result.left.message).toContain("0001")
      }
    } finally {
      await rm(dup, { recursive: true, force: true })
    }
  })

  it("目录不存在 → read 错误（而不是静默当空）", async () => {
    const result = await Effect.runPromise(Effect.either(collectMigrations(path.join(dir, "nope"))))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") expect(result.left.reason).toBe("read")
  })

  it("仓库里真实存在的 migrations/ 目录本身是合规的（编号唯一、非空）", async () => {
    const real = fileURLToPath(new URL("../../migrations", import.meta.url))
    const files = await Effect.runPromise(collectMigrations(real))
    expect(files.length).toBeGreaterThan(0)
    // 编号唯一性由 collectMigrations 保证（否则会 Left），这里再断言一次便于定位
    expect(new Set(files.map((file) => file.id)).size).toBe(files.length)
    expect(files.some((file) => file.name === "init")).toBe(true)
  })
})
