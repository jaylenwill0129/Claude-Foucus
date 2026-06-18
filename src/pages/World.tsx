import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrainCircuit, Music2, Search, Mail, ShoppingBag, PackageCheck, WalletCards,
  RadioTower, RefreshCw, Power, LogIn, X, Check, Sparkles, Send, MapPin, Store,
} from "lucide-react";
import {
  getInitialConnectors, probeBusinessConnectors, loadRevenueSummary, loadAutomationSummary,
  setAutomationEnabled, loadHermesBrief, runCreativeCycle, loadCreativePackages, decideCreativePackage,
  loadAutomationJobs, decideAutomationJob, loadSystemsHealth, loadHermesHistory, loadProspects, loadAgentKnowledge,
  findBrandDomains, loadGoogleDriveStatus, startGoogleDriveConnect, loadTreasury,
  type AutomationSummary, type RevenueSummary, type HermesIntelligence, type CreativePackageRecord, type AutomationJob,
  type SystemHealth, type HermesHistoryEntry, type ProspectRecord, type KnowledgeEntry, type DomainCheck, type Treasury,
} from "@/lib/businessOps";
import { computeFallbackBrief, buildHermesWorldState } from "@/lib/hermesBrief";
import { agentPlaybooks } from "@/lib/agentPlaybooks";
import { benchmarkFor } from "@/lib/agentBenchmarks";
import { probeOperatorRelay, relayToOperator, type RelayStatus } from "@/lib/operatorRelay";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";

type Place = {
  id: string;
  name: string;
  place: string;
  role: string;
  objective: string;
  icon: typeof BrainCircuit;
  connector?: "crm" | "outreach" | "storefront" | "payments" | "fulfillment";
  kind: "core" | "agent" | "relay";
  x: number; // % of canvas
  y: number;
};

const PLACES: Place[] = [
  { id: "hermes", name: "Hermes", place: "Intelligence Atrium", role: "World intelligence", objective: "Read the world, name the bottleneck, route every agent.", icon: BrainCircuit, kind: "core", x: 50, y: 47 },
  { id: "creative", name: "Aria", place: "Signal Studio", role: "Creative Director & DJ", objective: "Turn live trends into approval-ready release packages.", icon: Music2, kind: "agent", x: 25, y: 19 },
  { id: "research", name: "Maya", place: "Prospect Observatory", role: "Research", objective: "Find businesses with an expensive, measurable problem.", icon: Search, connector: "crm", kind: "agent", x: 50, y: 12 },
  { id: "sales", name: "Marcus", place: "Outbound Office", role: "Sales", objective: "Turn qualified prospects into booked calls and offers.", icon: Mail, connector: "outreach", kind: "agent", x: 76, y: 20 },
  { id: "product", name: "Lena", place: "Storefront Studio", role: "Product", objective: "Create and publish offers people can buy now.", icon: ShoppingBag, connector: "storefront", kind: "agent", x: 88, y: 40 },
  { id: "commerce", name: "Cyrus", place: "Commerce Floor", role: "Dropshipping Commerce", objective: "Build a branded dropshipping winner with fast fulfillment and unit economics that work.", icon: Store, connector: "storefront", kind: "agent", x: 90, y: 66 },
  { id: "delivery", name: "Dev", place: "Delivery Workshop", role: "Fulfillment", objective: "Complete paid work and preserve margin.", icon: PackageCheck, connector: "fulfillment", kind: "agent", x: 71, y: 84 },
  { id: "finance", name: "Ledger", place: "Revenue Vault", role: "Finance", objective: "Reconcile every dollar; reject unverified revenue.", icon: WalletCards, connector: "payments", kind: "agent", x: 30, y: 84 },
  { id: "relay", name: "Relay", place: "Operator Relay", role: "Operator channel", objective: "Email Hermes's briefs and approval requests to the operator.", icon: RadioTower, kind: "relay", x: 13, y: 51 },
];

