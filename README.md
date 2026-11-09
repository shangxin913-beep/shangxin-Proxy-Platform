# ExitPanel 出口代理管理面板

ExitPanel 是一个面向单管理员、单台 VPS 的出口代理管理面板首版。它把第三方 SOCKS5 出口和 VPS 客户端入口分开管理，支持自定义备注、上游端口、客户端入口端口、到期时间、实际出口检测结果和 v2rayN/Clash 订阅预览。

## 当前包含

- React + Express + tRPC + Drizzle MySQL 管理面板。
- Manus OAuth 管理员登录和 admin 权限检查。
- 第三方 SOCKS5 与 VPS 本机直出出口的创建、编辑、启停和删除。
- 账号密码受保护保存；列表、详情和订阅接口不返回密码。
- 出口备注、预期国家/城市、实际检测 IP、入口域名/IP、入口端口、到期时间和订阅开关。
- 到期出口自动标记为 `expired`、阻断新入口并从新订阅移除；续期后可以重新启用。
- 首版模拟检测接口，结果字段与真实 worker 对齐。
- v2rayN/VLESS Base64 和 Clash/Mihomo 配置预览。
- `vps/` 下的 root 检测 worker 安装器：通过真实 SOCKS5 请求 `ipinfo.io`，返回实际出口 IP、国家、城市和延迟。

## 入口与出口关系

```text
客户端 → VPS:入口端口 → 第三方 SOCKS5 → 目标网站
                         └─ 实际出口 IP
```

订阅中的 `server`/`Address` 使用 VPS 域名或 IP，检测到的落地 IP 只用于面板展示和节点名称。除非你控制落地服务器并提供入站端口转发，否则不能把 SOCKS5 落地 IP 直接填成客户端入口。

## 开发

```bash
pnpm install
pnpm db:push
pnpm dev
```

运行检查：

```bash
pnpm check
pnpm test
pnpm build
```

## VPS worker 安装

当前 worker 只负责真实 SOCKS5 出口检测，不安装 Xray/sing-box，不改 iptables，不创建公网 VLESS 入口，也不执行端口转发。安装方式：

```bash
sudo bash vps/install.sh
```

详细接口和安全边界见 [vps/README.md](vps/README.md)。

## 后续接入方向

下一阶段可把模拟检测替换成面板到 VPS worker 的安全调用，再接入 Xray/sing-box 配置生成、systemd 服务、端口监听、真实订阅 URL、配置事务回滚、备份恢复和到期阻断。当前代码没有在云端预览里执行 root 或系统网络修改。

## 许可

首版项目代码按 MIT 许可保留模板默认设置；如后续直接复用 GPL 项目代码，应按对应上游许可证重新处理。


## 第二阶段新增

第二阶段加入了带时间戳的 HMAC worker 通信、公开 token 订阅 URL、VLESS/REALITY + SOCKS5 的 Xray 配置生成器、root helper 的原子应用与回滚、多 VPS 节点模型、节点到出口绑定，以及 direct/reverse 隧道模式。

worker 不会在浏览器返回 SOCKS5 密码或 REALITY 私钥。真实 Xray 启用前，需要在目标 VPS 安装 Xray、配置 `REALITY_PRIVATE_KEY`、配置 DNS/防火墙，并由管理员审查 `reverse-tunnel.service.example` 的中继和端口策略。
