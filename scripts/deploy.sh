#!/usr/bin/env bash
# LumenLab 发布硬化部署脚本
#
# 用法:
#   scripts/deploy.sh deploy [commit] [--skip-ci-check]  部署指定 commit(默认 origin/main HEAD)
#   scripts/deploy.sh rollback                           回滚到上一个 release
#   scripts/deploy.sh status                             查看当前发布状态
#   scripts/deploy.sh bootstrap [--skip-ci-check]        首次迁移:安装 systemd/Nginx 并部署首个 release
#
# 安全约束:不回显 .env 内容;rm -rf 仅作用于 build/ 树与超龄 release;
# 共享 .env、uploads/、.lumenlab/ 永不在清理范围。

set -euo pipefail

SSH_HOST="${DEPLOY_SSH_HOST:-remoteDev}"
REPO_SLUG="mkynyd/lumenlab"
APP_ROOT="/www/wwwroot/course-ai-lab"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log()  { printf '[deploy] %s\n' "$*"; }
warn() { printf '[deploy] WARN: %s\n' "$*" >&2; }
die()  { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
用法:
  scripts/deploy.sh deploy [commit] [--skip-ci-check]
  scripts/deploy.sh rollback
  scripts/deploy.sh status
  scripts/deploy.sh bootstrap [--skip-ci-check]
EOF
  exit 1
}

remote() { ssh -o BatchMode=yes -o ServerAliveInterval=30 "$SSH_HOST" "$@"; }

github_token() {
  if gh auth token >/dev/null 2>&1; then
    gh auth token
    return
  fi
  printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p'
}

# CI 门禁:success 直接放行;无记录仅允许 --skip-ci-check;pending/failure 一律拒绝。
ci_gate() {
  local sha="$1" skip="$2"
  local token
  token="$(github_token || true)"
  if [ -z "$token" ]; then
    [ "$skip" = "true" ] || die "无 GitHub 凭据,无法验证 CI 状态;确认后加 --skip-ci-check"
    warn "无 GitHub 凭据,已跳过 CI 门禁"
    return 0
  fi
  local verdict
  verdict="$(GH_TOKEN="$token" gh api "repos/$REPO_SLUG/commits/$sha/check-runs?per_page=100" --jq '
    if (.check_runs | length) == 0 then "none"
    elif ([.check_runs[] | select(.status != "completed")] | length) > 0 then "pending"
    elif ([.check_runs[] | select(.conclusion != "success" and .conclusion != "skipped" and .conclusion != "neutral")] | length) > 0 then "failure"
    else "success" end' 2>/dev/null || echo "none")"
  case "$verdict" in
    success) log "CI 门禁通过: $sha" ;;
    none)
      [ "$skip" = "true" ] || die "commit $sha 没有任何 CI 运行记录;确认后加 --skip-ci-check"
      warn "commit 无 CI 记录,已按 --skip-ci-check 放行" ;;
    pending) die "commit $sha 的 CI 仍在运行,等待转绿后再部署" ;;
    failure) die "commit $sha 的 CI 失败,拒绝部署" ;;
  esac
}

resolve_commit() {
  local input="${1:-}"
  git -C "$REPO_ROOT" fetch origin main --quiet
  if [ -n "$input" ]; then
    git -C "$REPO_ROOT" rev-parse --verify "$input^{commit}" 2>/dev/null || die "无法解析 commit: $input"
  else
    git -C "$REPO_ROOT" rev-parse origin/main
  fi
}

