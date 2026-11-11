#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_NAME="exitpanel"
INSTALL_DIR="${EXITPANEL_INSTALL_DIR:-/opt/exitpanel}"
REPO_URL="${EXITPANEL_REPO_URL:-}"
BRANCH="${EXITPANEL_BRANCH:-main}"
DOMAIN="${EXITPANEL_DOMAIN:-}"
ADMIN_EMAIL="${EXITPANEL_ADMIN_EMAIL:-}"
APP_PORT="${EXITPANEL_APP_PORT:-3000}"

log() { printf '\033[1;32m[ExitPanel]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[ExitPanel][WARN]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[ExitPanel][ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
用法：
  sudo bash deploy-panel.sh --repo https://github.com/<org>/<repo>.git [选项]

选项：
  --repo URL       面板代码仓库地址，也可用 EXITPANEL_REPO_URL
  --branch NAME    Git 分支，默认 main
  --domain NAME    生产域名；留空则只配置 HTTP 反向代理
  --email EMAIL    Let's Encrypt 邮箱
  --dir PATH       安装目录，默认 /opt/exitpanel
  --help           显示帮助

可通过环境变量预置：
  MANUS_PROJECT_ID MANUS_JWT_SECRET MANUS_OAUTH_API_URL OWNER_OPEN_ID
  MYSQL_PASSWORD MYSQL_ROOT_PASSWORD
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) ADMIN_EMAIL="${2:-}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[[ "$(id -u)" == "0" ]] || die "请使用 root 执行：sudo bash deploy-panel.sh ..."
[[ "$APP_PORT" =~ ^[0-9]+$ ]] && (( APP_PORT >= 1024 && APP_PORT <= 65535 )) || die "EXITPANEL_APP_PORT 必须是 1024-65535"
[[ -n "$REPO_URL" ]] || die "必须提供 --repo；生产 VPS 不能访问当前 Sandbox 的内部 Git 远端"
command -v apt-get >/dev/null || die "当前脚本只支持 Debian/Ubuntu 系统"
if [[ -n "$DOMAIN" ]] && [[ ! "$DOMAIN" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]]; then
  die "--domain 不是有效域名"
fi

prompt_value() {
  local name="$1" label="$2" current=""
  if [[ -n "${!name+x}" ]]; then current="${!name}"; fi
  if [[ -z "$current" ]]; then
    read -r -p "$label: " current
    [[ -n "$current" ]] || die "$label 不能为空"
    printf -v "$name" '%s' "$current"
  fi
}

prompt_secret() {
  local name="$1" label="$2" current=""
  if [[ -n "${!name+x}" ]]; then current="${!name}"; fi
  if [[ -z "$current" ]]; then
    read -r -s -p "$label: " current
    printf '\n'
    [[ -n "$current" ]] || die "$label 不能为空"
    printf -v "$name" '%s' "$current"
  fi
}

prompt_value MANUS_PROJECT_ID "MANUS_PROJECT_ID（项目 ID）"
prompt_secret MANUS_JWT_SECRET "MANUS_JWT_SECRET（OAuth 会话签名密钥）"
MANUS_OAUTH_API_URL="${MANUS_OAUTH_API_URL:-https://api.manus.ai}"
MYSQL_DATABASE="${MYSQL_DATABASE:-exitpanel}"
MYSQL_USER="${MYSQL_USER:-exitpanel}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-$(openssl rand -hex 24 2>/dev/null || true)}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-$(openssl rand -hex 32 2>/dev/null || true)}"
[[ -n "$MYSQL_PASSWORD" && -n "$MYSQL_ROOT_PASSWORD" ]] || die "无法生成数据库密码，请安装 openssl 后重试"
DATABASE_URL="mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@db:3306/${MYSQL_DATABASE}"

if [[ -n "$DOMAIN" && -z "$ADMIN_EMAIL" ]]; then
  read -r -p "Let's Encrypt 邮箱（可留空跳过自动 HTTPS）: " ADMIN_EMAIL
fi

log "安装系统依赖和 Docker"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl git openssl nginx ufw docker.io
systemctl enable --now docker
command -v docker >/dev/null || die "Docker 安装失败"
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends docker-compose-v2 || apt-get install -y --no-install-recommends docker-compose-plugin || die "Docker Compose v2 安装失败"
fi
docker compose version >/dev/null || die "Docker Compose v2 安装失败"

SRC_DIR="$INSTALL_DIR/src"
mkdir -p "$INSTALL_DIR"
if [[ -d "$SRC_DIR/.git" ]]; then
  log "更新已有代码仓库"
  git -C "$SRC_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$SRC_DIR" reset --hard "origin/$BRANCH"
