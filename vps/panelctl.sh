#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

INSTALL_DIR="${EXITPANEL_INSTALL_DIR:-/opt/exitpanel}"
SRC_DIR="$INSTALL_DIR/src"
BACKUP_DIR="${EXITPANEL_BACKUP_DIR:-$INSTALL_DIR/backups}"
COMPOSE=(docker compose --env-file "$INSTALL_DIR/.env.production" -f "$INSTALL_DIR/docker-compose.prod.yml")
log(){ printf '[ExitPanel] %s\n' "$*"; }
die(){ printf '[ExitPanel][ERROR] %s\n' "$*" >&2; exit 1; }
root(){ [[ $EUID -eq 0 ]] || die '请以 root 执行'; }
require(){ [[ -f "$INSTALL_DIR/.env.production" && -d "$SRC_DIR/.git" ]] || die "未找到生产安装：$INSTALL_DIR"; command -v docker >/dev/null || die '未安装 Docker'; }
backup(){
  require; mkdir -p "$BACKUP_DIR"; local stamp="$(date +%Y%m%d-%H%M%S)"; local dir="$BACKUP_DIR/$stamp"; mkdir -p "$dir"
  cp -a "$INSTALL_DIR/.env.production" "$INSTALL_DIR/docker-compose.prod.yml" "$dir/"
  git -C "$SRC_DIR" rev-parse HEAD >"$dir/commit"
  "${COMPOSE[@]}" exec -T db sh -lc 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --events "$MYSQL_DATABASE"' >"$dir/database.sql"
  ln -sfn "$dir" "$BACKUP_DIR/latest"
  log "备份完成：$dir"
}
update(){
  require; backup; local branch="${1:-main}"; git -C "$SRC_DIR" fetch --depth 1 origin "$branch"; git -C "$SRC_DIR" reset --hard "origin/$branch"; "${COMPOSE[@]}" up -d --build; log '更新完成，失败时可执行 panelctl rollback'; }
rollback(){
  require; local dir="${1:-$BACKUP_DIR/latest}"; [[ -d "$dir" ]] || die "备份不存在：$dir"; local commit; commit="$(cat "$dir/commit")"; git -C "$SRC_DIR" fetch --depth 1 origin main || true; git -C "$SRC_DIR" reset --hard "$commit"; "${COMPOSE[@]}" up -d --build; "${COMPOSE[@]}" exec -T db sh -lc 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' <"$dir/database.sql"; log "已回滚到 $commit"; }
status(){ require; "${COMPOSE[@]}" ps; systemctl --no-pager --full status exitpanel-compose.service 2>/dev/null || true; }
uninstall(){
  root; [[ "${1:-}" == '--yes' ]] || die '卸载会停止服务并删除应用、配置、数据库卷。确认后请执行：panelctl uninstall --yes'
  systemctl disable --now exitpanel-compose.service 2>/dev/null || true; rm -f /etc/systemd/system/exitpanel-compose.service; systemctl daemon-reload
  if [[ -f "$INSTALL_DIR/docker-compose.prod.yml" ]]; then (cd "$INSTALL_DIR" && docker compose --env-file .env.production -f docker-compose.prod.yml down -v --remove-orphans) || true; fi
  rm -f /etc/nginx/sites-enabled/exitpanel /etc/nginx/sites-available/exitpanel; nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  rm -rf "$INSTALL_DIR" /usr/local/sbin/exitpanel-panelctl; log 'ExitPanel 已完整卸载（包括数据库卷与本地配置）'; }
root; cmd="${1:-}"; shift || true
case "$cmd" in backup) backup;; update) update "${1:-main}";; rollback) rollback "${1:-$BACKUP_DIR/latest}";; status) status;; uninstall) uninstall "${1:-}";; *) echo '用法：panelctl {backup|update [branch]|rollback [backup-dir]|status|uninstall --yes}'; exit 2;; esac
