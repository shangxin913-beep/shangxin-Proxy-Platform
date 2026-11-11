import { useMemo, useState } from "react";
import { startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clipboard,
  Clock3,
  ExternalLink,
  Globe2,
  KeyRound,
  LogOut,
  Menu,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Server,
  Settings2,
  ShieldCheck,
  Trash2,
  Wifi,
  X,
  Zap,
} from "lucide-react";

const navItems = [
  { id: "overview", label: "总览工作台", icon: Activity },
  { id: "exits", label: "出口资源", icon: Network },
  { id: "subscriptions", label: "订阅与入口", icon: Route },
  { id: "system", label: "系统状态", icon: Settings2 },
] as const;

type ViewId = (typeof navItems)[number]["id"];
type ExitRow = {
  id: string; type: string; displayName: string; providerName: string | null; upstreamHost: string | null; upstreamPort: number | null;
  username: string | null; expectedCountry: string | null; expectedCity: string | null; observedIp: string | null;
  observedCountry: string | null; observedCity: string | null; status: string; enabled: number; subscribeEnabled: number;
  entryHost: string; entryPort: number; entryProtocol: string; entrySecurity: string; entryUuid: string; expiresAt: Date | null;
  lastCheckedAt: Date | null; latencyMs: number | null; lastError: string | null; createdAt: Date; updatedAt: Date; hasPassword: boolean;
};

type FormState = {
  type: "direct" | "socks5";
  displayName: string;
  providerName: string;
  upstreamHost: string;
  upstreamPort: string;
  username: string;
  password: string;
  expectedCountry: string;
  expectedCity: string;
  entryHost: string;
  entryPort: string;
  expiresAt: string;
  subscribeEnabled: boolean;
};

const emptyForm: FormState = {
  type: "socks5",
  displayName: "",
  providerName: "",
  upstreamHost: "",
  upstreamPort: "",
  username: "",
  password: "",
  expectedCountry: "",
  expectedCity: "",
  entryHost: "vps.example.com",
  entryPort: "",
  expiresAt: "",
  subscribeEnabled: true,
};

function dateInputValue(value?: Date | string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function toIso(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function formatDate(value?: Date | string | null) {
  if (!value) return "永不过期";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", year: "numeric" }).format(new Date(value));
}

function daysLeft(value?: Date | string | null) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

function statusMeta(status: string, enabled: number) {
  if (!enabled || status === "disabled") return { label: "已停用", tone: "muted", icon: X };
  if (status === "passed") return { label: "已通过", tone: "success", icon: Check };
  if (status === "checking") return { label: "检测中", tone: "warning", icon: RefreshCw };
  if (status === "expired") return { label: "已过期", tone: "danger", icon: Clock3 };
  if (status === "failed") return { label: "故障", tone: "danger", icon: CircleAlert };
  return { label: "待检测", tone: "muted", icon: Activity };
}

function toneClass(tone: string) {
  return tone === "success" ? "status-success" : tone === "warning" ? "status-warning" : tone === "danger" ? "status-danger" : "status-muted";
}

function PageHeader({ title, eyebrow, description, action }: { title: string; eyebrow: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action}
    </div>
  );
}

function StatCard({ label, value, caption, icon: Icon, accent = "green" }: { label: string; value: number | string; caption: string; icon: typeof Activity; accent?: string }) {
  return (
    <Card className={`stat-card accent-${accent}`}>
      <CardContent>
        <div className="stat-icon"><Icon size={18} /></div>
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value}</p>
        <p className="stat-caption">{caption}</p>
      </CardContent>
    </Card>
  );
}

function ExitStatus({ exit }: { exit: ExitRow }) {
  const meta = statusMeta(exit.status, exit.enabled);
  const Icon = meta.icon;
  return <span className={`status-pill ${toneClass(meta.tone)}`}><Icon size={13} className={exit.status === "checking" ? "spin" : ""} />{meta.label}</span>;
}

function PathChip({ exit }: { exit: ExitRow }) {
  return <div className="path-chip"><span className="path-entry">{exit.entryHost}:{exit.entryPort}</span><ArrowRight size={13} /><span className="path-exit">{exit.observedIp || "等待检测"}</span></div>;
}