# 服务器端部署主流程。MODE=steady 要求 systemd 已托管;MODE=bootstrap 处理首次迁移。
remote_deploy() {
  local sha="$1" mode="$2"
  local short="${sha:0:8}"
  log "开始部署 $short(mode=$mode)"
  remote bash -s -- "$sha" "$short" "$mode" <<'REMOTE'
set -euo pipefail
SHA="$1"; SHORT="$2"; MODE="$3"
APP_ROOT="/www/wwwroot/course-ai-lab"
RELEASES_DIR="$APP_ROOT/releases"
BUILD_DIR="$APP_ROOT/build"
SHARED_ENV="$APP_ROOT/.env"
BACKUP_DIR="/www/backup/lumenlab"
REL="$RELEASES_DIR/$SHORT"
PRECHECK_PORT="3002"
HEALTH_GREP='"status":"healthy"'
SECONDS=0

rlog() { printf '[remote] %s\n' "$*"; }
rwarn() { printf '[remote] WARN: %s\n' "$*" >&2; }
rdie()  { printf '[remote] ERROR: %s\n' "$*" >&2; exit 1; }

# 1. 磁盘前置检查(>= 5GB)
FREE_KB=$(df -k /www | awk 'NR==2 {print $4}')
[ "$FREE_KB" -ge 5242880 ] || rdie "磁盘可用空间不足 5GB(当前 ${FREE_KB}KB)"

# 2. 构建树 fetch + checkout
mkdir -p "$RELEASES_DIR" "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
if [ ! -d "$BUILD_DIR/.git" ]; then
  rm -rf "$BUILD_DIR"
  git clone --quiet https://github.com/mkynyd/lumenlab.git "$BUILD_DIR"
fi
git -C "$BUILD_DIR" fetch origin --quiet
git -C "$BUILD_DIR" reset --hard "$SHA" --quiet
git -C "$BUILD_DIR" clean -fdx -e .env --quiet
ln -sfn "$SHARED_ENV" "$BUILD_DIR/.env"
cd "$BUILD_DIR"
rlog "构建树已就位: $(git rev-parse --short HEAD)"

# 3. 安装依赖 + Prisma
npm ci --include=dev
npx prisma generate

# 4. 数据库快照(保留 3 份)+ 迁移
if command -v pg_dump >/dev/null 2>&1; then
  TS="$(date +%Y%m%d-%H%M%S)"
  set -a; . "$SHARED_ENV"; set +a
  pg_dump -Fc "$DATABASE_URL" -f "$BACKUP_DIR/pre-deploy-$TS.dump"
  chmod 600 "$BACKUP_DIR/pre-deploy-$TS.dump"
  ls -1t "$BACKUP_DIR"/pre-deploy-*.dump 2>/dev/null | tail -n +4 | xargs -r rm -f
  rlog "数据库快照完成"
else
  rwarn "pg_dump 不可用,跳过数据库快照"
fi
npx prisma migrate deploy

# 5. 构建
npm run build

# 6. 组装 release(若目标就是当前运行版本则拒绝)
CUR="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
[ "$CUR" != "$(readlink -m "$REL")" ] || rdie "commit $SHORT 已是当前运行版本,无需部署"
rm -rf "$REL"
mkdir -p "$REL"
cp -a .next/standalone/. "$REL"/
mkdir -p "$REL/.next"
rm -rf "$REL/.next/static"
cp -a .next/static "$REL/.next/"
mkdir -p "$REL/public"
cp -a public/. "$REL/public/"
[ -d fonts ] && cp -a fonts "$REL/fonts" || true
ln -sfn "$APP_ROOT/uploads" "$REL/uploads"
ln -sfn "$APP_ROOT/.lumenlab" "$REL/.lumenlab"
rlog "release 组装完成: $REL"

# 7. 3002 预检
PUNIT="lumenlab-precheck-$SHORT"
systemd-run --unit="$PUNIT" --collect \
  -p WorkingDirectory="$REL" \
  -p EnvironmentFile="$SHARED_ENV" \
  -p Environment="NODE_ENV=production HOSTNAME=127.0.0.1 PORT=$PRECHECK_PORT" \
  /usr/bin/node "$REL/server.js"
ok=0
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PRECHECK_PORT/api/health" 2>/dev/null | grep -q "$HEALTH_GREP"; then ok=1; break; fi
  sleep 1
done
systemctl stop "$PUNIT" >/dev/null 2>&1 || true
if [ "$ok" != 1 ]; then
  journalctl -u "$PUNIT" --no-pager -n 30 >&2 || true
  rdie "预检失败:3002 健康检查未通过"
fi
rlog "预检通过"

# 8. 切换(bootstrap 先处理 Nginx 与旧进程)
if [ "$MODE" = "bootstrap" ]; then
  CONF="/www/server/panel/vhost/nginx/lab.mkynstudio.top.conf"
  BAK="$CONF.bak-$(date +%Y%m%d-%H%M%S)"
  cp -a "$CONF" "$BAK"
  sed -i -E \
    -e 's|^(\s*)root /www/wwwroot/course-ai-lab/public;|\1root /www/wwwroot/course-ai-lab/current/public;|' \
    -e 's|^(\s*)alias /www/wwwroot/course-ai-lab/.next/static;|\1alias /www/wwwroot/course-ai-lab/current/.next/static;|' \
    "$CONF"
  [ "$(grep -c 'course-ai-lab/current/public' "$CONF")" = "1" ] || { cp -a "$BAK" "$CONF"; rdie "Nginx root 替换结果异常,已还原"; }
  [ "$(grep -c 'course-ai-lab/current/.next/static' "$CONF")" = "1" ] || { cp -a "$BAK" "$CONF"; rdie "Nginx alias 替换结果异常,已还原"; }
  nginx -t || { cp -a "$BAK" "$CONF"; nginx -t; rdie "Nginx 配置校验失败,已还原"; }
  systemctl reload nginx || { cp -a "$BAK" "$CONF"; systemctl reload nginx || true; rdie "Nginx reload 失败,已还原"; }
  rlog "Nginx 已切到 current 路径(备份: $BAK)"

  OLD_PID="$(ss -ltnpH 'sport = :3000' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)"
  if [ -n "$OLD_PID" ]; then
    OLD_CWD="$(readlink "/proc/$OLD_PID/cwd" 2>/dev/null || true)"
    case "$OLD_CWD" in
      "$APP_ROOT"*) kill "$OLD_PID" 2>/dev/null || true; sleep 2; kill -9 "$OLD_PID" 2>/dev/null || true ;;
      *) rdie "3000 被未知进程占用(pid=$OLD_PID cwd=$OLD_CWD),中止";;
    esac
    rlog "旧手工进程 $OLD_PID 已停止"
  fi
