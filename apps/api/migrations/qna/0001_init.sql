-- QnA 上下文初始表结构。
--
-- 由 bootstrap 在启动时应用（见 src/bootstrap/migrations.ts）：
-- 按文件名数字前缀排序，用 `_migrations` 表记账，每个文件在**一个事务**里执行。
-- 编号一旦提交就不可修改 —— 改结构请新增 0002_xxx.sql。

CREATE TABLE IF NOT EXISTS questions (
  id         text PRIMARY KEY,
  title      text NOT NULL,
  body       text NOT NULL,
  author_id  text NOT NULL,
  tags       text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 列表按 created_at 倒序（见 PostgresQuestionRepository.findAll）
CREATE INDEX IF NOT EXISTS questions_created_at_idx ON questions (created_at DESC);
