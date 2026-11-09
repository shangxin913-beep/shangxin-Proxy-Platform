# ExitPanel VPS root worker

这个目录提供首版的 VPS 数据面检测 worker。它不是完整的代理面板，也不会把第三方 SOCKS5 的落地 IP 伪装成客户端入口；它只负责在 VPS 上通过上游 SOCKS5 做真实 HTTPS 探测，返回实际出口 IP、国家、城市和延迟，供面板后续接入。

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

真实 SOCKS5 检测：

```bash
TOKEN=$(sudo awk -F= '$1=="AGENT_TOKEN"{print $2}' /etc/exitpanel/agent.env)
curl -sS http://127.0.0.1:18443/v1/check \
  -H "Content-Type: application/json" \
  -H "X-ExitPanel-Token: $TOKEN" \
  -d '{"host":"proxy.example.com","port":9188,"username":"user","password":"pass"}'
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

## 说明

首版 worker 不安装 Xray/sing-box，不改 iptables，不创建公网 VLESS 入口，也不执行任何端口转发。面板端的模拟检测接口和这个 worker 的真实检测接口使用同一套结果字段，后续可以把调用目标替换为该服务。
