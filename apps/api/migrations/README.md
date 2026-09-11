# migrations

SQL 迁移目录。**表结构的唯一事实来源** —— 仓储里不再有任何 DDL。

## 现状

- `bootstrap` 在启动时应用迁移（见 `src/bootstrap/migrations.ts`），**先迁移、再监听**：
  迁移失败会让进程直接启动失败，不会带着半套表结构对外服务。
- 记账表 `_migrations`（id / name / applied_at）；每个文件在**一个事务**里执行。
- 仓库里已有 `qna/0001_init.sql`。

## 约定

| 约定 | 说明 |
| --- | --- |
| 文件名 | `NNNN_name.sql`（数字前缀决定顺序）；按 context 分子目录，如 `qna/0001_init.sql` |
| 编号 | 全局唯一，重复会让启动失败（宁可失败也不乱序执行） |
| 不可修改 | 已提交的迁移编号不可改内容 —— 改结构请新增 `0002_xxx.sql` |
| 幂等 | 迁移自身仍需可重入（如 `CREATE TABLE IF NOT EXISTS`），便于回放验证 |

## 门禁

CI 的 `postgres` job 起一个真实 Postgres，跑
`apps/api/test/migrations/postgres-migrations.test.ts`：
空库应用迁移 → 记账正确 → 重复运行幂等 → 仓储 `save/findById/findAll` 往返一致。
未设置环境变量时本地默认跳过；本地想跑：

```bash
docker run -d --name ecn-pg-test -e POSTGRES_USER=effect -e POSTGRES_PASSWORD=effect \
  -e POSTGRES_DB=effect_ts_cn_test -p 55432:5432 postgres:16-alpine
ECN_TEST_DATABASE_URL='postgresql://effect:effect@127.0.0.1:55432/effect_ts_cn_test' \
  pnpm --filter @ecn/api test
```

> 测试库连接串里必须含 `test`：测试会 `DROP TABLE` 重建 schema，
> 这条护栏用于防止误连开发/生产库。

## 待办

- Phase 2：`answers` 表与采纳流程（当前聚合里的 answers 仍未落库）。
- 迁移的「锁」：目前依赖单实例启动；多副本并发启动时 PostgreSQL 的
  `CREATE TABLE IF NOT EXISTS` 目录竞争是已知边界（`@effect/sql` 的 Migrator 带锁，
  但它不认 `.sql` 文件，见 `src/bootstrap/migrations.ts` 顶部说明）。
