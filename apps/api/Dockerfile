# Effect 中文社区 API（Effect + DDD）
#
# 构建（必须在**仓库根目录**执行，需要整个 workspace 上下文）：
#   docker build -f apps/api/Dockerfile -t ecn-api .
# 运行（配合 Postgres；也可以省略 DATABASE_URL 走进程内 InMemory）：
#   docker run --rm -p 8787:8787 -e DATABASE_URL='postgresql://effect:effect@db:5432/effect_ts_cn' ecn-api
#
# 运行时依赖（缺一个就会启动失败，均在下面显式 COPY）：
#   - packages/contracts   → 编译成 dist 后由 api 引用
#   - packages/knowledge   → 直接以 TS 源码被 tsx 加载，且带 data/corpus.json（AI 知识层语料）
#   - docs/glossary.json   → 术语门禁数据源（GlossaryLive 会按 cwd 相对路径查找）
#   - tsx                  → api 的 start 脚本用它直接跑 TS（apps/api 的 devDependency）

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# tini 让 PID 1 正确转发信号（容器内 Ctrl-C / docker stop 才干净）
RUN apk add --no-cache tini && corepack enable
WORKDIR /app

# ---- 依赖层（利用缓存：只拷贝清单文件）----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/knowledge/package.json packages/knowledge/
COPY apps/api/package.json apps/api/
# --filter @ecn/api... 会一并安装它的 workspace 依赖；不加 --prod 以保留 tsx
RUN pnpm install --frozen-lockfile --filter @ecn/api...

# ---- 运行层 ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=deps /app/packages/knowledge/node_modules ./packages/knowledge/node_modules

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/knowledge packages/knowledge
COPY apps/api apps/api
COPY docs/glossary.json docs/glossary.json

# 契约需要先编译（api 运行期 import @ecn/contracts/dist）
RUN pnpm --filter @ecn/contracts build

EXPOSE 8787
# 健康检查用容器内自带的 wget（busybox），不额外装包
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "--filter", "@ecn/api", "start"]