else
  log "克隆面板代码仓库"
  rm -rf "$SRC_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
fi
[[ -f "$SRC_DIR/Dockerfile" ]] || die "仓库中没有 Dockerfile：$SRC_DIR"
[[ -f "$SRC_DIR/drizzle/0002_nervous_serpent_society.sql" || -d "$SRC_DIR/drizzle" ]] || die "仓库中没有 drizzle 迁移目录"

cat >"$INSTALL_DIR/.env.production" <<EOF
NODE_ENV=production
PORT=3000
APP_PORT=$APP_PORT
MANUS_PROJECT_ID=$MANUS_PROJECT_ID
MANUS_JWT_SECRET=$MANUS_JWT_SECRET
MANUS_OAUTH_API_URL=$MANUS_OAUTH_API_URL
OWNER_OPEN_ID=${OWNER_OPEN_ID:-}
MYSQL_DATABASE=$MYSQL_DATABASE
MYSQL_USER=$MYSQL_USER
MYSQL_PASSWORD=$MYSQL_PASSWORD
MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD
DATABASE_URL=$DATABASE_URL
# 可选：面板调用已部署的 VPS worker
EXITPANEL_WORKER_URL=${EXITPANEL_WORKER_URL:-}
EXITPANEL_WORKER_SHARED_SECRET=${EXITPANEL_WORKER_SHARED_SECRET:-}
EOF
chmod 0600 "$INSTALL_DIR/.env.production"

cp "$SRC_DIR/vps/docker-compose.prod.yml" "$INSTALL_DIR/docker-compose.prod.yml"
cat >"$INSTALL_DIR/exitpanel-compose.service" <<EOF
[Unit]
Description=ExitPanel production stack
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR
RemainAfterExit=yes
ExecStart=/usr/bin/docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
ExecStop=/usr/bin/docker compose --env-file .env.production -f docker-compose.prod.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF
install -m 0644 "$INSTALL_DIR/exitpanel-compose.service" /etc/systemd/system/exitpanel-compose.service
systemctl daemon-reload

log "校验 Compose 配置并构建启动面板和 MySQL"
cd "$INSTALL_DIR"
docker compose --env-file .env.production -f docker-compose.prod.yml config >/dev/null
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
systemctl enable --now exitpanel-compose.service

log "配置 Nginx 反向代理"
cat >/etc/nginx/sites-available/exitpanel <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN:-_};

    client_max_body_size 10m;
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 90s;
    }
}
EOF
ln -sfn /etc/nginx/sites-available/exitpanel /etc/nginx/sites-enabled/exitpanel
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

if [[ -n "$DOMAIN" && -n "$ADMIN_EMAIL" ]]; then
  log "尝试申请 Let's Encrypt 证书"
  apt-get install -y --no-install-recommends certbot python3-certbot-nginx
  if certbot --nginx --non-interactive --agree-tos --redirect -m "$ADMIN_EMAIL" -d "$DOMAIN"; then
    log "HTTPS 已启用：https://$DOMAIN"
  else
    warn "证书申请失败；请确认 DNS 已指向本机公网 IP，当前仍可通过 HTTP 访问"
  fi
else
  warn "未配置域名/邮箱，当前仅启用 HTTP。生产环境请尽快配置 HTTPS。"
fi

log "配置基础防火墙规则"
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null || true
  ufw allow 80/tcp >/dev/null || true
  [[ -n "$DOMAIN" && -n "$ADMIN_EMAIL" ]] && ufw allow 443/tcp >/dev/null || true
  ufw --force enable >/dev/null || true
fi

log "等待应用健康检查"
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$APP_PORT/api/health" >/dev/null; then
    break
  fi
  sleep 2
done
curl -fsS --max-time 5 "http://127.0.0.1:$APP_PORT/api/health" >/dev/null || {
  docker compose --env-file .env.production -f docker-compose.prod.yml ps
  docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=80 app
  die "面板健康检查失败"
}

chmod 0700 "$INSTALL_DIR"
log "部署完成"
echo "安装目录：$INSTALL_DIR"
echo "状态查看：cd $INSTALL_DIR && docker compose --env-file .env.production -f docker-compose.prod.yml ps"
echo "日志查看：cd $INSTALL_DIR && docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app"
if [[ -n "$DOMAIN" ]]; then
  echo "访问地址：https://$DOMAIN"
else
  echo "访问地址：http://$(hostname -I | awk '{print $1}')"
fi
echo "重要：请在 Manus OAuth 配置中加入生产域名，并将 VPS worker 通过 EXITPANEL_WORKER_URL/EXITPANEL_WORKER_SHARED_SECRET 接入。"
