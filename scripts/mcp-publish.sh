#!/usr/bin/env bash
#
# 打包 / 发布 MCP server。
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
#   bash scripts/mcp-publish.sh pack       # 只看会打包出什么 —— **不碰 registry、不需要登录**
#   bash scripts/mcp-publish.sh publish    # 真发布（需要登录，或 NPM_TOKEN）
#
set -euo pipefail

export npm_config_cache="${npm_config_cache:-/tmp/ecn-npm-cache}"
export npm_config_logs_dir="${npm_config_logs_dir:-/tmp/ecn-npm-logs}"
mkdir -p "$npm_config_cache" "$npm_config_logs_dir"

cd "$(dirname "${BASH_SOURCE[0]}")/../apps/mcp"

MODE="${1:-publish}"
shift || true

# ── pack：只打包，不发布 ────────────────────────────────────────────────
# 用 `npm pack` 而不是 `npm publish --dry-run`：后者**仍会查询 registry**，
# 于是版本一旦发过就报 "You cannot publish over the previously published versions" ——
# 这让"打包自检"在 CI 里第二次运行必然失败（踩过一次）。
if [ "$MODE" = "pack" ]; then
  exec npm pack --dry-run "$@"
fi

# ── publish ─────────────────────────────────────────────────────────────
# NPM_TOKEN：带 bypass 2FA 的 granular access token。给了它就不需要一次性验证码 ——
# CI 走的就是这条路（见 .github/workflows/publish-mcp.yml）。
# 写在临时 .npmrc 里而不是命令行参数：token 不该出现在进程列表里。
if [ -n "${NPM_TOKEN:-}" ]; then
  NPMRC="$(mktemp)"
  trap 'rm -f "$NPMRC"' EXIT
  printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$NPMRC"
  export NPM_CONFIG_USERCONFIG="$NPMRC"
fi

if ! npm whoami >/dev/null 2>&1; then
  echo "✘ 尚未登录 npm。先跑：npm login（或用 NPM_TOKEN=xxx 走令牌）" >&2
  exit 1
fi

echo "  以 $(npm whoami) 的身份发布 $(node -p "require('./package.json').name")@$(node -p "require('./package.json').version")" >&2
exec npm publish "$@"
