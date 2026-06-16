// Single source of truth for Aria's creative package shape and the normalization
// applied to Hermes's output. Pure TypeScript (no Deno/browser APIs) so the edge
// function and the vitest suite validate identical logic.

export type CreativePackage = {
  title: string;
  trendCluster: { tags: string[]; rationale: string; reachToEffort: string };
  track: { genre: string; bpm: number; mood: string; structure: string; durationSec: number };
  visual: { concept: string; palette: string; motion: string };
  caption: string;
  hashtags: string[];
  reasoning: string;
};

export const asStringArray = (v: unknown, limit: number) =>
  Array.isArray(v) ? v.slice(0, limit).map((x) => String(x).slice(0, 60)) : [];

const clampInt = (n: unknown, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(n) || 0)));

// Coerce whatever the model returned into a safe, bounded CreativePackage.
export function normalizeCreativePackage(parsed: Partial<CreativePackage> | null | undefined): CreativePackage {
  const p = parsed ?? {};
  const reach = String(p.trendCluster?.reachToEffort);
  return {
    title: String(p.title ?? "Untitled release").slice(0, 200),
    trendCluster: {
      tags: asStringArray(p.trendCluster?.tags, 12),
      rationale: String(p.trendCluster?.rationale ?? "").slice(0, 500),
      reachToEffort: ["high", "medium", "low"].includes(reach) ? reach : "medium",
    },
    track: {
      genre: String(p.track?.genre ?? "").slice(0, 80),
      bpm: clampInt(p.track?.bpm, 0, 300),
      mood: String(p.track?.mood ?? "").slice(0, 80),
      structure: String(p.track?.structure ?? "").slice(0, 200),
      durationSec: clampInt(p.track?.durationSec, 0, 600),
    },
    visual: {
      concept: String(p.visual?.concept ?? "").slice(0, 300),
      palette: String(p.visual?.palette ?? "").slice(0, 120),
      motion: String(p.visual?.motion ?? "").slice(0, 120),
    },
    caption: String(p.caption ?? "").slice(0, 400),
    hashtags: asStringArray(p.hashtags, 15),
    reasoning: String(p.reasoning ?? "").slice(0, 600),
  };
}