function LoginView() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const loginMutation = trpc.auth.localLogin.useMutation({ onSuccess: () => window.location.reload() });
  return <div className="login-shell"><div className="login-card"><div className="brand-mark large"><span>EP</span></div><p className="eyebrow">EXITPANEL / PRIVATE CONTROL</p><h1>出口代理管理面板</h1><p>统一管理 VPS 入口、第三方 SOCKS5 出口和节点到期周期。实际出口与客户端入口始终分开记录。</p><form className="form-body" onSubmit={(event) => { event.preventDefault(); loginMutation.mutate({ username, password }); }}><label>管理员用户名<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label><label>管理员密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label><Button size="lg" type="submit" disabled={loginMutation.isPending}><KeyRound size={17} />{loginMutation.isPending ? "登录中…" : "本地管理员登录"}</Button></form><div className="login-divider">或</div><Button size="lg" variant="outline" onClick={() => startLogin()}><ExternalLink size={17} />使用 Manus 登录</Button><small>首次本地登录：用户名 admin，密码 admin。登录后请立即修改密码。</small></div></div>;
}

function ChangePasswordView({ user, onDone }: { user: { id: number }; onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("admin");
  const [newPassword, setNewPassword] = useState("");
  const mutation = trpc.auth.changeLocalPassword.useMutation({ onSuccess: () => { toast.success("密码已更新"); onDone(); } });
  return <div className="login-shell"><div className="login-card"><div className="brand-mark large"><span>EP</span></div><p className="eyebrow">SECURITY / FIRST LOGIN</p><h1>请修改管理员密码</h1><p>首次使用默认密码登录后，必须设置至少 8 位的新密码。</p><form className="form-body" onSubmit={(event) => { event.preventDefault(); mutation.mutate({ currentPassword, newPassword }); }}><label>当前密码<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>新密码<input type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 8 位" /></label><Button size="lg" type="submit" disabled={mutation.isPending || newPassword.length < 8}><ShieldCheck size={17} />保存新密码</Button></form></div></div>;
}

export default function Home() {
  const auth = useAuth();
  const [view, setView] = useState<ViewId>("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExitRow | null>(null);
  const [selected, setSelected] = useState<ExitRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const utils = trpc.useUtils();
  const exitsQuery = trpc.exits.list.useQuery(undefined, { enabled: auth.isAuthenticated, refetchOnWindowFocus: false });
  const summaryQuery = trpc.exits.summary.useQuery(undefined, { enabled: auth.isAuthenticated, refetchOnWindowFocus: false });
  const subscriptionQuery = trpc.subscriptions.preview.useQuery(undefined, { enabled: auth.isAuthenticated, refetchOnWindowFocus: false });
  const subscriptionLinksQuery = trpc.subscriptions.links.useQuery(undefined, { enabled: auth.isAuthenticated, refetchOnWindowFocus: false });
  const workerQuery = trpc.system.worker.useQuery(undefined, { enabled: auth.isAuthenticated, refetchOnWindowFocus: false });
  const detailQuery = trpc.exits.detail.useQuery({ id: selected?.id || "" }, { enabled: Boolean(selected?.id), refetchOnWindowFocus: false });
  const createMutation = trpc.exits.create.useMutation({ onSuccess: refreshAll });
  const updateMutation = trpc.exits.update.useMutation({ onSuccess: refreshAll });
  const toggleMutation = trpc.exits.toggle.useMutation({ onSuccess: refreshAll });
  const deleteMutation = trpc.exits.remove.useMutation({ onSuccess: refreshAll });
  const checkMutation = trpc.exits.check.useMutation({ onSuccess: refreshAll });

  function refreshAll() {
    void utils.exits.list.invalidate();
    void utils.exits.summary.invalidate();
    void utils.subscriptions.preview.invalidate();
    void utils.exits.detail.invalidate();
    setFormOpen(false);
    setEditing(null);
    toast.success("已保存，面板状态已刷新");
  }

  const exits = exitsQuery.data || [];
  const summary = summaryQuery.data || { total: 0, healthy: 0, checking: 0, faulted: 0, expired: 0, soon: 0, subscribed: 0, entries: 0 };
  const upcoming = useMemo(() => exits.filter((exit) => {
    const days = daysLeft(exit.expiresAt);
    return days !== null && days >= 0 && days <= 14;
  }).sort((a, b) => new Date(a.expiresAt || 0).getTime() - new Date(b.expiresAt || 0).getTime()), [exits]);

  if (auth.loading) return <div className="loading-screen"><RefreshCw className="spin" />正在读取管理员会话…</div>;
  if (!auth.user) return <LoginView />;
  if (auth.user.passwordMustChange) return <ChangePasswordView user={auth.user} onDone={() => auth.refresh()} />;
  if (auth.user.role !== "admin") return <div className="loading-screen"><CircleAlert /><div><strong>当前账号没有管理员权限</strong><p>请使用项目所有者账号登录，或者为当前用户分配 admin 角色。</p></div></div>;

  function openCreate() {
    const usedPorts = exits.map((exit) => exit.entryPort);
    let nextPort = 56001;
    while (usedPorts.includes(nextPort) && nextPort < 65535) nextPort += 1;
    if (usedPorts.includes(nextPort)) { toast.error("没有可用的客户端入口端口"); return; }
    setEditing(null); setSelected(null); setForm({ ...emptyForm, entryPort: String(nextPort) }); setFormOpen(true);
  }

  function openEdit(exit: ExitRow) {
    setEditing(exit); setSelected(null); setForm({
      type: exit.type === "direct" ? "direct" : "socks5",
      displayName: exit.displayName,
      providerName: exit.providerName || "",
      upstreamHost: exit.upstreamHost || "",
      upstreamPort: exit.upstreamPort ? String(exit.upstreamPort) : "",
      username: exit.username || "",
      password: "",
      expectedCountry: exit.expectedCountry || "",
      expectedCity: exit.expectedCity || "",
      entryHost: exit.entryHost,
      entryPort: String(exit.entryPort),
      expiresAt: dateInputValue(exit.expiresAt),
      subscribeEnabled: Boolean(exit.subscribeEnabled),
    }); setFormOpen(true);
  }

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      ...form,
      upstreamPort: form.upstreamPort ? Number(form.upstreamPort) : undefined,
      entryPort: Number(form.entryPort),
      expiresAt: toIso(form.expiresAt),
      providerName: form.providerName || undefined,
      upstreamHost: form.upstreamHost || undefined,
      username: form.username || undefined,
      password: form.password || undefined,
      expectedCountry: form.expectedCountry || undefined,
      expectedCity: form.expectedCity || undefined,
    };
    if (form.type === "socks5" && (!payload.upstreamHost || !payload.upstreamPort)) {
      toast.error("第三方 SOCKS5 需要填写上游地址和端口"); return;
    }
    try {
      if (editing) await updateMutation.mutateAsync({ id: editing.id, data: payload });
      else await createMutation.mutateAsync(payload);
    } catch (error: any) { toast.error(error?.message || "保存失败"); }
  }

  async function runCheck(exit: ExitRow) {
    try { await checkMutation.mutateAsync({ id: exit.id }); toast.success(`${exit.displayName} 已完成模拟检测`); } catch (error: any) { toast.error(error?.message || "检测失败"); }
  }

  async function toggleExit(exit: ExitRow) {
    try { await toggleMutation.mutateAsync({ id: exit.id, enabled: !Boolean(exit.enabled) }); toast.success(exit.enabled ? "入口已阻断" : "入口已恢复"); } catch (error: any) { toast.error(error?.message || "操作失败"); }
  }

  async function removeExit(exit: ExitRow) {
    if (!window.confirm(`确认删除“${exit.displayName}”？检测记录和入口配置也会移除。`)) return;
    try { await deleteMutation.mutateAsync({ id: exit.id }); setSelected(null); toast.success("出口已删除"); } catch (error: any) { toast.error(error?.message || "删除失败"); }
  }

  async function copy(value: string, message = "已复制") {
    await navigator.clipboard.writeText(value); toast.success(message);
  }

  const section = view === "overview" ? <OverviewView summary={summary} exits={exits} upcoming={upcoming} onAdd={openCreate} onOpen={(exit) => setSelected(exit)} onCheck={runCheck} onViewExits={() => setView("exits")} onViewSubscriptions={() => setView("subscriptions")} />
    : view === "exits" ? <ExitsView exits={exits} onAdd={openCreate} onOpen={(exit) => setSelected(exit)} onEdit={openEdit} onCheck={runCheck} onToggle={toggleExit} onDelete={removeExit} />
    : view === "subscriptions" ? <SubscriptionsView exits={exits} subscription={subscriptionQuery.data} links={subscriptionLinksQuery.data} onCopy={copy} onOpen={(exit) => setSelected(exit)} />
    : <SystemView summary={summary} worker={workerQuery.data} />;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
      <div className="brand"><div className="brand-mark"><span>EP</span></div><div><strong>ExitPanel</strong><small>出口路由工作台</small></div><button className="mobile-close" onClick={() => setMobileNav(false)}><X size={18} /></button></div>
      <div className="tenant-label"><span className="live-dot" /> 单 VPS / 管理员</div>
      <nav>{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? "nav-active" : ""} onClick={() => { setView(item.id); setMobileNav(false); }}><Icon size={18} /><span>{item.label}</span>{item.id === "exits" && <em>{summary.total}</em>}</button>; })}</nav>
      <div className="sidebar-bottom"><div className="vps-mini"><div className="vps-icon"><Server size={17} /></div><div><small>入口主机</small><strong>vps.example.com</strong></div><span className="health-dot" /></div><button className="user-row" onClick={() => auth.logout()}><div className="avatar">{(auth.user.name || "A").slice(0, 1).toUpperCase()}</div><div><strong>{auth.user.name || "管理员"}</strong><small>退出登录</small></div><LogOut size={15} /></button></div>
    </aside>
    <main className="main-area"><header className="topbar"><button className="menu-button" onClick={() => setMobileNav(true)}><Menu size={20} /></button><div className="breadcrumb"><span>ExitPanel</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.id === view)?.label}</strong></div><div className="top-actions"><span className="preview-note"><span className="live-dot" /> 预览模式 · 模拟检测</span><Button variant="outline" size="sm" onClick={() => { void exitsQuery.refetch(); void summaryQuery.refetch(); }}><RefreshCw size={15} />刷新</Button></div></header><div className="content-wrap">{section}</div></main>
    <Dialog open={formOpen} onOpenChange={setFormOpen}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>{editing ? "编辑出口资源" : "添加出口资源"}</DialogTitle><DialogDescription>上游代理负责实际出网，客户端入口仍然监听在 VPS 上。密码留空表示保留原值。</DialogDescription></DialogHeader><form onSubmit={submitForm} className="form-body"><div className="form-grid two"><label>出口类型<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as FormState["type"] })}><option value="socks5">第三方 SOCKS5</option><option value="direct">VPS 本机直出</option></select></label><label>自定义备注<input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="例如：墨西哥家宽 · 01" /></label></div><div className="form-section-title">上游出口资源</div><div className="form-grid two"><label>代理服务器地址<input disabled={form.type === "direct"} value={form.upstreamHost} onChange={(e) => setForm({ ...form, upstreamHost: e.target.value })} placeholder="proxy.example.com 或 IP" /></label><label>代理端口<input disabled={form.type === "direct"} type="number" value={form.upstreamPort} onChange={(e) => setForm({ ...form, upstreamPort: e.target.value })} placeholder="9188" /></label><label>账号<input disabled={form.type === "direct"} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="SOCKS5 用户名" /></label><label>密码<input disabled={form.type === "direct"} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editing?.hasPassword ? "留空保留已保存密码" : "SOCKS5 密码"} /></label><label>预期国家<input value={form.expectedCountry} onChange={(e) => setForm({ ...form, expectedCountry: e.target.value })} placeholder="例如：墨西哥" /></label><label>预期城市<input value={form.expectedCity} onChange={(e) => setForm({ ...form, expectedCity: e.target.value })} placeholder="例如：墨西哥城" /></label></div><div className="form-section-title">客户端入口</div><div className="form-grid two"><label>入口域名 / IP<input required value={form.entryHost} onChange={(e) => setForm({ ...form, entryHost: e.target.value })} placeholder="vps.example.com" /><small>客户端连接这里，不填写落地 IP。</small></label><label>入口端口<input required type="number" min="1" max="65535" value={form.entryPort} onChange={(e) => setForm({ ...form, entryPort: e.target.value })} placeholder="56608" /><small>VPS 对外监听端口。</small></label><label>到期时间<input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /><small>留空表示永不过期。</small></label><label className="check-label"><input type="checkbox" checked={form.subscribeEnabled} onChange={(e) => setForm({ ...form, subscribeEnabled: e.target.checked })} />加入新订阅</label></div><DialogFooter><Button type="button" variant="outline" onClick={() => setFormOpen(false)}>取消</Button><Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}><Check size={16} />{editing ? "保存修改" : "创建出口"}</Button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}><DialogContent className="detail-dialog"><DialogHeader><div className="detail-kicker"><span className="eyebrow">出口详情</span><ExitStatus exit={selected || ({ enabled: 0, status: "unknown" } as ExitRow)} /></div><DialogTitle>{selected?.displayName}</DialogTitle><DialogDescription>入口地址与实际落地出口分开记录。此页展示的是管理配置，不会把落地 IP 当成客户端入口。</DialogDescription></DialogHeader>{detailQuery.isLoading ? <div className="inline-loading"><RefreshCw className="spin" />读取详情…</div> : detailQuery.data && <DetailContent detail={detailQuery.data} onEdit={() => { if (selected) openEdit(selected); }} onCheck={() => selected && runCheck(selected)} onCopy={copy} />}</DialogContent></Dialog>
  </div>;
}

