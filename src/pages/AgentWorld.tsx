import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  Check,
  CircleDollarSign,
  Database,
  FileCheck2,
  Mail,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingBag,
  Users,
  WalletCards,
  X,
  Power,
  LogIn,
  Music2,
  Video,
  Building2,
  MapPin,
  ShieldCheck,
  Clock3,
  Sparkles,
} from "lucide-react";
import {
  executeBusinessAction,
  getInitialConnectors,
  loadAutomationSummary,
  loadHermesBrief,
  loadHermesHistory,
  loadRevenueSummary,
  type HermesHistoryEntry,
  probeBusinessConnectors,
  runCreativeCycle,
  setAutomationEnabled,
  type AutomationSummary,
  type BusinessAction,
  type ConnectorId,
  type CreativePackage,
  type HermesIntelligence,
  type RevenueSummary,
} from "@/lib/businessOps";
import { agentPlaybooks } from "@/lib/agentPlaybooks";
import { buildHermesWorldState, computeFallbackBrief } from "@/lib/hermesBrief";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";

type Agent = {
  id: string;
  name: string;
  role: string;
  objective: string;
  deliverable: string;
  connector: ConnectorId | "intelligence" | "creative";
  icon: typeof Bot;
  body: string;
  place: string;
  cadence: string;
  subagents: string[];
};

const agents: Agent[] = [
  { id: "hermes", name: "Hermes", role: "World intelligence agent", objective: "Turn live system state into clear decisions and better display", deliverable: "Operating brief, bottleneck, and route map", connector: "intelligence", icon: BrainCircuit, body: "Navigator with a world console, signal map, and command lens", place: "Intelligence Atrium", cadence: "Continuously reads the control plane", subagents: ["Signal interpreter", "UI cartographer", "Bottleneck router"] },
  { id: "creative", name: "Aria", role: "Creative Director & DJ", objective: "Turn live cultural trends into release-ready track, visual, and caption packages", deliverable: "Approval-ready upload package with caption and evidence", connector: "creative", icon: Music2, body: "Creative Director at a 24/7 studio console with trend radar and generation bays", place: "Signal Studio", cadence: "24/7 preparation loop; posting stays operator-approved", subagents: ["Trend scout", "Music generator", "Visual editor", "Caption/SEO writer", "Upload packager"] },
  { id: "research", name: "Maya", role: "Research agent", objective: "Find businesses with a measurable, expensive problem", deliverable: "Qualified prospect record with evidence", connector: "crm", icon: Search, body: "Field researcher with CRM tablet and evidence camera", place: "Prospect Observatory", cadence: "Every 4 hours while Autopilot is armed", subagents: ["Apollo scout", "HubSpot librarian", "Fit scorer"] },
  { id: "sales", name: "Marcus", role: "Sales agent", objective: "Turn qualified prospects into booked calls and signed offers", deliverable: "Reply, booking, or signed agreement", connector: "outreach", icon: Mail, body: "SDR operator at a live outreach desk", place: "Outbound Office", cadence: "Drafts continuously; sends only after approval", subagents: ["Lead analyst", "Message drafter", "Senior closer"] },
  { id: "product", name: "Lena", role: "Product agent", objective: "Create and publish offers people can purchase immediately", deliverable: "Live offer, checkout, and delivery flow", connector: "storefront", icon: ShoppingBag, body: "Offer architect with product bench and checkout terminal", place: "Storefront Studio", cadence: "Creates drafts on demand; publish remains gated", subagents: ["Offer packager", "Pricing reviewer", "Listing QA"] },
  { id: "delivery", name: "Dev", role: "Fulfillment agent", objective: "Complete paid work and preserve gross margin", deliverable: "Delivery evidence and customer acceptance", connector: "fulfillment", icon: PackageCheck, body: "Fulfillment builder with Drive workbench", place: "Delivery Workshop", cadence: "Runs after verified payment and accepted scope", subagents: ["File builder", "Acceptance checker", "Margin guard"] },
  { id: "finance", name: "Ledger", role: "Finance agent", objective: "Reconcile every dollar and reject unverified revenue", deliverable: "Verified payment, fee, refund, and payout records", connector: "payments", icon: WalletCards, body: "Finance clerk with payment ledger and audit stamp", place: "Revenue Vault", cadence: "Listens for provider receipts only", subagents: ["Stripe reconciler", "Refund watcher", "Payout auditor"] },
];

