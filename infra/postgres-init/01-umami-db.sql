-- 自建统计（Umami）用的独立数据库。
--
-- 注意：`docker-entrypoint-initdb.d` 只在**数据卷为空**时执行 ——
-- 已经跑起来的库不会回溯执行。存量部署请手动建一次：
--   docker compose -f infra/docker-compose.prod.yml exec db \
--     psql -U effect -d effect_ts_cn -c 'CREATE DATABASE umami'
CREATE DATABASE umami;
