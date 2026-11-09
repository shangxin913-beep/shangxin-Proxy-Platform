
## 6. 控制面与 VPS 数据面
- [ ] 面板通过带时间戳的 HMAC-SHA256 请求调用 VPS worker，拒绝过期签名和未签名请求。
- [ ] worker 在 VPS 本机执行 SOCKS5 真实探测，并支持 Xray 配置计划接口。
- [ ] worker 使用 root helper 对 Xray 配置执行 JSON/Xray 校验、备份、原子替换、systemd reload；失败时恢复旧配置。
- [ ] REALITY 私钥只保留在 VPS 环境文件，不返回给面板或浏览器。

## 7. 真实订阅和多节点
- [ ] 面板生成带随机 token 的公开订阅 URL，VLESS/Base64 与 Clash/Mihomo URL 分开显示。
- [ ] 公开订阅实时过滤过期、停用和未通过检测的出口。
- [ ] 支持多个 VPS 节点，节点保存 endpoint、worker 端口、HMAC 共享密钥、运行状态和 direct/reverse 隧道模式。
- [ ] 出口可绑定 nodeId，管理员可按节点生成并下发该节点的有效 Xray 出口计划。
- [ ] 提供反向 SSH 隧道模板，明确固定 host key、专用无 shell 密钥、relay 端口和防火墙边界。

## 8. 真实网络运行边界
- [ ] 当前 root 安装器不自动下载 Xray、不自动生成 REALITY 私钥、不直接修改公网防火墙；生产接入时由管理员在目标 VPS 配置并审查这些参数。
- [ ] sing-box 配置生成、WireGuard/专用中继和公网 DNS/证书编排作为后续扩展，不与首版 Xray 路径混用。