function OverviewView({ summary, exits, upcoming, onAdd, onOpen, onCheck, onViewExits, onViewSubscriptions }: { summary: any; exits: ExitRow[]; upcoming: ExitRow[]; onAdd: () => void; onOpen: (exit: ExitRow) => void; onCheck: (exit: ExitRow) => void; onViewExits: () => void; onViewSubscriptions: () => void }) {
  return <><PageHeader eyebrow="OPERATIONS / OVERVIEW" title="出口工作台" description="把客户端入口、真实落地出口和到期周期放在同一条可追溯链路上。" action={<Button onClick={onAdd}><Plus size={17} />添加出口</Button>} /><section className="stat-grid"><StatCard label="出口总数" value={summary.total} caption={`${summary.entries} 个客户端入口`} icon={Network} /><StatCard label="已通过" value={summary.healthy} caption="最近一次检测通过" icon={ShieldCheck} accent="green" /><StatCard label="待处理" value={summary.faulted + summary.expired} caption={`${summary.faulted} 个异常 · ${summary.expired} 个过期`} icon={CircleAlert} accent="orange" /><StatCard label="即将到期" value={summary.soon} caption="未来 7 天内需要关注" icon={Clock3} accent="red" /></section><section className="overview-grid"><Card className="panel-card route-panel"><CardHeader><div><p className="eyebrow">ROUTE HEALTH</p><CardTitle>入口 → 出口链路</CardTitle></div><button className="text-button" onClick={onViewExits}>查看全部 <ArrowRight size={14} /></button></CardHeader><CardContent><div className="health-line"><span className="line-node healthy" /><span className="line-segment" /><span className="line-node healthy" /><span className="line-segment faint" /><span className="line-node faint" /></div><div className="health-labels"><span><strong>{summary.entries}</strong> 个入口</span><span><strong>{summary.healthy}</strong> 条已验证</span><span>VPS → 供应商</span></div><div className="exit-stack">{exits.slice(0, 4).map((exit) => <button key={exit.id} className="exit-row compact" onClick={() => onOpen(exit)}><div className="exit-title"><span className="country-mark">{exit.observedCountry === "泰国" ? "TH" : exit.observedCountry === "墨西哥" ? "MX" : "EP"}</span><div><strong>{exit.displayName}</strong><small>{exit.type === "direct" ? "VPS 本机直出" : "第三方 SOCKS5"}</small></div></div><PathChip exit={exit} /><ExitStatus exit={exit} /><span className="chevron"><ChevronRight size={16} /></span></button>)}{!exits.length && <EmptyState title="还没有出口" description="先添加一个第三方 SOCKS5 或 VPS 本机直出。" action={onAdd} />}</div></CardContent></Card><div className="side-stack"><Card className="panel-card expiry-card"><CardHeader><div><p className="eyebrow">LIFECYCLE</p><CardTitle>到期提醒</CardTitle></div><Clock3 size={18} className="muted-icon" /></CardHeader><CardContent>{upcoming.length ? upcoming.slice(0, 3).map((exit) => <div className="expiry-row" key={exit.id}><div><strong>{exit.displayName}</strong><small>{formatDate(exit.expiresAt)}</small></div><span className={`days-badge ${daysLeft(exit.expiresAt)! <= 3 ? "urgent" : ""}`}>{daysLeft(exit.expiresAt)} 天</span></div>) : <div className="empty-mini"><Check size={16} />未来 14 天没有到期出口</div>}</CardContent></Card><Card className="panel-card quick-card"><CardHeader><div><p className="eyebrow">QUICK ACTIONS</p><CardTitle>快速操作</CardTitle></div></CardHeader><CardContent><button onClick={() => exits[0] && onCheck(exits[0])}><Wifi size={16} /><span>检测最近出口</span><ChevronRight size={15} /></button><button onClick={onViewExits}><Network size={16} /><span>管理出口资源</span><ChevronRight size={15} /></button><button onClick={onViewSubscriptions}><ArrowDownToLine size={16} /><span>查看订阅预览</span><ChevronRight size={15} /></button></CardContent></Card></div></section></>;
}

