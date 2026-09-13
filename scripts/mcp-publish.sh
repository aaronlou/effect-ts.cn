#!/usr/bin/env bash
#
# 发布 MCP server 到 npm。
#
# 存在的理由是两个**都会让人以为"包有问题"**的失败模式：
#
#   1. **目录走错**：必须在 `apps/mcp/` 下执行，否则 npm 会去找 `apps/package.json` 并报
#      ENOENT —— 那个报错完全看不出真正的原因是"少 cd 了一层"。
#   2. **npm 日志目录不可写**：`~/.npm` 里若混进了 root 所有的文件（历史遗留），
#      npm 会以 "Log files were not written" 直接失败，而它和包本身毫无关系。
#      把 cache 与 logs 指到临时目录即可绕开；根治办法是 `sudo chown -R 501:20 ~/.npm`。
#
# 用法：
#   bash scripts/mcp-publish.sh --dry-run     # 先看会发布什么，不上传
#   bash scripts/mcp-publish.sh               # 真发布
#
set -euo pipefail

export npm_config_cache="${npm_config_cache:-/tmp/ecn-npm-cache}"
export npm_config_logs_dir="${npm_config_logs_dir:-/tmp/ecn-npm-logs}"
mkdir -p "$npm_config_cache" "$npm_config_logs_dir"

cd "$(dirname "${BASH_SOURCE[0]}")/../apps/mcp"

if ! npm whoami >/dev/null 2>&1; then
  echo "✘ 尚未登录 npm。先跑：npm login" >&2
  exit 1
fi

echo "  以 $(npm whoami) 的身份发布 $(node -p "require('./package.json').name")@$(node -p "require('./package.json').version")" >&2
exec npm publish "$@"
