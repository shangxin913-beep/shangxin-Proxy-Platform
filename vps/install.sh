#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_NAME="exitpanel-agent"
INSTALL_DIR="/opt/exitpanel-agent"
CONFIG_DIR="/etc/exitpanel"
ENV_FILE="$CONFIG_DIR/agent.env"
SERVICE_FILE="/etc/systemd/system/$APP_NAME.service"
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
install -o root -g root -m 0755 "$SCRIPT_DIR/agent.py" "$INSTALL_DIR/agent.py"

if [[ ! -s "$ENV_FILE" ]]; then
  token="$(openssl rand -hex 32)"
  cat >"$ENV_FILE" <<EOF
AGENT_HOST=127.0.0.1
AGENT_PORT=18443
AGENT_TOKEN=$token
EOF
  chmod 0600 "$ENV_FILE"
  echo "已生成新的检测服务 token：$ENV_FILE"
else
  chmod 0600 "$ENV_FILE"
  echo "保留现有检测服务 token：$ENV_FILE"
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
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/run
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

echo "后续面板接入时使用：POST http://127.0.0.1:18443/v1/check"
echo "认证头：X-ExitPanel-Token；token 保存在：$ENV_FILE"
