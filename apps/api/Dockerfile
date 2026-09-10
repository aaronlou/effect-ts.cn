# Effect 中文社区 API（Effect + DDD）—— 参考 Dockerfile
#
# 构建（在仓库根目录执行，需要整个 workspace 上下文）：
#   docker build -f apps/api/Dockerfile -t ecn-api .
# 运行：
#   docker run -p 8787:8787 -e DATABASE_URL='postgresql://...' ecn-api
#
# 说明：未在本机验证（开发环境未运行 docker daemon），首次使用请先本地构建确认。

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---- 依赖层（利用缓存：只拷贝清单文件）----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @ecn/api...

# ---- 运行层 ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api

# 契约需要先编译（api 运行期会 import @ecn/contracts/dist）
RUN pnpm --filter @ecn/contracts build

EXPOSE 8787
CMD ["pnpm", "--filter", "@ecn/api", "start"]
