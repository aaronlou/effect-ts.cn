#!/usr/bin/env bash
#
# 从**生产服务器**拉取 nginx 访问日志并生成报表。
#
# 为什么需要这个脚本：生产站点在 GCP 上，日志在那边容器的 stdout 里。
# 而本机可能也跑着同名的 `ecn-web` 容器（本地 Docker 复现栈），
# 于是 `docker logs ecn-web` 在本地读到的是**本地那份日志**——
# 看起来一切正常，数字却完全不是线上的。这个坑踩过一次，所以在这里显式分流。
#
# 用法：
#   bash scripts/traffic-prod.sh            # 最近 24 小时
#   bash scripts/traffic-prod.sh 7d         # 最近 7 天（docker logs --since 语法）
#   ECN_SSH_HOST=user@host bash scripts/traffic-prod.sh
#
set -euo pipefail

HOST="${ECN_SSH_HOST:-siyuanlou@34.135.86.160}"
# 密钥与 known_hosts 都可覆盖：不同机器的 SSH 配置不一样，不该把某台的路径写死。
KEY="${ECN_SSH_KEY:-$HOME/.ssh/ecn_deploy_ed25519}"
KNOWN_HOSTS="${ECN_SSH_KNOWN_HOSTS:-$HOME/.ssh/known_hosts}"
SINCE="${1:-24h}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "  从 $HOST 读取最近 $SINCE 的日志…" >&2

# 只取 JSON 行（容器启动脚本会往 stdout 打非 JSON 的行）；
# sudo 是因为服务器上的 docker 需要提权。
# -o StrictHostKeyChecking=accept-new：首次连接自动接受主机指纹（之后固定在 known_hosts 里）。
# 不这么做的话，新机器第一次跑会直接 Host key verification failed —— 而那看起来像"脚本坏了"。
ssh -o BatchMode=yes -o ConnectTimeout=20 -o UpdateHostKeys=no \
    -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$KNOWN_HOSTS" \
    -i "$KEY" "$HOST" \
    "cd ~/effect-ts.cn 2>/dev/null; sudo docker logs ecn-web --since ${SINCE} 2>&1 | grep '^{'" \
  | node "$ROOT/scripts/traffic-report.mjs"