function ExitsView({ exits, onAdd, onOpen, onEdit, onCheck, onToggle, onDelete }: { exits: ExitRow[]; onAdd: () => void; onOpen: (exit: ExitRow) => void; onEdit: (exit: ExitRow) => void; onCheck: (exit: ExitRow) => void; onToggle: (exit: ExitRow) => void; onDelete: (exit: ExitRow) => void }) {
  const [filter, setFilter] = useState("all");
  const filtered = exits.filter((exit) => filter === "all" || (filter === "healthy" ? exit.status === "passed" && Boolean(exit.enabled) : filter === "expiring" ? (daysLeft(exit.expiresAt) ?? 999) <= 14 : filter === "disabled" ? !exit.enabled : exit.type === filter));
  return <><PageHeader eyebrow="RESOURCES / EXITS" title="出口资源" description="出口资源是实际出网路径；客户端只连接下方的 VPS 入口。" action={<Button onClick={onAdd}><Plus size={17} />添加出口</Button>} /><div className="filter-bar"><div className="filter-tabs">{[["all", "全部"], ["healthy", "已通过"], ["socks5", "第三方 SOCKS5"], ["expiring", "即将到期"], ["disabled", "已停用"]].map(([id, label]) => <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{label}</button>)}</div><span className="result-count">{filtered.length} 条资源</span></div><Card className="table-card"><div className="table-wrap"><table><thead><tr><th>出口备注</th><th>实际出口 / 地区</th><th>入口</th><th>检测</th><th>到期时间</th><th>订阅</th><th /></tr></thead><tbody>{filtered.map((exit) => <tr key={exit.id}><td><button className="table-name" onClick={() => onOpen(exit)}><span className="country-mark">{exit.observedCountry === "泰国" ? "TH" : exit.observedCountry === "墨西哥" ? "MX" : exit.type === "direct" ? "EP" : "??"}</span><span><strong>{exit.displayName}</strong><small>{exit.type === "direct" ? "VPS 本机直出" : `${exit.providerName || "第三方 SOCKS5"} · ${exit.upstreamHost || "未配置上游"}`}</small></span></button></td><td><code>{exit.observedIp || "—"}</code><small>{exit.observedCountry || exit.expectedCountry || "地区待验证"}{exit.observedCity ? ` · ${exit.observedCity}` : ""}</small></td><td><code>{exit.entryHost}:{exit.entryPort}</code><small>VLESS · {exit.entrySecurity}</small></td><td><ExitStatus exit={exit} />{exit.latencyMs ? <small>{exit.latencyMs} ms</small> : <small>尚未检测</small>}</td><td><span className={daysLeft(exit.expiresAt) !== null && daysLeft(exit.expiresAt)! <= 7 ? "expiry-text" : ""}>{formatDate(exit.expiresAt)}</span>{daysLeft(exit.expiresAt) !== null && <small>{daysLeft(exit.expiresAt)! < 0 ? "已到期" : `剩余 ${daysLeft(exit.expiresAt)} 天`}</small>}</td><td><span className={`subscription-dot ${exit.subscribeEnabled && exit.enabled && exit.status !== "expired" ? "on" : "off"}`} />{exit.subscribeEnabled && exit.enabled && exit.status !== "expired" ? "已加入" : "已排除"}</td><td><div className="row-actions"><Button size="icon-sm" variant="ghost" title="检测" onClick={() => onCheck(exit)}><RefreshCw size={15} /></Button><Button size="icon-sm" variant="ghost" title="编辑" onClick={() => onEdit(exit)}><Pencil size={15} /></Button><Button size="icon-sm" variant="ghost" title={exit.enabled ? "停用" : "启用"} onClick={() => onToggle(exit)}><Zap size={15} /></Button><Button size="icon-sm" variant="ghost" className="danger-hover" title="删除" onClick={() => onDelete(exit)}><Trash2 size={15} /></Button></div></td></tr>)}</tbody></table>{!filtered.length && <EmptyState title="没有匹配的出口" description="调整筛选条件，或者添加一个新的出口资源。" action={onAdd} />}</div></Card>;<div className="info-strip"><ShieldCheck size={16} /><span>当前版本只展示模拟检测和订阅预览。真实 root 安装器、Xray/sing-box 与 SOCKS5 连通检测将在后续接入。</span></div></>;
}

