#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_URL="${EXITPANEL_REPO_URL:-}"
BRANCH="${EXITPANEL_BRANCH:-main}"
usage(){ echo "用法：sudo bash install-native.sh [--repo URL] [--branch NAME]"; }
while [[ $# -gt 0 ]]; do case "$1" in --repo) REPO_URL="${2:-}"; shift 2;; --branch) BRANCH="${2:-}"; shift 2;; --help|-h) usage; exit 0;; *) echo "未知参数：$1" >&2; exit 2;; esac; done
[[ $EUID -eq 0 ]] || { echo '请以 root 执行' >&2; exit 1; }
command -v systemctl >/dev/null || { echo '需要 systemd' >&2; exit 1; }
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive; apt-get update -y; apt-get install -y --no-install-recommends ca-certificates curl openssl python3 git sudo
elif command -v dnf >/dev/null; then
  dnf -y install ca-certificates curl openssl python3 git sudo shadow-utils
else
  echo '仅支持 Debian/Ubuntu（APT）和 CentOS Stream/RHEL（DNF）' >&2; exit 1
fi
WORK_DIR="$ROOT_DIR"
if [[ -n "$REPO_URL" ]]; then
  WORK_DIR="/opt/exitpanel-installer"; rm -rf "$WORK_DIR"; git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$WORK_DIR"
fi
[[ -x "$WORK_DIR/install.sh" ]] || chmod 0755 "$WORK_DIR/install.sh"
exec bash "$WORK_DIR/install.sh"