fi

PREV="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
ln -sfn "$REL" "$APP_ROOT/current"
systemctl restart lumenlab
ok=0
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:3000/api/health" 2>/dev/null | grep -q "$HEALTH_GREP"; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ]; then
  journalctl -u lumenlab --no-pager -n 50 >&2 || true
  if [ -n "$PREV" ]; then
    ln -sfn "$PREV" "$APP_ROOT/current"
    systemctl restart lumenlab || true
    rwarn "已回滚 symlink 到上一 release"
  elif [ "$MODE" = "bootstrap" ]; then
    rm -f "$APP_ROOT/current"
    CONF_LATEST="$(ls -1t /www/server/panel/vhost/nginx/lab.mkynstudio.top.conf.bak-* 2>/dev/null | head -1 || true)"
    [ -n "$CONF_LATEST" ] && cp -a "$CONF_LATEST" /www/server/panel/vhost/nginx/lab.mkynstudio.top.conf && systemctl reload nginx || true
    systemd-run --unit=lumenlab-legacy --collect \
      -p WorkingDirectory="$APP_ROOT/.next/standalone" \
      -p EnvironmentFile="$SHARED_ENV" \
      -p Environment="NODE_ENV=production HOSTNAME=127.0.0.1 PORT=3000" \
      /usr/bin/node "$APP_ROOT/.next/standalone/server.js" || true
    rwarn "已恢复旧 Nginx 配置并以临时 unit 重启旧版本"
  fi
  rdie "切换后健康检查失败"
fi

curl -sf "https://lab.mkynstudio.top/api/health" 2>/dev/null | grep -q "$HEALTH_GREP" \
  || rdie "本机健康检查通过但 HTTPS 检查失败(请人工检查 Nginx/证书)"
rlog "HTTPS 健康检查通过"

# 9. 收尾:保留 current + 最新一个其他 release,清理构建树重目录,写 deploy.log
CUR="$(readlink -f "$APP_ROOT/current")"
KEEP=""
for d in $(ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null); do
  RD="$(readlink -f "$d")"
  [ "$RD" = "$CUR" ] && continue
  KEEP="$RD"; break