function SubscriptionsView({ exits, subscription, links, onCopy, onOpen }: { exits: ExitRow[]; subscription: any; links?: { base64: string; clash: string }; onCopy: (value: string, message?: string) => void; onOpen: (exit: ExitRow) => void }) {
  const [format, setFormat] = useState<"vless" | "clash">("vless");
  const active = exits.filter((exit) => exit.enabled && exit.subscribeEnabled && exit.status !== "expired");
  const content = format === "vless" ? (subscription?.vless || []).join("\n") : JSON.stringify(subscription?.clash || {}, null, 2);
  return <><PageHeader eyebrow="DELIVERY / SUBSCRIPTIONS" title="订阅与入口" description="订阅只输出已启用且未过期的入口；Address 是 VPS，落地 IP 是检测结果。" action={<Button variant="outline" onClick={() => onCopy(content, "订阅内容已复制")}><Clipboard size={16} />复制当前格式</Button>} /><div className="subscription-layout"><Card className="panel-card subscription-card"><CardHeader><div><p className="eyebrow">PRIVATE SUBSCRIPTION</p><CardTitle>生成预览</CardTitle></div><div className="format-switch"><button className={format === "vless" ? "active" : ""} onClick={() => setFormat("vless")}>v2rayN / VLESS</button><button className={format === "clash" ? "active" : ""} onClick={() => setFormat("clash")}>Clash / Mihomo</button></div></CardHeader><CardContent><div className="subscription-meta"><span><strong>{active.length}</strong> 个入口会被发布</span><span>配置在本机生成</span><span className="private-tag"><KeyRound size={13} />私有</span></div>{links && <div className="link-stack"><div><small>v2rayN / VLESS 订阅 URL</small><button onClick={() => onCopy(`${window.location.origin}${links.base64}`, "VLESS 订阅地址已复制")}><code>{links.base64}</code><Clipboard size={14} /></button></div><div><small>Clash / Mihomo 订阅 URL</small><button onClick={() => onCopy(`${window.location.origin}${links.clash}`, "Clash 订阅地址已复制")}><code>{links.clash}</code><Clipboard size={14} /></button></div></div>}<pre className="code-preview">{content || "暂无可用节点。请先检测并启用一个出口。"}</pre><div className="subscription-note"><CircleAlert size={15} /><span>到期、停用或检测失败的资源不会自动回落到其他国家，也不会伪装成 VPS 直出。</span></div></CardContent></Card><Card className="panel-card included-card"><CardHeader><div><p className="eyebrow">INCLUDED NODES</p><CardTitle>当前范围</CardTitle></div></CardHeader><CardContent><div className="included-list">{active.map((exit) => <button key={exit.id} onClick={() => onOpen(exit)}><div className="included-icon"><Globe2 size={16} /></div><div><strong>{exit.displayName}</strong><small>{exit.entryHost}:{exit.entryPort} · 出口 {exit.observedIp || "待检测"}</small></div><Check size={15} className="include-check" /></button>)}{!active.length && <EmptyState title="订阅为空" description="启用一个已通过检测的出口后，它会出现在这里。" />}</div></CardContent></Card></div></>;
}

