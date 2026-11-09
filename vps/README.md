# ExitPanel VPS root worker

这个目录提供 VPS 数据面 worker。它不会把第三方 SOCKS5 的落地 IP 伪装成客户端入口；它负责在 VPS 上通过上游 SOCKS5 做真实 HTTPS 探测，并在配置好 Xray 后用 systemd 安全应用 VLESS/REALITY + SOCKS5 路由配置。

## 安装

在项目目录执行：

```bash
sudo bash vps/install.sh
```

安装器需要 Linux、root、systemd、Python 3、curl、ca-certificates 和 openssl。它会创建 `exitpanel-agent` 系统用户，安装到 `/opt/exitpanel-agent`，并创建受 systemd 保护的服务。

worker 默认只监听 `127.0.0.1:18443`，不会把检测 API 暴露到公网。token 保存在：

```text
/etc/exitpanel/agent.env
```

## 接口

健康检查：

```bash
curl http://127.0.0.1:18443/health
```

面板与 worker 使用带时间戳的 HMAC-SHA256 签名，不再使用把 token 放在普通 Header 里的静态认证。签名内容为 `timestamp + 换行 + 原始 JSON body`，请求头为 `X-ExitPanel-Timestamp` 和 `X-ExitPanel-Signature`。

真实 SOCKS5 检测：

```bash
SECRET=$(sudo awk -F= '$1=="AGENT_SHARED_SECRET"{print $2}' /etc/exitpanel/agent.env)
BODY='{"host":"proxy.example.com","port":9188,"username":"user","password":"pass"}'
TS=$(date +%s)
SIG=$(printf '%s\n%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
curl -sS http://127.0.0.1:18443/v1/check \
  -H "Content-Type: application/json" \
  -H "X-ExitPanel-Timestamp: $TS" \
  -H "X-ExitPanel-Signature: $SIG" \
  -d "$BODY"
```

成功返回的结构类似：

```json
{
  "status": "passed",
  "observedIp": "203.0.113.10",
  "country": "MX",
  "city": "Mexico City",
  "latencyMs": 531
}
```

## Xray 配置应用

安装器会部署 `/usr/local/sbin/exitpanel-apply`。worker 收到 `/v1/config/apply` 后先在 `/run/exitpanel-agent/xray-next.json` 写入临时配置，再由 root helper 做 JSON/Xray 校验、备份当前配置、原子替换、systemd reload；校验或 reload 失败会恢复 `.bak` 并重启旧配置。安装器不会自动下载 Xray 二进制，也不会自动生成 REALITY 私钥，需先安装并配置：

```text
/usr/local/bin/xray
/etc/exitpanel/agent.env
REALITY_PRIVATE_KEY=...
REALITY_SERVER_NAME=www.example.com
REALITY_DEST=www.example.com:443
```

Xray 配置生成器会为每个出口建立独立 VLESS 入站端口和对应 SOCKS5/direct 出站，已过期或不在订阅范围的出口不会进入新的配置计划。真实公网监听前仍应配置 DNS、TLS/REALITY 参数和防火墙策略。

## 多 VPS 与落地节点

面板的 `nodes` 数据模型支持多个 VPS/落地节点，每个节点保存 endpoint、worker 端口、HMAC 共享密钥、`direct`/`reverse` 隧道模式和公开入口地址。出口通过 `nodeId` 绑定到节点，管理员下发时，面板只把该节点的有效出口计划发送到对应 worker；密码在服务端解密后只通过签名 HTTPS/内网请求传输，worker 不会把它返回给面板。

如果需要让落地节点的公网 IP 作为客户端入口，可在落地节点上建立反向 SSH 隧道，把落地节点的公网端口转发到 VPS 上的 Xray 入站端口。仓库提供了 [reverse-tunnel.service.example](./reverse-tunnel.service.example) 模板。正式使用前必须固定 SSH host key、使用专用无 shell 密钥、限制 relay 的 `authorized_keys` 转发目标，并在 relay 防火墙只开放需要的端口；不要直接复制模板后开放任意 `GatewayPorts`。

## 说明

首版 worker 不安装 Xray/sing-box，不改 iptables，不创建公网 VLESS 入口，也不执行任何端口转发。面板端的模拟检测接口和这个 worker 的真实检测接口使用同一套结果字段，后续可以把调用目标替换为该服务。
