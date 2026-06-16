import { describe, expect, it } from "vitest";
import { decidePlan, isHeld, routeFor, type HermesRoute } from "../../../supabase/functions/_shared/plannerPolicy";

const policy = (over: Partial<{ allow_crm_sync: boolean; allow_draft_products: boolean }> = {}) => ({
  allow_crm_sync: true,
  allow_draft_products: true,
  ...over,
});

describe("routeFor / isHeld", () => {
  it("matches agent by name case-insensitively", () => {
    const routes: HermesRoute[] = [{ agent: "maya", directive: "go", priority: "now" }];
    expect(routeFor(routes, "Maya")?.directive).toBe("go");
  });
  it("isHeld only true for hold priority", () => {
    expect(isHeld({ agent: "Lena", priority: "hold" })).toBe(true);
    expect(isHeld({ agent: "Lena", priority: "now" })).toBe(false);
    expect(isHeld(undefined)).toBe(false);
  });
});

describe("decidePlan", () => {
  it("plans all autonomous jobs when policy allows and no routes exist", () => {
    const plan = decidePlan(policy(), []);
    expect(plan.crm).toBe("plan");
    expect(plan.storefront).toBe("plan");
    expect(plan.outreach).toBe("plan");
  });

  it("always prepares the outreach draft (gated) regardless of routes", () => {
    const plan = decidePlan(policy(), [{ agent: "Marcus", priority: "hold" }]);
    expect(plan.outreach).toBe("plan");
  });

  it("skips CRM as hermes_hold when Maya is parked", () => {
    const plan = decidePlan(policy(), [{ agent: "Maya", directive: "pause", priority: "hold" }]);
    expect(plan.crm).toBe("skip_hold");
  });

  it("skips storefront as hermes_hold when Lena is parked", () => {
    const plan = decidePlan(policy(), [{ agent: "Lena", priority: "hold" }]);
    expect(plan.storefront).toBe("skip_hold");
  });

  it("distinguishes policy-off from hermes-hold", () => {
    const plan = decidePlan(policy({ allow_crm_sync: false }), [{ agent: "Maya", priority: "hold" }]);
    // policy gate takes precedence — this is not a Hermes-driven skip
    expect(plan.crm).toBe("skip_policy");
  });

  it("passes through directives for traceability", () => {
    const plan = decidePlan(policy(), [
      { agent: "Maya", directive: "Find 5 roofers", priority: "now" },
      { agent: "Lena", directive: "Draft the kit", priority: "next" },
    ]);
    expect(plan.directives.Maya).toBe("Find 5 roofers");
    expect(plan.directives.Lena).toBe("Draft the kit");
    expect(plan.directives.Marcus).toBeNull();
  });

  it("a 'now' or 'next' priority does not skip", () => {
    const plan = decidePlan(policy(), [{ agent: "Maya", priority: "now" }, { agent: "Lena", priority: "next" }]);
    expect(plan.crm).toBe("plan");
    expect(plan.storefront).toBe("plan");
  });
});
