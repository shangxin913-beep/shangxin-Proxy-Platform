#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_NAME="exitpanel-agent"
INSTALL_DIR="/opt/exitpanel-agent"
CONFIG_DIR="/etc/exitpanel"
ENV_FILE="$CONFIG_DIR/agent.env"
SERVICE_FILE="/etc/systemd/system/$APP_NAME.service"
SUDOERS_FILE="/etc/sudoers.d/$APP_NAME"
APPLY_HELPER="/usr/local/sbin/exitpanel-apply"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ "$(id -u)" == "0" ]] || { echo "请以 root 执行：sudo bash vps/install.sh" >&2; exit 1; }
[[ "$(uname -s)" == "Linux" ]] || { echo "仅支持 Linux" >&2; exit 1; }
command -v systemctl >/dev/null || { echo "需要 systemd" >&2; exit 1; }
missing=()
for command in python3 curl openssl; do command -v "$command" >/dev/null || missing+=("$command"); done
if ((${#missing[@]})); then
  if command -v apt-get >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 curl ca-certificates openssl
  else
    echo "缺少依赖：${missing[*]}；请先安装 python3、curl、ca-certificates 和 openssl" >&2
    exit 1
  fi
fi

id -u "$APP_NAME" >/dev/null 2>&1 || useradd --system --home-dir "$INSTALL_DIR" --create-home --shell /usr/sbin/nologin "$APP_NAME"
install -d -o root -g root -m 0755 "$INSTALL_DIR"
install -d -o root -g root -m 0700 "$CONFIG_DIR"
install -d -o "$APP_NAME" -g "$APP_NAME" -m 0700 /run/exitpanel-agent
install -d -o "$APP_NAME" -g "$APP_NAME" -m 0700 /var/lib/exitpanel-agent
install -o root -g root -m 0755 "$SCRIPT_DIR/agent.py" "$INSTALL_DIR/agent.py"
install -o root -g root -m 0644 "$SCRIPT_DIR/xray_config.py" "$INSTALL_DIR/xray_config.py"
install -o root -g root -m 0700 "$SCRIPT_DIR/exitpanel-apply" "$APPLY_HELPER"

cat >"$SUDOERS_FILE" <<EOF
$APP_NAME ALL=(root) NOPASSWD: $APPLY_HELPER
EOF
chmod 0440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null

if [[ ! -s "$ENV_FILE" ]]; then
  shared_secret="$(openssl rand -hex 32)"
  cat >"$ENV_FILE" <<EOF
AGENT_HOST=127.0.0.1
AGENT_PORT=18443
AGENT_SHARED_SECRET=$shared_secret
AGENT_RUN_DIR=/run/exitpanel-agent
AGENT_PLAN_FILE=/var/lib/exitpanel-agent/plan.json
# Configure these before applying a REALITY config.
REALITY_SERVER_NAME=www.microsoft.com
REALITY_DEST=www.microsoft.com:443
REALITY_PRIVATE_KEY=
EOF
  chmod 0600 "$ENV_FILE"
  echo "已生成新的 HMAC 密钥：$ENV_FILE"
else
  chmod 0600 "$ENV_FILE"
  if ! grep -q '^AGENT_SHARED_SECRET=' "$ENV_FILE"; then
    printf '\nAGENT_SHARED_SECRET=%s\n' "$(openssl rand -hex 32)" >>"$ENV_FILE"
  fi
  echo "保留现有检测服务配置：$ENV_FILE"
fi

cat >"$SERVICE_FILE" <<EOF
[Unit]
Description=ExitPanel local SOCKS5 check worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_NAME
Group=$APP_NAME
EnvironmentFile=$ENV_FILE
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/python3 $INSTALL_DIR/agent.py
RuntimeDirectory=exitpanel-agent
RuntimeDirectoryMode=0700
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/run/exitpanel-agent
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$APP_NAME.service"
sleep 1
systemctl is-active --quiet "$APP_NAME.service" || { systemctl --no-pager --full status "$APP_NAME.service" || true; exit 1; }

if curl -fsS --max-time 3 http://127.0.0.1:18443/health >/dev/null; then
  echo "ExitPanel 检测 worker 已启动：127.0.0.1:18443"
else
  echo "worker 已启动但健康检查失败，请查看：journalctl -u $APP_NAME -n 80 --no-pager" >&2
  exit 1
fi

echo "检测接口：POST http://127.0.0.1:18443/v1/check"
echo "配置接口：POST http://127.0.0.1:18443/v1/config/apply"
echo "认证方式：X-ExitPanel-Timestamp + X-ExitPanel-Signature（HMAC-SHA256）"
echo "共享密钥文件：$ENV_FILE"
echo "REALITY_PRIVATE_KEY 尚未自动生成，请配置后再应用真实入站。"
