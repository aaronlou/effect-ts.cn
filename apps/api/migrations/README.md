# migrations

SQL 迁移目录（Phase 1 落地）。

现状（Phase 0 骨架）：为让 `pnpm dev` 无需手工迁移即可跑通，Postgres 仓储在
Layer 构建时执行 `CREATE TABLE IF NOT EXISTS`（见
`src/contexts/qna/infrastructure/persistence/postgres-question-repository.ts`）。

演进计划：
- 引入正式 migration 文件（按 context 分目录），如 `qna/0001_init.sql`；
- 由 bootstrap 在启动时执行（带版本表记录已应用迁移）；
- CI 中增加“迁移可回放”与“测试库一致性”门禁。
