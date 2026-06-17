import { describe, expect, it } from "vitest";
import { scoreKnowledgeUsage, extractTeamLearning, rankKnowledge } from "../../../supabase/functions/_shared/knowledgeEval";

describe("scoreKnowledgeUsage", () => {
  it("flags an output that references the collective knowledge", () => {
    const output = "Subject: slow follow-up is costing you jobs. For Austin home-services contractors, the $29 Follow-Up Kit fixes it.";
    const r = scoreKnowledgeUsage(output, ["follow-up", "contractor", "$29", "Austin"]);
    expect(r.used).toBe(true);
    expect(r.hits).toEqual(["follow-up", "contractor", "$29", "Austin"]);
    expect(r.score).toBe(1);
  });

  it("matches numeric terms regardless of $ prefix", () => {
    expect(scoreKnowledgeUsage("priced at 29 dollars", ["$29"]).used).toBe(true);
    expect(scoreKnowledgeUsage("the $29 kit", ["29"]).used).toBe(true);
  });

  it("marks knowledge unused when the output ignores it", () => {
    const r = scoreKnowledgeUsage("Generic email about our software platform.", ["follow-up", "contractor", "$29", "Austin"]);
    expect(r.used).toBe(false);
    expect(r.missed.length).toBe(4);
    expect(r.score).toBe(0);
  });

  it("respects the threshold", () => {
    const out = "mentions contractor only";
    expect(scoreKnowledgeUsage(out, ["contractor", "follow-up", "$29", "Austin"], 0.5).used).toBe(false);
    expect(scoreKnowledgeUsage(out, ["contractor", "follow-up"], 0.5).used).toBe(true);
  });
});

describe("rankKnowledge", () => {
  const rows = [
    { topic: "creative trends", insight: "lofi beats are trending on TikTok this week", audience: "all" },
    { topic: "contractor outreach", insight: "HVAC owners reply to slow follow-up framed as lost revenue", audience: "all" },
    { topic: "finance", insight: "Stripe balance is zero; no charges yet", audience: "all" },
  ];

  it("ranks the most relevant learning first for a sales job", () => {
    const ranked = rankKnowledge("draft outreach email for a contractor about follow-up", rows, 2);
    expect(ranked[0].topic).toBe("contractor outreach");
    expect(ranked.length).toBe(2);
  });

  it("surfaces creative knowledge for a creative job", () => {
    const ranked = rankKnowledge("plan a trending lofi track for TikTok", rows, 1);
    expect(ranked[0].topic).toBe("creative trends");
  });

  it("falls back to recency (input order) when nothing overlaps", () => {
    const ranked = rankKnowledge("unrelated quantum logistics query", rows, 3);
    expect(ranked.map((r) => r.topic)).toEqual(["creative trends", "contractor outreach", "finance"]);
  });
});

describe("extractTeamLearning", () => {
  it("pulls the learning the agent appended for teammates", () => {
    const out = "Here is the plan...\n\nTEAM_LEARNING: HVAC owners reply fastest to follow-up framed as lost-revenue.";
    expect(extractTeamLearning(out)).toBe("HVAC owners reply fastest to follow-up framed as lost-revenue.");
  });

  it("returns null when no marker is present", () => {
    expect(extractTeamLearning("just a plan, no learning line")).toBeNull();
  });

  it("ignores an empty/too-short learning", () => {
    expect(extractTeamLearning("TEAM_LEARNING:  ")).toBeNull();
  });
});
