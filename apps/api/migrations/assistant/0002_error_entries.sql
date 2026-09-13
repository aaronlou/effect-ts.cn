-- 报错百科：把 /debug 的一次性诊断沉淀成可检索、可链接的公开条目。
--
-- 为什么必须有这张表：诊断此前每次都从零开始 —— 同样的报错被问一千遍就花一千遍钱，
-- 且什么都没留下。有了它，命中同签名的报错是零成本的，而且这份库**越用越厚**。
--
-- 纪律：
--   · `signature` 由 packages/knowledge 的 errorSignature() 计算，是稳定的去重键
--     （绝对路径、行列号、堆栈帧都已归一，同一报错在不同机器上得到同一个值）；
--   · `reviewed` 默认 false —— 展示层必须如实标注"机器生成、未经人审"，
--     不能让人以为这些结论有人确认过；
--   · 条目的答案与引用是**用户提问时那一刻的**快照：译文基线变了以后它可能过时，
--     所以 citations 里保留了 citeUrl，读者可以自己去核对当前内容。

CREATE TABLE IF NOT EXISTS error_entries (
  signature   text PRIMARY KEY,
  codes       text[] NOT NULL DEFAULT '{}',
  symbols     text[] NOT NULL DEFAULT '{}',
  -- 代表性报错样本（截断保存）；只用于展示，不参与去重
  error_text  text NOT NULL,
  -- 用户随报错一起贴的代码（可空，截断保存）
  code        text,
  answer      text NOT NULL,
  -- 引用以 JSON 文本保存：我们从不按引用内部字段查询，换驱动也不用担心 jsonb 绑定差异
  citations   text NOT NULL DEFAULT '[]',
  mode        text NOT NULL,
  hits        integer NOT NULL DEFAULT 1,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  reviewed    boolean NOT NULL DEFAULT false
);

-- 列表按"被问得最多、最近被问到"排序（见 PostgresErrorEncyclopediaLive.list）
CREATE INDEX IF NOT EXISTS error_entries_rank_idx ON error_entries (hits DESC, last_seen DESC);