const actionsSeed: BusinessAction[] = [
  { id: "sync-crm-prospects", agent: "Maya", title: "Sync first qualified prospects", detail: "Pull up to 5 licensed Apollo matches and create HubSpot CRM records for review.", connector: "crm", payload: { keywords: "home services contractors follow up", limit: 5 } },
  { id: "launch-outreach", agent: "Marcus", title: "Launch first outbound test", detail: "Send 12 approved messages to qualified local-service prospects.", connector: "outreach", payload: { campaign: "first-12", maxRecipients: 12 } },
  { id: "publish-product", agent: "Lena", title: "Publish Contractor Follow-Up Kit", detail: "Create the live $29 listing, checkout, and automated delivery.", connector: "storefront", payload: { sku: "contractor-follow-up-kit", priceUsd: 29 } },
  { id: "enable-revenue", agent: "Ledger", title: "Enable verified revenue ledger", detail: "Ingest completed payments, refunds, fees, and payouts.", connector: "payments", payload: { eventTypes: ["payment.succeeded", "charge.refunded", "payout.paid"] } },
];

const stack = [
  { title: "Agent brain", provider: "OpenAI API", detail: "Reasoning, tool use, structured decisions", icon: BrainCircuit, required: true },
  { title: "System of record", provider: "Supabase", detail: "Agents, jobs, approvals, evidence, audit log", icon: Database, required: true },
  { title: "Revenue truth", provider: "Stripe", detail: "Checkout, payments, refunds, fees, payouts", icon: CircleDollarSign, required: true },
  { title: "Customer acquisition", provider: "Apollo + HubSpot + Resend", detail: "Prospects, CRM state, approved outbound", icon: Users, required: true },
  { title: "Offer delivery", provider: "Shopify or Lemon Squeezy + Drive", detail: "Storefront, files, and fulfillment", icon: FileCheck2, required: false },
];

const worldDistricts = [
  {
    title: "Hermes Intelligence Atrium",
    icon: BrainCircuit,
    body: "World navigator with a live command lens",
    place: "Intelligence Atrium",
    loop: "Probe stack -> read jobs -> name bottleneck -> route agents -> improve display",
    cadence: "Every refresh and every Autopilot cycle",
    tools: "Supabase control plane, connector probes, revenue ledger, approval queue",
    guardrail: "Hermes recommends and routes. It does not send, publish, spend, or change account security.",
  },
  {
    title: "Creative Label",
    icon: Music2,
    body: "Autonomous AI Creative Director and DJ with a studio console",
    place: "Signal Studio",
    loop: "Trend scan -> track concept -> visual brief -> upload package -> approval",
    cadence: "24/7 preparation loop; external posting requires operator approval",
    tools: "TikTok trend watch, music generation slot, visual editor slot, Drive evidence",
    guardrail: "No blind upload loop. Community guidelines, account health, copyright checks, and human approval come before posting.",
  },
  {
    title: "Proactive SDR Office",
    icon: Building2,
    body: "Business development team with browser workstations",
    place: "Open Office for Agents",
    loop: "Lead search -> budget analysis -> personalized draft -> CRM sync -> approved outreach",
    cadence: "Every 4 hours while Autopilot is armed",
    tools: "Apollo, HubSpot, Resend, browser wrapper slot, senior closer escalation",
    guardrail: "No LinkedIn or web messaging is sent without approval and provider-compliant limits.",
  },
];

const operatingRules = [
  "Use an OpenClaw-compatible browser wrapper only as the physical interaction layer when an approved provider API is unavailable.",
  "Create subagents for research, scoring, drafting, QA, upload preparation, and closing instead of one overloaded prompt.",
  "If a preparation step fails, log the error, restart from the previous safe preparation phase, and do not execute external side effects.",
  "Posting, messaging, spending, contracts, refunds, account security changes, and OAuth consent stay approval-gated.",
];

