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

// A row on the shared knowledge bus (a subset of the agent_knowledge table).
export type KnowledgeRow = {
  agent?: string;
  audience?: string;
  kind?: string;
  topic?: string;
  insight?: string;
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "our", "your", "you", "are", "from", "into",
  "that", "this", "have", "has", "draft", "make", "best", "first", "fit",
  "plan", "agent", "objective", "team", "all",
]);

const tokenize = (s: string): string[] =>
  normalize(s).split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));

// Rank the team's shared knowledge by relevance to a job (its agent + objective)
// instead of pure recency, so each agent is fed the most useful learnings as the
// bus grows. Rows are assumed newest-first; stable sort keeps recency as the
// tiebreak. A small boost for team-wide ("all") audience rows. Falls back to
// recency when nothing overlaps, so an agent always has some context.
export function rankKnowledge(query: string, rows: KnowledgeRow[], limit = 6): KnowledgeRow[] {
  const q = new Set(tokenize(query));
  const scored = rows.map((row, i) => {
    const terms = tokenize(`${row.topic ?? ""} ${row.insight ?? ""}`);
    let overlap = 0;
    for (const t of terms) if (q.has(t)) overlap++;
    const audienceBoost = row.audience === "all" ? 0.25 : 0;
    return { row, i, score: overlap + audienceBoost };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.row);
}

// Extract the team learning an agent appends after the TEAM_LEARNING: marker so
// the orchestrator can write it back to the shared bus (closing the loop).
export function extractTeamLearning(output: string): string | null {
  const m = output.match(/TEAM_LEARNING:\s*(.+?)\s*$/ims);
  if (!m) return null;
  const line = m[1].split(/\r?\n/)[0].trim();
  return line.length >= 4 ? line.slice(0, 280) : null;
}

// Jaccard similarity over meaningful tokens (0..1). Used to keep the bus from
// filling with near-duplicate learnings as agents broadcast every run.
export function jaccard(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// True if a candidate learning is essentially already on the bus, so we skip
// re-broadcasting it (keeps ranked retrieval signal-rich, not noisy).
export function isNearDuplicate(candidate: string, existing: string[], threshold = 0.8): boolean {
  return existing.some((e) => jaccard(candidate, e) >= threshold);
}
