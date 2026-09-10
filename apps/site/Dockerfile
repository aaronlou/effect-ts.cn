# Effect 中文社区站点（Astro 静态产物 + Nginx）
#
# 构建（**仓库根目录**执行）：
#   docker build -f apps/site/Dockerfile -t ecn-site .
# 运行（需要同时存在名为 api 的服务或改 nginx.conf 的上游地址）：
#   docker run --rm -p 8080:80 ecn-site
#
# 说明：站点本身是纯静态的（内容 + 搜索索引 + llms.txt + /cite/* 全在构建期生成），
# 这个镜像只是「自带 Nginx 与 /api 反代」的分发形态；用静态托管（Pages/对象存储+CDN）同样可行。

FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/knowledge/package.json packages/knowledge/
COPY apps/site/package.json apps/site/
RUN pnpm install --frozen-lockfile --filter @ecn/site...

COPY packages/contracts packages/contracts
COPY packages/knowledge packages/knowledge
COPY apps/site apps/site
RUN pnpm --filter @ecn/contracts build \
 && pnpm --filter @ecn/site build

FROM nginx:1.27-alpine AS runtime
COPY apps/site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/site/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