export default function AgentWorld() {
  const { user, signOut } = useAuth();
  const [connectors, setConnectors] = useState(getInitialConnectors);
  const [revenue, setRevenue] = useState<RevenueSummary>({ netRevenueCents: 0, verifiedCustomers: 0, verifiedEvents: 0, available: false });
  const [automation, setAutomation] = useState<AutomationSummary>({ authenticated: false, workerReady: false, plannerReady: false, enabled: false, paused: false, allowCrmSync: false, allowDraftProducts: false, activeJobs: 0, awaitingApproval: 0, succeededJobs: 0, failedJobs: 0 });
  const [automationMessage, setAutomationMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const connectorMap = useMemo(() => Object.fromEntries(connectors.map((item) => [item.id, item])), [connectors]);
  const [selectedId, setSelectedId] = useState("research");
  const [actions, setActions] = useState(actionsSeed);
  const [states, setStates] = useState<Record<string, "executing" | "sent" | "blocked">>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];
  const connected = connectors.filter((connector) => connector.status === "ready").length;
  const nextBlocker = connectors.find((connector) => connector.status !== "ready");
  const readiness = Math.round((connected / connectors.length) * 100);
  const agentReady = useCallback((agent: Agent) => agent.connector === "intelligence" || agent.connector === "creative" || connectorMap[agent.connector]?.status === "ready", [connectorMap]);
  const blockedAgentCount = agents.filter((agent) => !agentReady(agent)).length;
  const readyConnectors = useMemo(() => connectors.filter((connector) => connector.status === "ready").map((connector) => connector.name), [connectors]);
  const fallbackBrief = useMemo(() => computeFallbackBrief(connectors, revenue, automation), [connectors, revenue, automation]);
  const [hermes, setHermes] = useState<HermesIntelligence | null>(null);
  const [hermesThinking, setHermesThinking] = useState(false);
  const [hermesHistory, setHermesHistory] = useState<HermesHistoryEntry[]>([]);
  const hermesBrief = hermes?.brief ?? fallbackBrief;
  const hermesLive = hermes?.source === "hermes-4";

  const refreshControlPlane = useCallback(async () => {
    setRefreshing(true);
    const [nextConnectors, nextRevenue, nextAutomation] = await Promise.all([probeBusinessConnectors(), loadRevenueSummary(), loadAutomationSummary()]);
    setConnectors(nextConnectors);
    setRevenue(nextRevenue);
    setAutomation(nextAutomation);
    setRefreshing(false);

    // Let Hermes-4 reason over the freshly probed world. Falls back silently to
    // the deterministic read if the function is undeployed or the model errors.
    setHermesThinking(true);
    const fallback = computeFallbackBrief(nextConnectors, nextRevenue, nextAutomation);
    const worldState = buildHermesWorldState(agents, nextConnectors, nextRevenue, nextAutomation);
    const intelligence = await loadHermesBrief(worldState, fallback);
    setHermes(intelligence);
    setHermesThinking(false);
    setHermesHistory(await loadHermesHistory());
  }, []);

  useEffect(() => {
    refreshControlPlane();
    const timer = window.setInterval(refreshControlPlane, 60_000);
    return () => window.clearInterval(timer);
  }, [refreshControlPlane]);

  const runAction = async (action: BusinessAction) => {
    setStates((current) => ({ ...current, [action.id]: "executing" }));
    const result = await executeBusinessAction(action, connectors);
    setStates((current) => ({ ...current, [action.id]: result.ok ? "sent" : "blocked" }));
    setMessages((current) => ({ ...current, [action.id]: result.message }));
  };

  const toggleAutomation = async () => {
    const result = await setAutomationEnabled(!automation.enabled);
    setAutomationMessage(result.message);
    await refreshControlPlane();
  };

  const [creativeRunning, setCreativeRunning] = useState(false);
  const [creativePackage, setCreativePackage] = useState<CreativePackage | null>(null);
  const [creativePending, setCreativePending] = useState<string[]>([]);
  const [creativeMessage, setCreativeMessage] = useState("");
  const runCreative = async () => {
    setCreativeRunning(true);
    setCreativeMessage("");
    const result = await runCreativeCycle({ discoverTags: ["#ai", "#summergarden", "#lofi"] });
    setCreativeMessage(result.message);
    if (result.ok && result.pkg) {
      setCreativePackage(result.pkg);
      setCreativePending(result.pendingProviders ?? []);
    }
    setCreativeRunning(false);
  };

  return (
    <main className="min-h-screen bg-[#f3f1eb] text-[#18201d]">
      <header className="border-b border-[#d8d5cc] bg-[#faf9f5]">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#18201d] text-[#dff54a]"><Bot size={20} /></div>
            <div><h1 className="text-base font-bold tracking-tight">Operator OS</h1><p className="text-xs text-[#68716d]">Live business execution for AI agents</p></div>
          </div>
          <div className="flex items-center gap-3">
            <StatusDot label={`${connected}/5 live`} ok={connected === 5} />
            {user ? <button onClick={signOut} className="text-[10px] font-bold text-[#68716d] hover:text-[#18201d]">Sign out</button> : <Link to="/auth" className="flex items-center gap-1.5 text-[10px] font-bold text-[#68716d] hover:text-[#18201d]"><LogIn size={12} />Operator sign in</Link>}
            <button onClick={refreshControlPlane} disabled={refreshing} className="flex items-center gap-2 rounded-lg bg-[#18201d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2b3531] disabled:opacity-50"><RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />Probe stack</button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-5 px-5 py-6 lg:grid-cols-[230px_minmax(0,1fr)_370px] lg:px-8">
        <aside className="space-y-5">
          <section>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#8a928e]">Agents</p>
            <div className="space-y-1.5">
              {agents.map((agent) => {
                const Icon = agent.icon;
                const ready = agentReady(agent);
                return (
                  <button key={agent.id} onClick={() => setSelectedId(agent.id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${selected.id === agent.id ? "bg-white shadow-sm ring-1 ring-[#d8d5cc]" : "hover:bg-white/60"}`}>
                    <div className="grid h-8 w-8 place-items-center rounded-md bg-[#e6e4dc]"><Icon size={15} /></div>
                    <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{agent.name}</p><p className="truncate text-[10px] text-[#7b847f]">{agent.role}</p></div>
                    <span className={`h-2 w-2 rounded-full ${ready ? "bg-[#57a66a]" : "bg-[#d18863]"}`} />
                  </button>
                );
              })}
            </div>
          </section>
          <section className="rounded-xl border border-[#d8d5cc] bg-[#faf9f5] p-4">
            <div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8a928e]">Hermes</p><StatusDot label={hermesThinking ? "thinking" : hermesLive ? "Hermes-4 live" : "heuristic"} ok={hermesLive} /></div>
            <p className="mt-2 text-xs font-semibold">{hermesBrief.mood}</p>
            <p className="mt-2 text-[10px] leading-relaxed text-[#68716d]">Bottleneck: {hermesBrief.bottleneck}. {hermesBrief.route}</p>
            {hermesLive && hermes?.model && <p className="mt-2 text-[9px] font-bold uppercase tracking-wider text-[#8a928e]">{hermes.model.split("/").pop()} · memory {hermes.memoryDepth ?? 0}</p>}
          </section>
          <section className="rounded-xl border border-[#d8d5cc] bg-[#faf9f5] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8a928e]">Control policy</p>
            <p className="mt-2 text-xs font-semibold">Agents can run safe loops. You approve risky execution.</p>
            <p className="mt-2 text-[11px] leading-relaxed text-[#68716d]">CRM sync and Shopify draft creation can run automatically. Sending, publishing, spending, contracts, and refunds still require approval and receipts.</p>
          </section>
          <section className="rounded-xl border border-[#d8d5cc] bg-[#faf9f5] p-4">
            <div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8a928e]">Autopilot</p><span className={`h-2 w-2 rounded-full ${automation.enabled && automation.workerReady && automation.plannerReady ? "bg-[#57a66a]" : "bg-[#d18863]"}`} /></div>
            <p className="mt-2 text-xs font-semibold">{automation.enabled ? "Armed with policy limits" : "Disabled"}</p>
            <p className="mt-2 text-[10px] leading-relaxed text-[#68716d]">{!automation.authenticated ? "Operator sign-in required." : !automation.plannerReady ? "Planner needs worker and Supabase secrets." : !automation.workerReady ? "Worker deployed; add its scheduler secret." : "Planner creates work, worker executes safe jobs, risky jobs wait in approval."}</p>
            {automation.lastPlannedAt && <p className="mt-2 text-[9px] font-bold uppercase tracking-wider text-[#8a928e]">Last planned {new Date(automation.lastPlannedAt).toLocaleString()}</p>}
            {automationMessage && <p className="mt-2 text-[10px] font-medium text-[#9a6044]">{automationMessage}</p>}
            <button onClick={toggleAutomation} disabled={!automation.authenticated} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#18201d] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-40"><Power size={12} />{automation.enabled ? "Disable autopilot" : "Arm autopilot"}</button>
          </section>
        </aside>

        <div className="space-y-5">
          <section className="rounded-2xl border border-[#d8d5cc] bg-[#18201d] p-6 text-white">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#dff54a]">Hermes operating objective</p><h2 className="mt-3 max-w-2xl text-2xl font-semibold leading-tight">See the whole world clearly, route every agent, and turn the next bottleneck into money movement.</h2><p className="mt-2 text-sm text-white/55">{nextBlocker ? `Highest-leverage blocker: ${nextBlocker.name}. ${nextBlocker.nextStep}` : "All core channels are live. Hermes is routing the first customer-to-cash cycle through approvals and receipts."}</p></div>
              <div className="grid grid-cols-4 gap-2">
                <DarkMetric label="Revenue" value={`$${(revenue.netRevenueCents / 100).toFixed(2)}`} />
                <DarkMetric label="Customers" value={`${revenue.verifiedCustomers}`} />
                <DarkMetric label="Readiness" value={`${readiness}%`} />
                <DarkMetric label="Hermes IQ" value={`${hermesBrief.intelligenceScore}%`} />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[#d8d5cc] bg-[#faf9f5] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div><h3 className="text-sm font-bold">Hermes command lens</h3><p className="mt-1 text-xs text-[#7b847f]">{hermesLive ? "Hermes-4 reasoning over the live world, with memory of prior briefs." : "Deterministic read. Deploy hermes-intelligence to enable Hermes-4."}</p></div>
              <StatusDot label={hermesThinking ? "thinking" : hermesLive ? "Hermes-4 live" : "heuristic"} ok={hermesLive} />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <HermesCard label="Current read" value={hermesBrief.mood} detail={`${connected}/5 connectors ready. ${automation.enabled ? "Autopilot is armed." : "Autopilot is waiting."}`} />
              <HermesCard label="Bottleneck" value={hermesBrief.bottleneck} detail={hermesBrief.route} />
              <HermesCard label={`Confidence ${Math.round(hermesBrief.confidence * 100)}%`} value={`IQ ${hermesBrief.intelligenceScore}`} detail={hermesBrief.displayUpgrade} />
            </div>
            {hermesBrief.reasoning && (
              <div className="mt-3 rounded-xl border border-[#e0ddd4] bg-white p-4">
                <p className="text-[8px] font-bold uppercase tracking-wider text-[#969d99]">Hermes reasoning</p>
                <p className="mt-2 text-[11px] leading-relaxed text-[#4b5550]">{hermesBrief.reasoning}</p>
              </div>
            )}
            {hermesBrief.agentRoutes.length > 0 && (
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {hermesBrief.agentRoutes.map((route, i) => (
                  <div key={`${route.agent}-${i}`} className="rounded-xl border border-[#e0ddd4] bg-white p-3">
                    <div className="flex items-center justify-between"><p className="text-[11px] font-bold">{route.agent}</p><span className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${route.priority === "now" ? "bg-[#f1e1d8] text-[#9a6044]" : route.priority === "hold" ? "bg-[#e8eadf] text-[#59625d]" : "bg-[#e1f0e3] text-[#477d53]"}`}>{route.priority}</span></div>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-[#68716d]">{route.directive}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {readyConnectors.map((name) => <span key={name} className="rounded-full bg-[#e1f0e3] px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-[#477d53]">{name}</span>)}
              {!readyConnectors.length && <span className="rounded-full bg-[#f1e1d8] px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-[#9a6044]">No ready connectors yet</span>}
            </div>
          </section>

          <section className="rounded-2xl border border-[#d8d5cc] bg-[#faf9f5]">
            <div className="flex items-center justify-between border-b border-[#e4e1d9] px-5 py-4"><div><h3 className="text-sm font-bold">Customer-to-cash workflow</h3><p className="mt-1 text-xs text-[#7b847f]">Hermes routes agents by evidence, receipts, and bottlenecks.</p></div><span className="rounded-full bg-[#f0e2d9] px-3 py-1 text-[10px] font-bold text-[#985d40]">{blockedAgentCount} blocked</span></div>
            <div className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
              {agents.map((agent, index) => {
                const connector = agent.connector === "intelligence" ? undefined : connectorMap[agent.connector];
                const ready = agentReady(agent);
                return <div key={agent.id} className="relative rounded-xl border border-[#e0ddd4] bg-white p-4"><div className="flex items-center justify-between"><span className="grid h-7 w-7 place-items-center rounded-full bg-[#efede6] text-[11px] font-bold">{index + 1}</span>{index < agents.length - 1 && <ArrowRight size={14} className="hidden text-[#a7ada9] xl:block" />}</div><p className="mt-4 text-xs font-bold">{agent.role}</p><p className="mt-1 text-[10px] leading-relaxed text-[#7b847f]">{agent.deliverable}</p><p className={`mt-4 text-[9px] font-bold uppercase tracking-wider ${ready ? "text-[#4c8e5c]" : "text-[#b46b49]"}`}>{ready ? "Live" : connector?.status?.replaceAll("_", " ") ?? "checking"}</p></div>;
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-[#d8d5cc] bg-[#faf9f5] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div><h3 className="text-sm font-bold">World map</h3><p className="mt-1 text-xs text-[#7b847f]">Agents now have bodies, workplaces, loops, and subagents.</p></div>
              <span className="rounded-full bg-[#e8eadf] px-3 py-1 text-[10px] font-bold text-[#59625d]">Proactive world</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {worldDistricts.map((district) => <div key={district.title} className="rounded-xl border border-[#e0ddd4] bg-white p-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#18201d] text-[#dff54a]"><district.icon size={16} /></div>
                  <div><p className="text-xs font-bold">{district.title}</p><p className="mt-1 text-[10px] font-semibold text-[#4b5550]">{district.body}</p></div>
                </div>
                <WorldLine icon={MapPin} label="Place" value={district.place} />
                <WorldLine icon={RefreshCw} label="Loop" value={district.loop} />
                <WorldLine icon={Clock3} label="Cadence" value={district.cadence} />
                <WorldLine icon={Sparkles} label="Tools" value={district.tools} />
                <WorldLine icon={ShieldCheck} label="Guardrail" value={district.guardrail} />
              </div>)}
            </div>
          </section>

          <section id="connectors" className="rounded-2xl border border-[#d8d5cc] bg-[#faf9f5] p-5">
            <div className="mb-4"><h3 className="text-sm font-bold">Recommended live stack</h3><p className="mt-1 text-xs text-[#7b847f]">The smallest practical set of services for a reliable first business.</p></div>
            <div className="grid gap-3 md:grid-cols-2">
              {stack.map((item) => <div key={item.title} className="flex gap-3 rounded-xl border border-[#e0ddd4] bg-white p-4"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#eef0e9]"><item.icon size={16} /></div><div><div className="flex items-center gap-2"><p className="text-xs font-bold">{item.title}</p><span className="text-[8px] font-bold uppercase tracking-wider text-[#8a928e]">{item.required ? "required" : "model-dependent"}</span></div><p className="mt-1 text-xs font-semibold text-[#4b5550]">{item.provider}</p><p className="mt-1 text-[10px] text-[#7b847f]">{item.detail}</p></div></div>)}
            </div>
          </section>

          <section className="rounded-2xl border border-[#d8d5cc] bg-[#faf9f5] p-5">
            <div className="mb-4 flex items-center justify-between"><div><h3 className="text-sm font-bold">Live control plane</h3><p className="mt-1 text-xs text-[#7b847f]">Probed from the current Supabase project. No frontend assumptions.</p></div><span className="text-[10px] font-bold text-[#7b847f]">{revenue.available ? `${revenue.verifiedEvents} verified revenue events` : "Revenue ledger unavailable"}</span></div>
            <div className="space-y-2">
              {connectors.map((connector) => <div key={connector.id} className="flex items-start gap-3 rounded-xl border border-[#e0ddd4] bg-white p-3"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${connector.status === "ready" ? "bg-[#57a66a]" : connector.status === "checking" ? "bg-[#d6b45d]" : "bg-[#d18863]"}`} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="text-xs font-bold">{connector.name}</p><span className="text-[8px] font-bold uppercase tracking-wider text-[#8a928e]">{connector.status.replaceAll("_", " ")}</span></div><p className="mt-1 text-[10px] text-[#7b847f]">{connector.detail}</p>{connector.status !== "ready" && <p className="mt-1 text-[10px] font-medium text-[#9a6044]">{connector.nextStep}</p>}</div></div>)}
            </div>
          </section>

          <section className="rounded-2xl border border-[#d8d5cc] bg-[#faf9f5] p-5">
            <div className="mb-4"><h3 className="text-sm font-bold">Operating doctrine</h3><p className="mt-1 text-xs text-[#7b847f]">The world can be proactive, but external side effects stay controlled.</p></div>
            <div className="grid gap-2 md:grid-cols-2">
              {operatingRules.map((rule) => <div key={rule} className="rounded-xl border border-[#e0ddd4] bg-white p-3 text-[10px] leading-relaxed text-[#5f6863]">{rule}</div>)}
            </div>
          </section>

          <section className="rounded-2xl border border-[#d8d5cc] bg-[#faf9f5] p-5">
            <div className="flex items-center justify-between"><div><h3 className="text-sm font-bold">Automation kernel</h3><p className="mt-1 text-xs text-[#7b847f]">Planner, durable jobs, bounded retries, receipts, and approval escalation.</p></div><StatusDot label={automation.workerReady && automation.plannerReady ? "Planner + worker ready" : "Needs secret"} ok={automation.workerReady && automation.plannerReady} /></div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              <LightMetric label="Active" value={automation.activeJobs} />
              <LightMetric label="Approval" value={automation.awaitingApproval} />
              <LightMetric label="Succeeded" value={automation.succeededJobs} />
              <LightMetric label="Failed" value={automation.failedJobs} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <PolicyPill label="CRM sync" enabled={automation.allowCrmSync} />
              <PolicyPill label="Draft products" enabled={automation.allowDraftProducts} />
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-[#d8d5cc] bg-[#faf9f5] p-5">
            <div className="flex items-center justify-between"><p className="text-xs font-bold">Selected agent</p><StatusDot label={agentReady(selected) ? "Ready" : "Blocked"} ok={agentReady(selected)} /></div>
            <div className="mt-5 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[#18201d] text-[#dff54a]"><selected.icon size={20} /></div><div><p className="text-sm font-bold">{selected.name}</p><p className="text-xs text-[#7b847f]">{selected.role}</p></div></div>
            <Info label="Objective" value={selected.objective} />
            <Info label="Body" value={selected.body} />
            <Info label="Place" value={selected.place} />
            <Info label="Cadence" value={selected.cadence} />
            <Info label="Subagents" value={selected.subagents.join(" / ")} />
            <Info label="Required deliverable" value={selected.deliverable} />
            <Info label="Blocked by" value={selected.connector === "intelligence" ? "Nothing. Hermes reads the world and routes the display." : selected.connector === "creative" ? "Nothing. Aria prepares packages continuously; posting stays approval-gated." : connectorMap[selected.connector]?.status === "ready" ? "Nothing" : connectorMap[selected.connector]?.nextStep ?? selected.connector} />
          </section>

          {agentPlaybooks[selected.id] && (
            <section className="rounded-2xl border border-[#d8d5cc] bg-[#faf9f5] p-5">
              <div className="flex items-center justify-between"><p className="text-xs font-bold">Operational loop</p><span className="text-[9px] font-bold uppercase tracking-wider text-[#8a928e]">{agentPlaybooks[selected.id].loop.filter((s) => s.autonomy === "autonomous").length} auto · {agentPlaybooks[selected.id].loop.filter((s) => s.autonomy === "approval_gated").length} gated</span></div>
              <div className="mt-4 space-y-2">
                {agentPlaybooks[selected.id].loop.map((step, i) => (
                  <div key={step.phase} className="rounded-xl border border-[#e0ddd4] bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-bold"><span className="text-[#a7ada9]">{i + 1}.</span> {step.phase}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${step.autonomy === "autonomous" ? "bg-[#e1f0e3] text-[#477d53]" : "bg-[#f1e1d8] text-[#9a6044]"}`}>{step.autonomy === "autonomous" ? "auto" : "approval"}</span>
                    </div>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-[#68716d]">{step.action}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[9px] font-bold uppercase tracking-wider text-[#8a928e]">Cadence</p>
              <p className="mt-1 text-[10px] leading-relaxed text-[#68716d]">{agentPlaybooks[selected.id].cadence}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {agentPlaybooks[selected.id].guardrails.map((g) => <span key={g} className="rounded-lg bg-[#eef0e9] px-2 py-1 text-[9px] font-medium text-[#5f6863]">{g}</span>)}
              </div>
            </section>
          )}

          {selected.id === "creative" && (
            <section className="rounded-2xl border border-[#d8d5cc] bg-[#faf9f5] p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold">Signal Studio</p>
                <button onClick={runCreative} disabled={creativeRunning} className="flex items-center gap-1.5 rounded-lg bg-[#18201d] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-40">{creativeRunning ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}{creativeRunning ? "Preparing" : "Run preparation cycle"}</button>
              </div>
              <p className="mt-1 text-[10px] text-[#7b847f]">Aria prepares a release package from live trends. Publishing stays operator-approved.</p>
              {creativeMessage && <p className="mt-2 text-[10px] font-medium text-[#9a6044]">{creativeMessage}</p>}
              {creativePackage && (
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-[#e0ddd4] bg-white p-4">
                    <div className="flex items-center justify-between gap-2"><p className="text-sm font-bold">{creativePackage.title}</p><span className="rounded-full bg-[#f1e1d8] px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-[#9a6044]">awaiting approval</span></div>
                    <p className="mt-2 text-[11px] leading-relaxed text-[#4b5550]">{creativePackage.caption}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">{creativePackage.hashtags.map((h) => <span key={h} className="rounded-full bg-[#eef0e9] px-2 py-0.5 text-[9px] font-medium text-[#5f6863]">{h}</span>)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <StudioFacet label="Track" value={`${creativePackage.track.genre} · ${creativePackage.track.bpm} BPM`} detail={`${creativePackage.track.mood} · ${creativePackage.track.durationSec}s`} pending={creativePending.includes("music")} />
                    <StudioFacet label="Visual" value={creativePackage.visual.palette} detail={creativePackage.visual.motion} pending={creativePending.includes("visual")} />
                  </div>
                  <div className="rounded-xl border border-[#e0ddd4] bg-white p-3"><p className="text-[8px] font-bold uppercase tracking-wider text-[#969d99]">Visual concept</p><p className="mt-1 text-[10px] leading-relaxed text-[#68716d]">{creativePackage.visual.concept}</p></div>
                  {creativePending.length > 0 && <p className="text-[9px] font-medium text-[#9a6044]">Pending providers: {creativePending.join(", ")} (concepts ready; rendering needs a configured provider).</p>}
                </div>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-[#d8d5cc] bg-[#faf9f5] p-5">
            <div className="flex items-center justify-between"><p className="text-xs font-bold">Approval inbox</p><span className="text-[10px] font-bold text-[#7b847f]">{actions.length} waiting</span></div>
            <div className="mt-4 space-y-3">
              {actions.map((action) => {
                const state = states[action.id];
                const ready = connectorMap[action.connector]?.status === "ready";
                return <div key={action.id} className="rounded-xl border border-[#e0ddd4] bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold">{action.title}</p><p className="mt-1 text-[10px] leading-relaxed text-[#7b847f]">{action.detail}</p></div><span className={`h-2 w-2 shrink-0 rounded-full ${ready ? "bg-[#57a66a]" : "bg-[#d18863]"}`} /></div>{messages[action.id] && <p className="mt-2 text-[10px] font-medium text-[#a45f40]">{messages[action.id]}</p>}<div className="mt-3 flex justify-end gap-2"><button onClick={() => setActions((current) => current.filter((item) => item.id !== action.id))} className="grid h-8 w-8 place-items-center rounded-lg border border-[#dedbd2] hover:bg-[#f3f1eb]"><X size={13} /></button><button onClick={() => runAction(action)} disabled={state === "executing" || state === "sent"} className="flex h-8 items-center gap-1.5 rounded-lg bg-[#18201d] px-3 text-[10px] font-bold text-white disabled:opacity-40">{state === "executing" ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}{state === "sent" ? "Sent" : "Approve"}</button></div></div>;
              })}
            </div>
          </section>

          {hermesHistory.length > 0 && (
            <section className="rounded-2xl border border-[#d8d5cc] bg-[#faf9f5] p-5">
              <div className="flex items-center justify-between"><p className="text-xs font-bold">Hermes memory</p><span className="text-[10px] font-bold text-[#7b847f]">{hermesHistory.length} briefs</span></div>
              <p className="mt-1 text-[10px] text-[#7b847f]">How the read and IQ moved across cycles. Hermes uses this as context.</p>
              <div className="mt-4 space-y-2">
                {hermesHistory.map((entry, i) => {
                  const prev = hermesHistory[i + 1];
                  const delta = prev ? entry.intelligenceScore - prev.intelligenceScore : 0;
                  return (
                    <div key={entry.createdAt} className="rounded-xl border border-[#e0ddd4] bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-bold">{entry.mood}</p>
                        <span className="font-mono text-[10px] font-bold text-[#3f4944]">IQ {entry.intelligenceScore}{delta !== 0 && <span className={delta > 0 ? "text-[#4c8e5c]" : "text-[#b46b49]"}> {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</span>}</span>
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-[#68716d]">Bottleneck: {entry.bottleneck}</p>
                      <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-[#969d99]">{new Date(entry.createdAt).toLocaleString()}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}

function StudioFacet({ label, value, detail, pending }: { label: string; value: string; detail: string; pending: boolean }) {
  return (
    <div className="rounded-xl border border-[#e0ddd4] bg-white p-3">
      <div className="flex items-center justify-between"><p className="text-[8px] font-bold uppercase tracking-wider text-[#969d99]">{label}</p>{pending && <span className="rounded-full bg-[#f1e1d8] px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wider text-[#9a6044]">provider pending</span>}</div>
      <p className="mt-1 text-[11px] font-bold text-[#3f4944]">{value || "—"}</p>
      <p className="mt-0.5 text-[10px] text-[#68716d]">{detail}</p>
    </div>
  );
}

function StatusDot({ label, ok }: { label: string; ok: boolean }) {
  return <span className={`flex items-center gap-2 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${ok ? "bg-[#e1f0e3] text-[#477d53]" : "bg-[#f1e1d8] text-[#9a6044]"}`}><span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-[#57a66a]" : "bg-[#d18863]"}`} />{label}</span>;
}

function DarkMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-20 rounded-xl bg-white/[0.06] px-3 py-3"><p className="text-[8px] font-bold uppercase tracking-wider text-white/40">{label}</p><p className="mt-1 font-mono text-sm font-bold">{value}</p></div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="mt-4 border-t border-[#e4e1d9] pt-4"><p className="text-[9px] font-bold uppercase tracking-wider text-[#969d99]">{label}</p><p className="mt-1 text-[11px] leading-relaxed text-[#4b5550]">{value}</p></div>;
}

function LightMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-[#e0ddd4] bg-white p-3"><p className="text-[8px] font-bold uppercase tracking-wider text-[#969d99]">{label}</p><p className="mt-1 font-mono text-sm font-bold">{value}</p></div>;
}

function HermesCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-[#e0ddd4] bg-white p-4"><p className="text-[8px] font-bold uppercase tracking-wider text-[#969d99]">{label}</p><p className="mt-2 text-sm font-bold text-[#18201d]">{value}</p><p className="mt-2 text-[10px] leading-relaxed text-[#68716d]">{detail}</p></div>;
}

function PolicyPill({ label, enabled }: { label: string; enabled: boolean }) {
  return <div className="rounded-xl border border-[#e0ddd4] bg-white px-3 py-2"><p className="text-[8px] font-bold uppercase tracking-wider text-[#969d99]">{label}</p><p className={`mt-1 text-[10px] font-bold ${enabled ? "text-[#4c8e5c]" : "text-[#b46b49]"}`}>{enabled ? "Automatic" : "Approval gated"}</p></div>;
}

function WorldLine({ icon: Icon, label, value }: { icon: typeof Bot; label: string; value: string }) {
  return <div className="mt-3 flex gap-2 text-[10px] leading-relaxed text-[#68716d]"><Icon size={12} className="mt-0.5 shrink-0 text-[#8a928e]" /><p><span className="font-bold text-[#3f4944]">{label}:</span> {value}</p></div>;
}