function SystemView({ summary, worker }: { summary: any; worker?: { configured: boolean; reachable: boolean; detail: string } }) {
  return <><PageHeader eyebrow="SYSTEM / READINESS" title="系统状态" description="这里展示面板服务和后续 root 运行层的接入边界。" /><div className="system-grid"><Card className="panel-card"><CardHeader><div><p className="eyebrow">SERVICE STATUS</p><CardTitle>当前组件</CardTitle></div><span className="status-pill status-success"><Check size={13} />面板正常</span></CardHeader><CardContent><div className="system-row"><Server size={17} /><div><strong>ExitPanel API</strong><small>管理 API、出口配置与生命周期</small></div><span className="system-ok">在线</span></div><div className="system-row"><Activity size={17} /><div><strong>VPS worker</strong><small>{worker?.configured ? worker.detail : "未配置 EXITPANEL_WORKER_URL"}</small></div><span className={worker?.reachable ? "system-ok" : "system-wait"}>{worker?.reachable ? "在线" : "待连接"}</span></div><div className="system-row"><ArrowDownToLine size={17} /><div><strong>订阅生成</strong><small>公开 token URL，实时过滤到期和未验证出口</small></div><span className="system-ok">就绪</span></div><div className="system-row"><Wifi size={17} /><div><strong>Xray 配置运行层</strong><small>HMAC 通信、原子替换、校验失败回滚</small></div><span className="system-wait">按节点启用</span></div></CardContent></Card><Card className="panel-card readiness-card"><CardHeader><div><p className="eyebrow">RUNNING SNAPSHOT</p><CardTitle>运行摘要</CardTitle></div></CardHeader><CardContent><div className="big-number">{summary.healthy}<span>/ {summary.total}</span></div><p>出口最近一次检测通过</p><div className="progress-track"><span style={{ width: summary.total ? `${Math.round(summary.healthy / summary.total * 100)}%` : "0%" }} /></div><div className="readiness-list"><span><i className="dot green" />订阅入口 <strong>{summary.subscribed}</strong></span><span><i className="dot amber" />即将到期 <strong>{summary.soon}</strong></span><span><i className="dot red" />需处理 <strong>{summary.faulted + summary.expired}</strong></span></div></CardContent></Card></div><div className="info-strip large"><ShieldCheck size={16} /><span>root worker 会在 VPS 上执行真实 SOCKS5 探测和 Xray 配置原子应用；面板只通过 HMAC 请求调用，不在浏览器暴露凭据。</span></div></>;
}

