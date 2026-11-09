#!/usr/bin/env python3
"""Generate a minimal Xray VLESS/REALITY + SOCKS5 routing config.

The caller supplies only sanitized entry and exit records. The REALITY private key
stays on the VPS in the environment and is never returned to the panel.
"""
import os


def build_config(entries):
    private_key = os.environ.get("REALITY_PRIVATE_KEY", "")
    server_name = os.environ.get("REALITY_SERVER_NAME", "www.microsoft.com")
    dest = os.environ.get("REALITY_DEST", "www.microsoft.com:443")
    if not private_key:
        raise ValueError("REALITY_PRIVATE_KEY is required")

    inbounds = []
    outbounds = [{"tag": "direct", "protocol": "freedom", "settings": {}}]
    routes = []
    seen_ports = set()
    for entry in entries:
        port = int(entry["entryPort"])
        if port in seen_ports or not 1 <= port <= 65535:
            raise ValueError("duplicate_or_invalid_entry_port")
        seen_ports.add(port)
        tag = f"entry-{entry['id']}"
        exit_tag = f"exit-{entry['id']}"
        inbound = {
            "tag": tag,
            "listen": "0.0.0.0",
            "port": port,
            "protocol": "vless",
            "settings": {"clients": [{"id": entry["entryUuid"], "email": entry.get("displayName", entry["id"])}], "decryption": "none"},
            "streamSettings": {
                "network": "tcp",
                "security": "reality",
                "realitySettings": {"show": False, "dest": dest, "xver": 0, "serverNames": [server_name], "privateKey": private_key},
            },
            "sniffing": {"enabled": True, "destOverride": ["http", "tls", "quic"]},
        }
        inbounds.append(inbound)
        upstream = entry.get("upstream") or {}
        if upstream.get("type") == "direct":
            outbounds.append({"tag": exit_tag, "protocol": "freedom", "settings": {}})
        else:
            socks = {"address": upstream["host"], "port": int(upstream["port"])}
            if upstream.get("username") or upstream.get("password"):
                socks["users"] = [{"user": upstream.get("username", ""), "pass": upstream.get("password", "")}]
            outbounds.append({"tag": exit_tag, "protocol": "socks", "settings": {"servers": [socks]}})
        routes.append({"type": "field", "inboundTag": [tag], "outboundTag": exit_tag})

    routes.extend([
        {"type": "field", "network": "udp", "outboundTag": "block"},
        {"type": "field", "ip": ["geoip:private"], "outboundTag": "block"},
    ])
    outbounds.append({"tag": "block", "protocol": "blackhole", "settings": {}})
    return {"log": {"loglevel": "warning"}, "inbounds": inbounds, "outbounds": outbounds, "routing": {"domainStrategy": "AsIs", "rules": routes}}