export default function World() {
  const { user, signOut } = useAuth();
  const [connectors, setConnectors] = useState(getInitialConnectors);
  const [revenue, setRevenue] = useState<RevenueSummary>({ netRevenueCents: 0, verifiedCustomers: 0, verifiedEvents: 0, available: false });
  const [automation, setAutomation] = useState<AutomationSummary>({ authenticated: false, workerReady: false, plannerReady: false, enabled: false, paused: false, allowCrmSync: false, allowDraftProducts: false, activeJobs: 0, awaitingApproval: 0, succeededJobs: 0, failedJobs: 0 });
  const [hermes, setHermes] = useState<HermesIntelligence | null>(null);
  const [thinking, setThinking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [relayMsg, setRelayMsg] = useState("");
  const [systems, setSystems] = useState<SystemHealth[]>([]);
  const [history, setHistory] = useState<HermesHistoryEntry[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [relay, setRelay] = useState<RelayStatus>({ connected: false, channel: "email", detail: "Probing relay…" });

  const connectorMap = useMemo(() => Object.fromEntries(connectors.map((c) => [c.id, c])), [connectors]);
  const fallback = useMemo(() => computeFallbackBrief(connectors, revenue, automation), [connectors, revenue, automation]);
  const brief = hermes?.brief ?? fallback;
  const hermesLive = hermes?.source === "hermes-4";

  const ready = useCallback((p: Place) => {
    if (p.kind === "core" || p.id === "creative") return true;
    if (p.id === "relay") return relay.connected;
    return p.connector ? connectorMap[p.connector]?.status === "ready" : true;
  }, [connectorMap, relay.connected]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [nc, nr, na] = await Promise.all([probeBusinessConnectors(), loadRevenueSummary(), loadAutomationSummary()]);
    setConnectors(nc); setRevenue(nr); setAutomation(na); setRefreshing(false);
    setThinking(true);
    const intel = await loadHermesBrief(buildHermesWorldState(PLACES.filter((p) => p.connector).map((p) => ({ id: p.id, name: p.name, role: p.role, connector: p.connector! })), nc, nr, na), computeFallbackBrief(nc, nr, na));
    setHermes(intel); setThinking(false);
    setSystems(await loadSystemsHealth());
    setHistory(await loadHermesHistory());
    setKnowledge(await loadAgentKnowledge());
    setRelay(await probeOperatorRelay());
  }, []);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const connected = connectors.filter((c) => c.status === "ready").length;
  const readiness = Math.round((connected / connectors.length) * 100);
  const selected = PLACES.find((p) => p.id === selectedId) ?? null;
  const routeFor = (name: string) => brief.agentRoutes.find((r) => r.agent.toLowerCase() === name.toLowerCase());

  const toggleAutopilot = async () => {
    const r = await setAutomationEnabled(!automation.enabled);
    setRelayMsg(r.message);
    await refresh();
  };
  const relayBrief = async () => {
    const r = await relayToOperator({ kind: "hermes_brief", title: `Hermes: ${brief.mood}`, body: `Bottleneck: ${brief.bottleneck}. ${brief.route}`, meta: { iq: brief.intelligenceScore } });
    setRelayMsg(r.message);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0a0e14] text-slate-100">
      {/* ambient field */}
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: "radial-gradient(1200px 800px at 50% 40%, rgba(56,84,120,0.25), transparent 70%), radial-gradient(900px 600px at 20% 80%, rgba(40,70,60,0.2), transparent 70%)" }} />
      <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "linear-gradient(rgba(120,150,180,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(120,150,180,0.05) 1px, transparent 1px)", backgroundSize: "44px 44px" }} />

      {/* HUD */}
      <header className="relative z-20 flex items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#dff54a] text-[#0a0e14]"><BrainCircuit size={18} /></div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">Operator OS — Live World</h1>
            <p className="text-[10px] text-slate-400">{thinking ? "Hermes is reading the world…" : hermesLive ? "Hermes-4 online" : "Heuristic mode — sign in for live Hermes"}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Hud label="Revenue" value={`$${(revenue.netRevenueCents / 100).toFixed(0)}`} />
          <Hud label="Customers" value={`${revenue.verifiedCustomers}`} />
          <Hud label="Readiness" value={`${readiness}%`} />
          <Hud label="Hermes IQ" value={`${brief.intelligenceScore}`} accent />
          <button onClick={refresh} disabled={refreshing} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-[11px] font-semibold hover:bg-slate-800 disabled:opacity-50"><RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />Probe</button>
          <button onClick={toggleAutopilot} disabled={!automation.authenticated} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold disabled:opacity-40 ${automation.enabled ? "bg-[#dff54a] text-[#0a0e14]" : "border border-slate-700 bg-slate-900/60"}`}><Power size={13} />{automation.enabled ? "Armed" : "Autopilot"}</button>
          {user ? <button onClick={signOut} className="text-[10px] font-bold text-slate-400 hover:text-slate-100">Sign out</button> : <Link to="/auth" className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-slate-100"><LogIn size={12} />Sign in</Link>}
          <Link to="/console" className="text-[10px] font-bold text-slate-500 hover:text-slate-300">Console ↗</Link>
        </div>
      </header>

      {/* WORLD CANVAS */}
      <div className="relative z-10 mx-auto h-[calc(100vh-72px)] w-full max-w-[1400px]">
        {/* conduits */}
        <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: "none" }}>
          {PLACES.filter((p) => p.kind !== "core").map((p) => {
            const lit = ready(p);
            return <line key={p.id} x1="50%" y1="47%" x2={`${p.x}%`} y2={`${p.y}%`} stroke={lit ? "rgba(120,200,150,0.35)" : "rgba(150,120,90,0.25)"} strokeWidth={lit ? 2 : 1} strokeDasharray={lit ? "0" : "5 5"} />;
          })}
        </svg>

        {PLACES.map((p) => {
          const isReady = ready(p);
          const route = routeFor(p.name);
          const active = route?.priority === "now";
          const Icon = p.icon;
          const sizes = p.kind === "core" ? "h-32 w-32" : "h-24 w-24";
          return (
            <button key={p.id} onClick={() => setSelectedId(p.id)} className="absolute -translate-x-1/2 -translate-y-1/2 focus:outline-none" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
              <div className={`group relative grid ${sizes} place-items-center rounded-full border transition ${p.kind === "core" ? "border-[#dff54a]/50 bg-[#11161f]" : isReady ? "border-emerald-500/40 bg-[#0e1620]" : "border-amber-600/40 bg-[#16120e]"} ${selectedId === p.id ? "ring-2 ring-[#dff54a]" : ""} hover:scale-105`} style={{ boxShadow: p.kind === "core" ? "0 0 50px rgba(223,245,74,0.18)" : isReady ? "0 0 26px rgba(80,200,140,0.18)" : "0 0 26px rgba(200,150,70,0.14)" }}>
                {active && <span className="absolute inset-0 animate-ping rounded-full bg-[#dff54a]/15" />}
                <Icon size={p.kind === "core" ? 34 : 24} className={p.kind === "core" ? "text-[#dff54a]" : isReady ? "text-emerald-300" : "text-amber-300"} />
                <span className={`absolute -bottom-2 right-2 h-3 w-3 rounded-full border-2 border-[#0a0e14] ${isReady ? "bg-emerald-400" : "bg-amber-400"}`} />
              </div>
              <div className="mt-2 text-center">
                <p className={`text-xs font-bold ${p.kind === "core" ? "text-[#dff54a]" : "text-slate-100"}`}>{p.name}</p>
                <p className="text-[9px] uppercase tracking-wider text-slate-500">{p.place}</p>
              </div>
            </button>
          );
        })}

        {/* Hermes brief floating under the core */}
        <div className="absolute left-1/2 top-[63%] w-[300px] -translate-x-1/2 rounded-xl border border-slate-800 bg-[#0d1219]/90 p-3 text-center backdrop-blur">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{hermesLive ? "Hermes-4 brief" : "Heuristic brief"}</p>
          <p className="mt-1 text-xs font-semibold text-slate-100">{brief.mood}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400"><span className="text-amber-300">{brief.bottleneck}</span> — {brief.route}</p>
        </div>

        {/* systems health */}
        <div className="absolute bottom-4 left-4 rounded-xl border border-slate-800 bg-[#0d1219]/85 p-3 backdrop-blur">
          <div className="flex items-center justify-between gap-6">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Systems</p>
            <p className="text-[9px] font-bold text-slate-400">{systems.filter((s) => s.ok).length}/{systems.length || 5} green</p>
          </div>
          <div className="mt-2 space-y-1">
            {systems.map((s) => (
              <div key={s.id} className="flex items-center gap-2" title={s.detail}>
                <span className={`h-1.5 w-1.5 rounded-full ${s.ok ? "bg-emerald-400" : "bg-amber-400"}`} />
                <span className="text-[10px] text-slate-300">{s.name}</span>
              </div>
            ))}
            {systems.length === 0 && <span className="text-[10px] text-slate-500">Probing…</span>}
          </div>
        </div>

        {/* collective learning bus */}
        <div className="absolute bottom-4 right-4 w-[300px] rounded-xl border border-slate-800 bg-[#0d1219]/85 p-3 backdrop-blur">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Collective memory</p>
            <p className="text-[9px] font-bold text-slate-400">{knowledge.length} shared</p>
          </div>
          <p className="mt-1 text-[9px] text-slate-500">What agents have learned and broadcast to each other.</p>
          <div className="mt-2 max-h-44 space-y-1.5 overflow-y-auto">
            {knowledge.length === 0 && <span className="text-[10px] text-slate-500">No shared learnings yet.</span>}
            {knowledge.map((k) => {
              const learned = k.kind === "outcome";
              return (
                <div key={k.id} className={`rounded-lg border p-2 ${learned ? "border-[#dff54a]/30 bg-[#dff54a]/[0.06]" : "border-slate-800 bg-slate-900/40"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-bold ${learned ? "text-[#dff54a]" : "text-emerald-300"}`}>{k.agent} → {k.audience}</span>
                    <span className={`text-[8px] uppercase tracking-wider ${learned ? "text-[#dff54a]/70" : "text-slate-500"}`}>{learned ? "↩ learned" : k.kind.replaceAll("_", " ")}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] font-semibold text-slate-200">{k.topic}</p>
                  <p className="mt-0.5 text-[9px] leading-relaxed text-slate-400">{k.insight}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* DRAWER */}
      {selected && (
        <AgentDrawer
          place={selected}
          ready={ready(selected)}
          connector={selected.connector ? connectorMap[selected.connector] : undefined}
          brief={brief}
          relay={relay}
          relayMsg={relayMsg}
          history={history}
          onRelayBrief={relayBrief}
          onClose={() => { setSelectedId(null); setRelayMsg(""); }}
          authed={Boolean(user)}
        />
      )}
    </main>
  );
}