function DetailContent({ detail, onEdit, onCheck, onCopy }: { detail: any; onEdit: () => void; onCheck: () => void; onCopy: (value: string, message?: string) => void }) {
  const days = daysLeft(detail.expiresAt);
  return <div className="detail-content"><div className="detail-actions"><Button variant="outline" size="sm" onClick={onCheck}><RefreshCw size={15} />重新检测</Button><Button size="sm" onClick={onEdit}><Pencil size={15} />编辑资源</Button></div><div className="detail-route"><div><small>客户端入口</small><code>{detail.entryHost}:{detail.entryPort}</code><span>VLESS / {detail.entrySecurity}</span></div><ArrowRight size={22} /><div><small>实际落地出口</small><code>{detail.observedIp || "待检测"}</code><span>{detail.observedCountry || detail.expectedCountry || "地区待验证"} · {detail.latencyMs ? `${detail.latencyMs} ms` : "无延迟数据"}</span></div></div><div className="detail-facts"><div><small>自定义备注</small><strong>{detail.displayName}</strong></div><div><small>上游服务器</small><strong>{detail.upstreamHost ? `${detail.upstreamHost}:${detail.upstreamPort}` : "VPS 本机直出"}</strong></div><div><small>凭据</small><strong>{detail.hasPassword ? "已受保护保存" : "未设置"}</strong></div><div><small>到期时间</small><strong className={days !== null && days <= 7 ? "expiry-text" : ""}>{formatDate(detail.expiresAt)}{days !== null ? ` · ${days < 0 ? "已过期" : `剩余 ${days} 天`}` : ""}</strong></div></div><div className="detail-section"><div className="detail-section-title"><span>最近检测</span><small>实际链路验证结果</small></div>{detail.checks?.length ? <div className="check-list">{detail.checks.slice(0, 5).map((check: any) => <div key={check.id}><span className={`mini-check ${check.status === "passed" ? "passed" : "failed"}`} /> <strong>{check.status === "passed" ? "通过" : "失败"}</strong><span>{check.observedIp || check.errorMessage || "—"}</span><time>{formatDate(check.checkedAt)}</time></div>)}</div> : <p className="empty-line">还没有检测记录。</p>}</div><div className="detail-section"><div className="detail-section-title"><span>节点分享</span><small>仅显示可分享的入口信息</small></div><div className="copy-row"><code>vless://••••••@{detail.entryHost}:{detail.entryPort}</code><Button variant="outline" size="sm" onClick={() => onCopy(`${detail.entryHost}:${detail.entryPort}`, "入口地址已复制")}><Clipboard size={14} />复制入口</Button></div></div></div>;
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: () => void }) { return <div className="empty-state"><div className="empty-icon"><Network size={20} /></div><strong>{title}</strong><p>{description}</p>{action && <Button variant="outline" size="sm" onClick={action}><Plus size={14} />添加资源</Button>}</div>; }
