#!/usr/bin/env python3
import json
import os
import re
import secrets
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

HOST = os.environ.get("AGENT_HOST", "127.0.0.1")
PORT = int(os.environ.get("AGENT_PORT", "18443"))
TOKEN = os.environ.get("AGENT_TOKEN", "")


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


def check_socks5(payload):
    host = payload.get("host")
    port = payload.get("port")
    username = payload.get("username") or ""
    password = payload.get("password") or ""
    if not valid_host(host) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError("invalid_socks5_target")
    if len(username) > 160 or len(password) > 300:
        raise ValueError("credential_too_long")

    command = [
        "curl", "--fail", "--silent", "--show-error", "--location",
        "--connect-timeout", "8", "--max-time", "20",
        "--proxy", f"socks5h://{host}:{port}",
        "--header", "Accept: application/json",
        "https://ipinfo.io/json",
    ]
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
        return {
            "status": "passed",
            "observedIp": observed_ip,
            "country": result.get("country"),
            "city": result.get("city"),
            "latencyMs": round((time.perf_counter() - started) * 1000),
        }
    finally:
        if config_path:
            try:
                os.unlink(config_path)
            except FileNotFoundError:
                pass


class Handler(BaseHTTPRequestHandler):
    server_version = "ExitPanelAgent/0.1"

    def log_message(self, format, *args):
        return

    def do_GET(self):
        if self.path == "/health":
            json_response(self, 200, {"ok": True, "service": "exitpanel-agent", "mode": "socks5-check"})
            return
        json_response(self, 404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/v1/check":
            json_response(self, 404, {"error": "not_found"})
            return
        if not TOKEN or not secrets.compare_digest(self.headers.get("X-ExitPanel-Token", ""), TOKEN):
            json_response(self, 401, {"error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 8192:
                raise ValueError("invalid_body_size")
            payload = json.loads(self.rfile.read(length))
            result = check_socks5(payload)
            json_response(self, 200, result)
        except (ValueError, json.JSONDecodeError) as exc:
            json_response(self, 400, {"status": "failed", "errorCode": str(exc), "errorMessage": "检测参数无效"})
        except Exception:
            json_response(self, 500, {"status": "failed", "errorCode": "agent_error", "errorMessage": "检测服务内部错误"})


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("AGENT_TOKEN is required")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
