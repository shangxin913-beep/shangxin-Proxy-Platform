#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from xray_config import build_config

HOST = os.environ.get("AGENT_HOST", "127.0.0.1")
PORT = int(os.environ.get("AGENT_PORT", "18443"))
SHARED_SECRET = os.environ.get("AGENT_SHARED_SECRET", "")
RUN_DIR = os.environ.get("AGENT_RUN_DIR", "/run/exitpanel-agent")
PLAN_FILE = os.environ.get("AGENT_PLAN_FILE", "/var/lib/exitpanel-agent/plan.json")
MAX_CLOCK_SKEW = 90


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def valid_host(value):
    if not isinstance(value, str) or not value or len(value) > 255:
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.:-]*", value))


def verify_request(handler, body):
    if not SHARED_SECRET:
        return False
    try:
        timestamp = int(handler.headers.get("X-ExitPanel-Timestamp", "0"))
    except ValueError:
        return False
    if abs(int(time.time()) - timestamp) > MAX_CLOCK_SKEW:
        return False
    provided = handler.headers.get("X-ExitPanel-Signature", "")
    message = f"{timestamp}\n".encode() + body
    expected = hmac.new(SHARED_SECRET.encode(), message, hashlib.sha256).hexdigest()
    return bool(provided) and hmac.compare_digest(provided, expected)


def check_socks5(payload):
    host = payload.get("host")
    port = payload.get("port")
    username = payload.get("username") or ""
    password = payload.get("password") or ""
    if not valid_host(host) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError("invalid_socks5_target")
    if len(username) > 160 or len(password) > 300:
        raise ValueError("credential_too_long")

    command = ["curl", "--fail", "--silent", "--show-error", "--location", "--connect-timeout", "8", "--max-time", "20", "--proxy", f"socks5h://{host}:{port}", "--header", "Accept: application/json", "https://ipinfo.io/json"]
    config_path = None
    started = time.perf_counter()
    try:
        if username or password:
            config_file = tempfile.NamedTemporaryFile(mode="w", prefix="exitpanel-curl-", dir="/tmp", delete=False)
            config_path = config_file.name
            escaped = f"{username}:{password}".replace("\\", "\\\\").replace('"', '\\"')
            config_file.write(f'proxy-user = "{escaped}"\n')
            config_file.close()
            os.chmod(config_path, 0o600)
            command[1:1] = ["--config", config_path]
        try:
            completed = subprocess.run(command, capture_output=True, text=True, timeout=25, check=True)
        except subprocess.CalledProcessError as exc:
            message = (exc.stderr or "proxy_check_failed").strip().replace("\n", " ")[:220]
            return {"status": "failed", "errorCode": "proxy_check_failed", "errorMessage": message, "latencyMs": round((time.perf_counter() - started) * 1000)}
        except subprocess.TimeoutExpired:
            return {"status": "failed", "errorCode": "proxy_timeout", "errorMessage": "SOCKS5 检测超时", "latencyMs": 25000}
        try:
            result = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return {"status": "failed", "errorCode": "invalid_probe_response", "errorMessage": "出口探测返回不是 JSON", "latencyMs": round((time.perf_counter() - started) * 1000)}
        observed_ip = result.get("ip")
        if not isinstance(observed_ip, str) or not observed_ip:
            return {"status": "failed", "errorCode": "missing_exit_ip", "errorMessage": "出口探测没有返回 IP", "latencyMs": round((time.perf_counter() - started) * 1000)}
        return {"status": "passed", "observedIp": observed_ip, "country": result.get("country"), "city": result.get("city"), "latencyMs": round((time.perf_counter() - started) * 1000)}
    finally:
        if config_path:
            try:
                os.unlink(config_path)
            except FileNotFoundError:
                pass


def active_entries(entries):
    now = datetime.now(timezone.utc)
    result = []
    for entry in entries:
        expires_at = entry.get("expiresAt")
        if expires_at:
            try:
                expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if expiry <= now:
                    continue
            except ValueError:
                continue
        result.append(entry)
    return result


def apply_xray(entries, save_plan=True):
    if not isinstance(entries, list) or len(entries) > 200:
        raise ValueError("invalid_entries")
    valid_entries = active_entries(entries)
    config = build_config(valid_entries)
    encoded = json.dumps(config, ensure_ascii=False, sort_keys=True, indent=2).encode()
    os.makedirs(RUN_DIR, mode=0o700, exist_ok=True)
    staged = os.path.join(RUN_DIR, "xray-next.json")
    with open(staged, "wb") as handle:
        handle.write(encoded)
    os.chmod(staged, 0o600)
    try:
        result = subprocess.run(["sudo", "-n", "/usr/local/sbin/exitpanel-apply"], capture_output=True, text=True, timeout=30, check=False)
        if result.returncode != 0:
            message = (result.stderr or result.stdout or "xray_apply_failed").strip()[:240]
            return {"status": "rolled_back", "errorCode": "xray_apply_failed", "errorMessage": message}
        if save_plan:
            os.makedirs(os.path.dirname(PLAN_FILE), mode=0o700, exist_ok=True)
            with open(PLAN_FILE, "w", encoding="utf-8") as handle:
                json.dump(valid_entries, handle, ensure_ascii=False)
            os.chmod(PLAN_FILE, 0o600)
        return {"status": "applied", "activeEntries": len(valid_entries), "sha256": hashlib.sha256(encoded).hexdigest(), "detail": (result.stdout or "").strip()[:240]}
    finally:
        try:
            os.unlink(staged)
        except FileNotFoundError:
            pass


def expiry_reconciler():
    last_plan = None
    while True:
        try:
            if os.path.exists(PLAN_FILE):
                with open(PLAN_FILE, encoding="utf-8") as handle:
                    plan = json.load(handle)
                active = active_entries(plan)
                fingerprint = json.dumps(active, sort_keys=True)
                if fingerprint != last_plan and len(active) != len(plan):
                    result = apply_xray(active, save_plan=True)
                    if result.get("status") == "applied":
                        last_plan = fingerprint
                else:
                    last_plan = json.dumps(plan, sort_keys=True)
        except Exception:
            pass
        time.sleep(30)


class Handler(BaseHTTPRequestHandler):
    server_version = "ExitPanelAgent/0.3"

    def log_message(self, format, *args):
        return

    def do_GET(self):
        if self.path == "/health":
            json_response(self, 200, {"ok": True, "service": "exitpanel-agent", "capabilities": ["socks5-check", "xray-atomic-apply", "rollback", "local-expiry-reconcile"]})
            return
        json_response(self, 404, {"error": "not_found"})

    def do_POST(self):
        if self.path not in ("/v1/check", "/v1/config/apply"):
            json_response(self, 404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 512 * 1024:
                raise ValueError("invalid_body_size")
            body = self.rfile.read(length)
            if not verify_request(self, body):
                json_response(self, 401, {"error": "unauthorized"})
                return
            payload = json.loads(body)
            result = check_socks5(payload) if self.path == "/v1/check" else apply_xray(payload.get("entries", []))
            json_response(self, 200, result)
        except (ValueError, json.JSONDecodeError) as exc:
            json_response(self, 400, {"status": "failed", "errorCode": str(exc), "errorMessage": "请求参数无效"})
        except Exception:
            json_response(self, 500, {"status": "failed", "errorCode": "agent_error", "errorMessage": "检测服务内部错误"})


if __name__ == "__main__":
    if not SHARED_SECRET:
        raise SystemExit("AGENT_SHARED_SECRET is required")
    threading.Thread(target=expiry_reconciler, daemon=True).start()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
