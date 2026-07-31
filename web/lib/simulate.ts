import type { ReportJson } from "./types";

export interface GoalEvent {
  minute: number;
  side: "home" | "away";
}

export interface SimulationResult {
  homeGoals: number;
  awayGoals: number;
  homeLambda: number;
  awayLambda: number;
  events: GoalEvent[];
  basis: { home: "xg" | "form"; away: "xg" | "form" };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Mirrors search.ts's isTeamHome -- the report doesn't carry an explicit
// "own team is home" flag, only the searched team's name and the match's
// home/away team names, so this re-derives it the same way.
export function isSearchedTeamHome(report: ReportJson): boolean | null {
  if (!report.match) return null;
  const target = normalize(report.team);
  const home = normalize(report.match.homeTeam);
  const away = normalize(report.match.awayTeam);
  if (home.includes(target) || target.includes(home)) return true;
  if (away.includes(target) || target.includes(away)) return false;
  return null;
}

// Standard Knuth algorithm -- exact for the small lambdas (typically 0.5-3)
// a single team's expected-goals figure produces.
function poissonSample(lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function averageGoalsFromForm(results: { scoreline: string; venue: "home" | "away" }[]): { for: number; against: number } | null {
  if (!results.length) return null;
  let f = 0;
  let a = 0;
  for (const r of results) {
    const [h, aw] = r.scoreline.split("-").map(Number);
    if (r.venue === "home") {
      f += h;
      a += aw;
    } else {
      f += aw;
      a += h;
    }
  }
  return { for: f / results.length, against: a / results.length };
}

// Expected goals for one side = average of that side's own attacking
// output and the opponent's own defensive leakiness, each expressed as a
// per-game rate -- the standard simplified attack/defense-strength
// combination used in basic football Poisson models, not a guess. Prefers
// each side's real season xG estimate (already fetched, shot-quality-
// adjusted, more informative than raw goals); falls back to that side's
// own last-5 actual-goals average (also already fetched, via `form`/
// `opponentForm`) when xG wasn't available for that team -- common for
// pre-season friendlies, where Fotmob often lacks per-match stats
// entirely. Each side resolves its own attack/defense independently, so a
// match can legitimately end up mixing an xG-based lambda for one team
// with a form-based one for the other.
export function computeExpectedGoals(report: ReportJson): { homeLambda: number; awayLambda: number; basis: SimulationResult["basis"] } | null {
  if (!report.match || !report.insights) return null;
  const searchedHome = isSearchedTeamHome(report);
  if (searchedHome === null) return null;

  const homeForm = searchedHome ? report.form : report.opponentForm;
  const awayForm = searchedHome ? report.opponentForm : report.form;

  const homeXg = report.insights.homeXgEstimate;
  const awayXg = report.insights.awayXgEstimate;

  const homeFormAvg = homeForm ? averageGoalsFromForm(homeForm.last5Overall) : null;
  const awayFormAvg = awayForm ? averageGoalsFromForm(awayForm.last5Overall) : null;

  const homeAttack = homeXg ? homeXg.xgFor / homeXg.sampleSize : homeFormAvg?.for ?? null;
  const homeDefense = homeXg ? homeXg.xgAgainst / homeXg.sampleSize : homeFormAvg?.against ?? null;
  const awayAttack = awayXg ? awayXg.xgFor / awayXg.sampleSize : awayFormAvg?.for ?? null;
  const awayDefense = awayXg ? awayXg.xgAgainst / awayXg.sampleSize : awayFormAvg?.against ?? null;

  if (homeAttack == null || homeDefense == null || awayAttack == null || awayDefense == null) return null;

  // Floor at 0.15 -- a real team essentially never has a truly-zero chance
  // of scoring; this only ever bites on tiny/degenerate samples and keeps
  // the Poisson sample from being deterministically 0-0 forever.
  const homeLambda = Math.max((homeAttack + awayDefense) / 2, 0.15);
  const awayLambda = Math.max((awayAttack + homeDefense) / 2, 0.15);

  return {
    homeLambda: Number(homeLambda.toFixed(2)),
    awayLambda: Number(awayLambda.toFixed(2)),
    basis: { home: homeXg ? "xg" : "form", away: awayXg ? "xg" : "form" },
  };
}

// Each goal gets a uniformly random minute (1-90) -- deliberately not
// weighted toward "more goals late" or any other narrative pattern, since
// nothing in the fetched data supports a specific in-match timing
// distribution. Simultaneous-minute collisions are left as-is (rare, and a
// legitimate coincidence, not deduplicated).
export function simulateMatch(report: ReportJson): SimulationResult | null {
  const expected = computeExpectedGoals(report);
  if (!expected) return null;
  const { homeLambda, awayLambda, basis } = expected;

  const homeGoals = poissonSample(homeLambda);
  const awayGoals = poissonSample(awayLambda);

  const events: GoalEvent[] = [
    ...Array.from({ length: homeGoals }, () => ({ minute: Math.ceil(Math.random() * 90), side: "home" as const })),
    ...Array.from({ length: awayGoals }, () => ({ minute: Math.ceil(Math.random() * 90), side: "away" as const })),
  ].sort((a, b) => a.minute - b.minute);

  return { homeGoals, awayGoals, homeLambda, awayLambda, events, basis };
}

// Parses "4-2-3-1" into outfield rows [4,2,3,1] (goalkeeper is implicit,
// added separately by the caller). Falls back to a generic 4-4-2 when the
// formation wasn't published (common for not-yet-finalized fixtures) --
// clearly labeled as a fallback in the UI, not presented as real data.
export function parseFormation(formation: string | null): { rows: number[]; isFallback: boolean } {
  if (formation) {
    const rows = formation.split("-").map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (rows.length && rows.reduce((a, b) => a + b, 0) === 10) return { rows, isFallback: false };
  }
  return { rows: [4, 4, 2], isFallback: true };
}
