// Pure decision logic for the autopilot planner: given an operator's policy and
// Hermes's latest agent routes, decide which autonomous jobs to queue this cycle.
// Kept free of Deno/DB APIs so it can be unit tested in isolation — this is the
// autonomous decision-maker, so it deserves coverage.

export type PlannerPolicy = {
  allow_crm_sync: boolean;
  allow_draft_products: boolean;
};

export type HermesRoute = { agent?: string; directive?: string; priority?: "now" | "next" | "hold" };

// "plan" = queue it; "skip_hold" = Hermes parked this agent; "skip_policy" =
// operator policy disables it. Only skip_hold surfaces as a Hermes-driven skip.
export type JobDecision = "plan" | "skip_hold" | "skip_policy";

export type PlanDecision = {
  crm: JobDecision;
  outreach: "plan"; // outreach draft is always prepared (and always approval-gated)
  storefront: JobDecision;
  directives: { Maya: string | null; Marcus: string | null; Lena: string | null };
};

export const routeFor = (routes: HermesRoute[], agentName: string) =>
  routes.find((r) => (r.agent ?? "").toLowerCase() === agentName.toLowerCase());

export const isHeld = (route?: HermesRoute) => route?.priority === "hold";

export function decidePlan(policy: PlannerPolicy, routes: HermesRoute[]): PlanDecision {
  const maya = routeFor(routes, "Maya");
  const marcus = routeFor(routes, "Marcus");
  const lena = routeFor(routes, "Lena");

  const crm: JobDecision = !policy.allow_crm_sync ? "skip_policy" : isHeld(maya) ? "skip_hold" : "plan";
  const storefront: JobDecision = !policy.allow_draft_products ? "skip_policy" : isHeld(lena) ? "skip_hold" : "plan";

  return {
    crm,
    outreach: "plan",
    storefront,
    directives: {
      Maya: maya?.directive ?? null,
      Marcus: marcus?.directive ?? null,
      Lena: lena?.directive ?? null,
    },
  };
}