done
for d in "$RELEASES_DIR"/*/; do
  RD="$(readlink -f "$d")"
  [ "$RD" = "$CUR" ] && continue
  [ -n "$KEEP" ] && [ "$RD" = "$KEEP" ] && continue
  rm -rf "$d"
  rlog "清理超龄 release: $d"
done
rm -rf "$BUILD_DIR/node_modules" "$BUILD_DIR/.next"
LOG="$APP_ROOT/deploy.log"
printf '%s deploy %s ok (%ss, mode=%s)\n' "$(date -Is)" "$SHORT" "$SECONDS" "$MODE" >> "$LOG"
tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
rlog "部署完成: $SHORT"
REMOTE
}

cmd_deploy() {
  local input="" skip="false"
  while [ $# -gt 0 ]; do
    case "$1" in
      --skip-ci-check) skip="true" ;;
      *) input="$1" ;;
    esac
    shift
  done
  local sha
  sha="$(resolve_commit "$input")"
  ci_gate "$sha" "$skip"
  remote_deploy "$sha" "steady"
  log "完成: $sha"
}

cmd_bootstrap() {
  local skip="false"
  if [ "${1:-}" = "--skip-ci-check" ]; then skip="true"; fi
  local sha
  sha="$(resolve_commit "")"
  ci_gate "$sha" "$skip"
  log "bootstrap:安装 systemd unit"
  scp -q "$REPO_ROOT/deploy/lumenlab.service" "$SSH_HOST:/etc/systemd/system/lumenlab.service"
  remote 'systemctl daemon-reload && systemctl enable lumenlab --quiet'
  remote_deploy "$sha" "bootstrap"
  log "bootstrap 完成: $sha"
}

cmd_rollback() {
  remote bash -s <<'REMOTE'
set -euo pipefail
APP_ROOT="/www/wwwroot/course-ai-lab"
RELEASES_DIR="$APP_ROOT/releases"
CUR="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
TARGET=""
for d in $(ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null); do
  RD="$(readlink -f "$d")"
  [ "$RD" = "$CUR" ] && continue
  TARGET="$RD"; break
done
[ -n "$TARGET" ] || { echo "[remote] ERROR: 没有可回滚的上一 release" >&2; exit 1; }
echo "[remote] 回滚: $CUR -> $TARGET"
ln -sfn "$TARGET" "$APP_ROOT/current"
systemctl restart lumenlab
ok=0
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:3000/api/health" 2>/dev/null | grep -q '"status":"healthy"'; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] || { journalctl -u lumenlab --no-pager -n 50 >&2 || true; echo "[remote] ERROR: 回滚后健康检查失败" >&2; exit 1; }
curl -sf "https://lab.mkynstudio.top/api/health" 2>/dev/null | grep -q '"status":"healthy"' \
  || { echo "[remote] ERROR: 回滚后 HTTPS 检查失败" >&2; exit 1; }
printf '%s rollback %s ok\n' "$(date -Is)" "$(basename "$TARGET")" >> "$APP_ROOT/deploy.log"
echo "[remote] 回滚完成: $(basename "$TARGET")"
REMOTE
}

cmd_status() {
  remote bash -s <<'REMOTE'
APP_ROOT="/www/wwwroot/course-ai-lab"
echo "current -> $(readlink "$APP_ROOT/current" 2>/dev/null || echo '(未设置)')"
echo "releases:"
RELS="$(ls -1dt "$APP_ROOT/releases"/*/ 2>/dev/null || true)"
if [ -n "$RELS" ]; then printf '%s\n' "$RELS" | sed 's/^/  /'; else echo "  (无)"; fi
ENABLED="$(systemctl is-enabled lumenlab 2>&1 || true)"
ACTIVE="$(systemctl is-active lumenlab 2>&1 || true)"
echo "service: $ENABLED / $ACTIVE"
echo "health(local): $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health 2>/dev/null || echo 'unreachable')"
echo "disk free: $(df -h /www | awk 'NR==2 {print $4}')"
tail -n 5 "$APP_ROOT/deploy.log" 2>/dev/null | sed 's/^/  log: /' || true
REMOTE
}

case "${1:-}" in
  deploy)   shift; cmd_deploy "$@" ;;
  rollback) cmd_rollback ;;
  status)   cmd_status ;;
  bootstrap) shift; cmd_bootstrap "$@" ;;
  *) usage ;;
esac
