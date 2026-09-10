#!/usr/bin/env bash
# 部署前的端口体检：回答"我要用的端口会不会和已有站点/容器打架"。
#
# 用法：
#   bash infra/check-ports.sh            # 用 .env 里的 WEB_PORT（默认 18080）
#   bash infra/check-ports.sh 18081      # 检查指定端口
set -u
CANDIDATE="${1:-}"
if [ -z "$CANDIDATE" ] && [ -f .env ]; then
  CANDIDATE="$(grep -E '^WEB_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]')"
fi
CANDIDATE="${CANDIDATE:-18080}"

echo "── 宿主机正在监听的 TCP 端口（含进程）────────────────"
if command -v ss >/dev/null 2>&1; then
  ss -ltnp 2>/dev/null | awk 'NR==1 || /LISTEN/'
elif command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR==1 || /LISTEN/'
else
  echo "（既没有 ss 也没有 lsof，跳过）"
fi

echo
echo "── Docker 已发布的端口（现有站点的容器）──────────────"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null
else
  echo "（docker daemon 不可用，跳过）"
fi

echo
echo "── 候选端口 ${CANDIDATE} 是否空闲 ─────────────────────"
busy=0
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${CANDIDATE}$"; then busy=1; fi
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"${CANDIDATE}" -sTCP:LISTEN >/dev/null 2>&1; then busy=1; fi
if [ "$busy" = "1" ]; then
  echo "✗ ${CANDIDATE} 已被占用 —— 在 .env 里换个空闲端口，例如 WEB_PORT=18081"
  exit 1
fi
echo "✔ ${CANDIDATE} 空闲。它会以 127.0.0.1:${CANDIDATE} 绑定（仅回环，不暴露公网）"
echo
echo "提示：80/443 由服务器上**已有的 Caddy/Nginx** 占用即可 —— 我们不需要这两个端口。"
