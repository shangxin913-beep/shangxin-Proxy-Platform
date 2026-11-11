# ExitPanel VPS 安装与维护

本目录提供 ExitPanel 的 VPS worker、原生安装入口和生产维护工具。

## 多系统原生安装

支持 Debian 12/13、Ubuntu 22.04/24.04、CentOS Stream/RHEL 系列（需要 root、Linux、systemd、x86_64/兼容 Python 环境）。安装器自动识别 APT 或 DNF，不依赖 Cloudflare、3x-ui 或 GitHub 登录：

```bash
curl -fsSL https://raw.githubusercontent.com/shangxin913-beep/shangxin-Proxy-Platform/main/vps/install-native.sh -o /tmp/exitpanel-native.sh
chmod 700 /tmp/exitpanel-native.sh
bash /tmp/exitpanel-native.sh --repo https://github.com/shangxin913-beep/shangxin-Proxy-Platform.git
```

如果已经把仓库下载到本机，也可以直接执行：

```bash
bash vps/install-native.sh
```

它会安装 Python、curl、OpenSSL、sudo 和系统用户，然后安装并启用 `exitpanel-agent.service`。worker 默认只监听 `127.0.0.1:18443`，共享密钥保存在 `/etc/exitpanel/agent.env`。

## 面板生产部署

面板一键部署脚本现在同时支持 APT 和 DNF：

```bash
bash vps/deploy-panel.sh --repo https://github.com/shangxin913-beep/shangxin-Proxy-Platform.git
```

可选 `--domain panel.example.com --email admin@example.com` 自动配置 Nginx/HTTPS。无域名时使用 VPS 公网 IP 访问。

## 更新、备份、回滚、状态和卸载

面板部署完成后会安装 `/usr/local/sbin/panelctl`。更新前自动备份环境文件、代码提交和 MySQL 数据库：

```bash
panelctl status
panelctl backup
panelctl update main
panelctl rollback
```

指定历史备份目录回滚：

```bash
panelctl rollback /opt/exitpanel/backups/20261112-120000
```

完整卸载是破坏性操作，会停止服务、删除面板配置、代码、Nginx 站点和 MySQL 数据卷。必须显式确认：

```bash
panelctl uninstall --yes
```

卸载前建议先执行 `panelctl backup`，并将 `/opt/exitpanel/backups/` 复制到外部存储。

## 自动端口并发检测

系统状态页提供“并发检测全部出口”按钮，默认并发数为 4，服务端上限为 20。接口也可通过 tRPC `exits.checkBatch` 调用，传入 `{ concurrency: 1..20, ids?: string[] }`。到期出口会被标记为 expired，不会重新加入订阅。

worker、Xray 原子应用、HMAC 通信和本地到期阻断保持原有安全边界；生产环境仍应优先使用 HTTPS，并仅开放实际需要的入口端口。
