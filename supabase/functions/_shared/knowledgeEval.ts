// Pure scoring for cross-agent learning: did an agent's output actually use the
// collective knowledge it was given? Used by the orchestrator (to flag
// knowledge-grounded runs) and by the eval suite (regression guard). No Deno or
// browser APIs so it runs in the edge function and in vitest.

export type KnowledgeUsage = {
  used: boolean;
  score: number; // 0..1 fraction of expected terms referenced
  hits: string[];
  missed: string[];
};

// Drop punctuation incl. the currency prefix so "$29" and "29" compare equal.
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ");

// Each expected term may be a phrase; it counts as a hit if it (or a close form)
// appears in the output. Numeric terms like "29" match "$29" / "29".
export function scoreKnowledgeUsage(output: string, expectedTerms: string[], threshold = 0.5): KnowledgeUsage {
  const hay = normalize(output);
  const terms = expectedTerms.map((t) => t.trim()).filter(Boolean);
  const hits: string[] = [];
  const missed: string[] = [];
  for (const term of terms) {
    const t = normalize(term).trim();
    if (t && hay.includes(t)) hits.push(term);
    else missed.push(term);
  }
  const score = terms.length ? hits.length / terms.length : 0;
  return { used: score >= threshold, score, hits, missed };
}

// Extract the team learning an agent appends after the TEAM_LEARNING: marker so
// the orchestrator can write it back to the shared bus (closing the loop).
export function extractTeamLearning(output: string): string | null {
  const m = output.match(/TEAM_LEARNING:\s*(.+?)\s*$/ims);
  if (!m) return null;
  const line = m[1].split(/\r?\n/)[0].trim();
  return line.length >= 4 ? line.slice(0, 280) : null;
}