function Hud({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="text-right">
      <p className="text-[8px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`font-mono text-sm font-bold ${accent ? "text-[#dff54a]" : "text-slate-100"}`}>{value}</p>
    </div>
  );
}

function AgentDrawer({ place, ready, connector, brief, relay, relayMsg, history, onRelayBrief, onClose, authed }: {
  place: Place; ready: boolean; connector?: { status: string; nextStep: string; detail: string };
  brief: HermesIntelligence["brief"]; relay: RelayStatus; relayMsg: string;
  history: HermesHistoryEntry[]; onRelayBrief: () => void; onClose: () => void; authed: boolean;
}) {
  const playbook = agentPlaybooks[place.id];
  const benchmark = benchmarkFor(place.id);
  const route = brief.agentRoutes.find((r) => r.agent.toLowerCase() === place.name.toLowerCase());
  const Icon = place.icon;
  return (
    <aside className="fixed right-0 top-0 z-30 h-full w-[380px] overflow-y-auto border-l border-slate-800 bg-[#0c1118]/95 p-5 backdrop-blur-xl">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`grid h-11 w-11 place-items-center rounded-xl ${place.kind === "core" ? "bg-[#dff54a] text-[#0a0e14]" : "bg-slate-800 text-slate-100"}`}><Icon size={20} /></div>
          <div><p className="text-sm font-bold">{place.name}</p><p className="text-[11px] text-slate-400">{place.role}</p></div>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-700 hover:bg-slate-800"><X size={14} /></button>
      </div>

      <Row icon={MapPin} label="Place" value={place.place} />
      <Row label="Objective" value={place.objective} />
      <Row label="Status" value={ready ? "Live" : connector ? connector.status.replaceAll("_", " ") : "Offline"} />
      {connector && !ready && <p className="mt-1 text-[10px] font-medium text-amber-300/80">{connector.nextStep}</p>}
      {route && <Row label="Hermes directive" value={`[${route.priority}] ${route.directive}`} />}

      {playbook && (
        <div className="mt-5">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Operational loop</p>
          <div className="mt-2 space-y-1.5">
            {playbook.loop.map((s, i) => (
              <div key={s.phase} className="rounded-lg border border-slate-800 bg-slate-900/40 p-2">
                <div className="flex items-center justify-between"><p className="text-[11px] font-semibold">{i + 1}. {s.phase}</p><span className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase ${s.autonomy === "autonomous" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>{s.autonomy === "autonomous" ? "auto" : "gated"}</span></div>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{s.action}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {benchmark && (
        <div className="mt-5 rounded-xl border border-[#dff54a]/20 bg-[#dff54a]/[0.04] p-3">
          <p className="text-[9px] font-bold uppercase tracking-wider text-[#dff54a]/80">Emulating the top performers · {benchmark.field}</p>
          <ul className="mt-2 space-y-1">
            {benchmark.top.map((t, i) => <li key={i} className="text-[10px] leading-relaxed text-slate-300">• {t}</li>)}
          </ul>
          <p className="mt-2 text-[9px] text-slate-500">Metrics to beat: {benchmark.beat}</p>
        </div>
      )}
      {place.id === "creative" && <CreativePanel authed={authed} />}
      {place.id === "commerce" && <DomainPanel />}
      {place.id === "delivery" && <DrivePanel authed={authed} />}
      {place.id === "finance" && <TreasuryPanel authed={authed} />}
      {place.id === "research" && <ProspectsPanel authed={authed} />}
      {place.connector && <JobsPanel agentName={place.name} authed={authed} />}
      {place.id === "hermes" && (
        <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Reasoning</p>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-300">{brief.reasoning}</p>
          <button onClick={onRelayBrief} disabled={!relay.connected} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#dff54a] px-3 py-2 text-[10px] font-bold text-[#0a0e14] disabled:opacity-40"><Send size={12} />Email brief to operator</button>
          {relayMsg && <p className="mt-2 text-[10px] text-slate-400">{relayMsg}</p>}
          {history.length > 0 && (
            <div className="mt-4">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Memory ({history.length})</p>
              <div className="mt-2 space-y-1.5">
                {history.map((h, i) => {
                  const prev = history[i + 1];
                  const delta = prev ? h.intelligenceScore - prev.intelligenceScore : 0;
                  return (
                    <div key={h.createdAt} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/30 px-2 py-1.5">
                      <span className="truncate text-[10px] text-slate-300">{h.mood}</span>
                      <span className="shrink-0 font-mono text-[10px] font-bold text-slate-200">{h.intelligenceScore}{delta !== 0 && <span className={delta > 0 ? "text-emerald-400" : "text-amber-400"}> {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</span>}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {place.id === "relay" && (
        <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Relay status · {relay.channel}</p>
          <p className={`mt-1 text-xs font-bold ${relay.connected ? "text-emerald-300" : "text-amber-300"}`}>{relay.connected ? "Live" : "Offline"}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{relay.detail}</p>
          <button onClick={onRelayBrief} disabled={!relay.connected || !authed} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#dff54a] px-3 py-2 text-[10px] font-bold text-[#0a0e14] disabled:opacity-40"><Send size={12} />{authed ? "Email the latest brief" : "Sign in to relay"}</button>
          {relayMsg && <p className="mt-2 text-[10px] text-slate-400">{relayMsg}</p>}
        </div>
      )}
    </aside>
  );
}

function TreasuryPanel({ authed }: { authed: boolean }) {
  const [t, setT] = useState<Treasury | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!authed) return;
    loadTreasury().then((r) => { if ("error" in r) setErr(r.error); else setT(r); });
  }, [authed]);
  const usd = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <div className="mt-5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Treasury · your money</p>
      {!authed && <p className="mt-2 text-[10px] text-slate-500">Sign in to view the balance.</p>}
      {err && <p className="mt-2 text-[10px] text-amber-300/80">{err}</p>}
      {t && (
        <>
          <div className="mt-2 rounded-xl border border-[#dff54a]/30 bg-[#dff54a]/[0.06] p-3">
            <p className="text-[9px] uppercase tracking-wider text-slate-500">Real sales · Shopify (any gateway)</p>
            <p className="text-2xl font-bold text-[#dff54a]">{usd(t.sales.grossCents)}</p>
            <p className="text-[9px] text-slate-400">{t.sales.count} paid order{t.sales.count === 1 ? "" : "s"} · real revenue, gateway-agnostic</p>
          </div>
          <p className="mt-3 text-[9px] font-bold uppercase tracking-wider text-slate-500">Stripe balance ({t.mode})</p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-2.5">
              <p className="text-[9px] uppercase tracking-wider text-slate-500">Available</p>
              <p className="text-lg font-bold text-emerald-300">{usd(t.availableCents)}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
              <p className="text-[9px] uppercase tracking-wider text-slate-500">Pending</p>
              <p className="text-lg font-bold text-slate-200">{usd(t.pendingCents)}</p>
            </div>
          </div>
          <p className="mt-1 text-[9px] text-slate-500">{t.mode === "test" ? "Sandbox" : "Live"} · {t.note}</p>
          {t.payouts.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Recent payouts</p>
              {t.payouts.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-2 py-1.5">
                  <span className="text-[10px] text-slate-300">{usd(p.amountCents)}</span>
                  <span className="text-[8px] uppercase tracking-wider text-slate-500">{p.status}</span>
                </div>
              ))}
            </div>
          )}
          <a href={t.withdrawUrl} target="_blank" rel="noopener noreferrer" className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#dff54a] px-3 py-2 text-[10px] font-bold text-[#0a0e14]"><WalletCards size={12} />Withdraw to bank (Stripe)</a>
          <p className="mt-1.5 text-[9px] text-slate-500">Withdrawals happen in your Stripe dashboard — the agents never move your money.</p>

          {/* Cash App payout helper */}
          <div className="mt-4 rounded-xl border border-[#00d54b]/30 bg-[#00d54b]/[0.06] p-3">
            <p className="text-[9px] font-bold uppercase tracking-wider text-[#00d54b]">Send earnings to Cash App · $JayOWilliams</p>
            <div className="mt-1.5 flex items-center gap-2 text-[10px]">
              <span className={`h-2 w-2 rounded-full ${t.hasPayoutDestination ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className="text-slate-300">{t.hasPayoutDestination ? `Payout bank linked (•••• ${t.payoutDestinations[0]?.last4})` : "No payout bank linked yet"}</span>
            </div>
            {t.mode === "test" && <p className="mt-1.5 text-[9px] leading-relaxed text-amber-300/80">Stripe is in test mode — this balance isn't real and can't pay out. Activate live mode + make a real sale first.</p>}
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-[9px] leading-relaxed text-slate-400">
              <li>In Cash App → <span className="text-slate-300">Money → Direct deposit</span> → copy your routing + account number.</li>
              <li>In Stripe payouts (below), add that as your bank account.</li>
              <li>Turn on <span className="text-slate-300">automatic payouts</span> — every real sale then auto-lands in Cash App.</li>
            </ol>
            <a href={t.payoutSetupUrl} target="_blank" rel="noopener noreferrer" className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#00d54b]/50 px-3 py-2 text-[10px] font-bold text-[#00d54b]"><WalletCards size={12} />Open Stripe payout settings</a>
            <p className="mt-1.5 text-[9px] text-slate-500">You enter the account details — I never touch your banking info or move funds.</p>
          </div>
        </>
      )}
    </div>
  );
}

function DrivePanel({ authed }: { authed: boolean }) {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { if (authed) loadGoogleDriveStatus().then(setStatus); }, [authed]);
  const connect = async () => {
    setBusy(true); setMsg("");
    const r = await startGoogleDriveConnect();
    if ("error" in r) { setMsg(r.error); setBusy(false); return; }
    setMsg("Opening Google consent — approve there, then return.");
    window.open(r.url, "_blank", "noopener,noreferrer");
    setBusy(false);
  };
  return (
    <div className="mt-5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Google Drive fulfillment</p>
      <p className="mt-1 text-[9px] text-slate-500">Where approved deliverables and fulfillment evidence are stored.</p>
      {!authed && <p className="mt-2 text-[10px] text-slate-500">Sign in to connect Drive.</p>}
      {authed && (
        <>
          <div className="mt-2 flex items-center gap-2 text-[10px]">
            <span className={`h-2 w-2 rounded-full ${status?.connected ? "bg-emerald-400" : status?.configured ? "bg-amber-400" : "bg-slate-600"}`} />
            <span className="text-slate-300">{status?.connected ? "Drive connected" : status?.configured ? "Provider ready — your Drive isn't linked yet" : "Provider not configured"}</span>
          </div>
          <button onClick={connect} disabled={busy || !status?.configured} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#dff54a] px-3 py-2 text-[10px] font-bold text-[#0a0e14] disabled:opacity-40">{busy ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}{status?.connected ? "Reconnect Google Drive" : "Connect Google Drive"}</button>
          {msg && <p className="mt-2 text-[10px] text-slate-400">{msg}</p>}
        </>
      )}
    </div>
  );
}

function DomainPanel() {
  const [seed, setSeed] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DomainCheck | null>(null);
  const [err, setErr] = useState("");
  const run = async () => {
    if (!seed.trim()) return;
    setLoading(true); setErr(""); setResult(null);
    const r = await findBrandDomains(seed.trim());
    if ("error" in r) setErr(r.error); else setResult(r);
    setLoading(false);
  };
  const tone = (s: string) => s === "available" ? "text-emerald-300" : s === "taken" ? "text-rose-300" : "text-slate-500";
  return (
    <div className="mt-5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Brand domain finder</p>
      <p className="mt-1 text-[9px] text-slate-500">Real RDAP availability for a brand seed — pick the .com before you build the store.</p>
      <div className="mt-2 flex gap-2">
        <input value={seed} onChange={(e) => setSeed(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="e.g. pawsomegroom" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-1.5 text-[11px] text-slate-100 placeholder:text-slate-600 focus:border-[#dff54a]/50 focus:outline-none" />
        <button onClick={run} disabled={loading || !seed.trim()} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#dff54a] px-3 py-1.5 text-[10px] font-bold text-[#0a0e14] disabled:opacity-40">{loading ? <RefreshCw size={11} className="animate-spin" /> : <Search size={11} />}{loading ? "Checking" : "Check"}</button>
      </div>
      {err && <p className="mt-2 text-[10px] text-rose-300/80">{err}</p>}
      {result && (
        <div className="mt-3">
          {result.recommendation && <p className="mb-2 text-[10px] text-slate-300">Recommended: <span className="font-bold text-emerald-300">{result.recommendation}</span></p>}
          <div className="space-y-1">
            {result.results.map((r) => (
              <div key={r.domain} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-2.5 py-1.5">
                <span className="font-mono text-[11px] text-slate-200">{r.domain}</span>
                <span className={`text-[9px] font-bold uppercase tracking-wider ${tone(r.status)}`}>{r.status}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[9px] text-slate-500">Registering a domain is operator-gated — these are read-only lookups.</p>
        </div>
      )}
    </div>
  );
}

function CreativePanel({ authed }: { authed: boolean }) {
  const [running, setRunning] = useState(false);
  const [packages, setPackages] = useState<CreativePackageRecord[]>([]);
  const [msg, setMsg] = useState("");
  const [deciding, setDeciding] = useState<string | null>(null);
  const reload = useCallback(async () => setPackages(await loadCreativePackages()), []);
  useEffect(() => { reload(); }, [reload]);
  const run = async () => { setRunning(true); setMsg(""); const r = await runCreativeCycle({ discoverTags: ["#ai", "#summergarden", "#lofi"] }); setMsg(r.message); await reload(); setRunning(false); };
  const decide = async (id: string, status: "approved" | "rejected") => { setDeciding(id); const r = await decideCreativePackage(id, status); setMsg(r.message); await reload(); setDeciding(null); };
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Signal Studio</p>
        <button onClick={run} disabled={running} className="flex items-center gap-1.5 rounded-lg bg-[#dff54a] px-3 py-1.5 text-[10px] font-bold text-[#0a0e14] disabled:opacity-40">{running ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}{running ? "Preparing" : "Run cycle"}</button>
      </div>
      {!authed && <p className="mt-2 text-[10px] text-slate-500">Sign in to prepare and approve packages.</p>}
      {msg && <p className="mt-2 text-[10px] text-amber-300/80">{msg}</p>}
      {packages.length === 0 && authed && <p className="mt-2 text-[10px] text-slate-500">No packages yet. Run a cycle.</p>}
      <div className="mt-3 space-y-2">
        {packages.map((p) => (
          <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-bold">{p.title}</p><span className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase ${p.status === "approved" ? "bg-emerald-500/15 text-emerald-300" : p.status === "rejected" ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-300"}`}>{p.status.replaceAll("_", " ")}</span></div>
            {p.visual.assetUrl && <img src={p.visual.assetUrl} alt={p.title} className="mt-2 aspect-square w-full rounded-lg border border-slate-800 object-cover" loading="lazy" />}
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{p.caption}</p>
            {p.track.assetUrl && <audio controls src={p.track.assetUrl} className="mt-2 h-8 w-full" />}
            {p.pendingProviders.length > 0 && <p className="mt-1 text-[9px] text-amber-300/70">pending: {p.pendingProviders.join(", ")}</p>}
            {p.status === "awaiting_approval" && (
              <div className="mt-2 flex justify-end gap-2">
                <button onClick={() => decide(p.id, "rejected")} disabled={deciding === p.id} className="flex h-7 items-center gap-1 rounded-lg border border-slate-700 px-2 text-[10px] font-bold text-rose-300 disabled:opacity-40"><X size={11} />Reject</button>
                <button onClick={() => decide(p.id, "approved")} disabled={deciding === p.id} className="flex h-7 items-center gap-1 rounded-lg bg-[#dff54a] px-2 text-[10px] font-bold text-[#0a0e14] disabled:opacity-40">{deciding === p.id ? <RefreshCw size={11} className="animate-spin" /> : <Check size={11} />}Approve</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProspectsPanel({ authed }: { authed: boolean }) {
  const [prospects, setProspects] = useState<ProspectRecord[]>([]);
  useEffect(() => { loadProspects().then(setProspects); }, []);
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between"><p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Qualified prospects</p><span className="text-[9px] font-bold text-slate-400">{prospects.length}</span></div>
      {!authed && <p className="mt-2 text-[10px] text-slate-500">Sign in to see Maya's prospects.</p>}
      {authed && prospects.length === 0 && <p className="mt-2 text-[10px] text-slate-500">No prospects yet. Maya pulls from OpenStreetMap (free, no plan limit).</p>}
      <div className="mt-3 space-y-2">
        {prospects.map((p) => (
          <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold">{p.businessName}</p>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-emerald-300">{p.status}</span>
            </div>
            {p.website && <a href={p.website} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-[10px] text-sky-300 hover:underline">{p.website}</a>}
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{p.problemEvidence}</p>
            <p className="mt-1 text-[9px] text-slate-500">source: {p.source}{p.contactRoute ? ` · ${p.contactRoute}` : ""}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function JobsPanel({ agentName, authed }: { agentName: string; authed: boolean }) {
  const [jobs, setJobs] = useState<AutomationJob[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const reload = useCallback(async () => setJobs((await loadAutomationJobs()).filter((j) => j.agent.toLowerCase() === agentName.toLowerCase())), [agentName]);
  useEffect(() => { reload(); }, [reload]);
  const decide = async (id: string, d: "approved" | "rejected") => { setBusy(id); const r = await decideAutomationJob(id, d); setMsg(r.message); await reload(); setBusy(null); };
  const badge = (s: string) => s === "succeeded" ? "bg-emerald-500/15 text-emerald-300" : s === "failed" || s === "cancelled" ? "bg-rose-500/15 text-rose-300" : s === "awaiting_approval" ? "bg-amber-500/15 text-amber-300" : "bg-slate-500/15 text-slate-300";
  return (
    <div className="mt-5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Jobs &amp; approvals</p>
      {!authed && <p className="mt-2 text-[10px] text-slate-500">Sign in to see this agent's queued work.</p>}
      {authed && jobs.length === 0 && <p className="mt-2 text-[10px] text-slate-500">No jobs yet. Arm Autopilot to plan work.</p>}
      {msg && <p className="mt-2 text-[10px] text-amber-300/80">{msg}</p>}
      <div className="mt-3 space-y-2">
        {jobs.map((j) => (
          <div key={j.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-semibold">{j.actionType.replaceAll("_", " ")}</p><span className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase ${badge(j.status)}`}>{j.status.replaceAll("_", " ")}</span></div>
            {j.directive && <p className="mt-1 text-[10px] leading-relaxed text-slate-400">Hermes: {j.directive}</p>}
            {j.note && <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{j.note}</p>}
            {j.lastError && <p className="mt-1 text-[9px] text-rose-300/70">{j.lastError}</p>}
            {j.status === "awaiting_approval" && (
              <div className="mt-2 flex justify-end gap-2">
                <button onClick={() => decide(j.id, "rejected")} disabled={busy === j.id} className="flex h-7 items-center gap-1 rounded-lg border border-slate-700 px-2 text-[10px] font-bold text-rose-300 disabled:opacity-40"><X size={11} />Reject</button>
                <button onClick={() => decide(j.id, "approved")} disabled={busy === j.id} className="flex h-7 items-center gap-1 rounded-lg bg-[#dff54a] px-2 text-[10px] font-bold text-[#0a0e14] disabled:opacity-40">{busy === j.id ? <RefreshCw size={11} className="animate-spin" /> : <Check size={11} />}Approve</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon?: typeof BrainCircuit; label: string; value: string }) {
  return (
    <div className="mt-4 border-t border-slate-800 pt-3">
      <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">{Icon && <Icon size={10} />}{label}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{value}</p>
    </div>
  );
}
