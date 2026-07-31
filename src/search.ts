import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getFotmobMatches, getFotmobMatchDetails, getFotmobTeamProfile } from "./sites/fotmob";
import { getSofascoreMatches, getSofascoreMatchDetails, getSofascoreTeamProfile } from "./sites/sofascore";
import { getSoccerdeskMatches, getSoccerdeskMatchDetails, getSoccerdeskTeamProfile } from "./sites/soccerdesk";
import { getGoalMatches, getGoalMatchDetails, getGoalTeamProfile } from "./sites/goal";
import { get365ScoresMatches, get365ScoresMatchDetails, get365ScoresTeamProfile } from "./sites/365scores";
import { getStadiumDbVenueDetails } from "./sites/stadiumdb";
import { getWttrWeather } from "./sites/wttrin";
import { getSquawkaDefensiveStats } from "./sites/squawka";
import { countryDistanceKm } from "./geo";
import type {
  CardDisciplineInfo,
  CardDisciplineVenueSplit,
  DefensiveStats,
  DirectPlayExposureFlag,
  SeasonAerialEstimate,
  SeasonBigChancesEstimate,
  SeasonDefensiveErrorsEstimate,
  SeasonFoulsEstimate,
  SeasonGoalkeepingEstimate,
  SeasonPassingStyleEstimate,
  SetPieceThreatFlag,
  DuelVulnerability,
  ExperienceComparison,
  ExperienceH2HNote,
  FatigueFlag,
  FixtureGap,
  FormResult,
  FullbackExposureInfo,
  FormSummary,
  HalfSplitStats,
  HomeAdvantageInfo,
  LineupPlayer,
  LosingStreakContextInfo,
  MatchDetails,
  MatchInfo,
  MatchInsights,
  OpponentRankRecord,
  PlayerCardRisk,
  PossessionMatchupInfo,
  PresenceEntry,
  RefereeCardRiskNote,
  RefereeStats,
  ResilienceInfo,
  RestComparison,
  RestPerformanceInfo,
  RotationInfo,
  SeasonCornersEstimate,
  SeasonShotsEstimate,
  SeasonXGEstimate,
  SquadMember,
  StandingsImpactInfo,
  StandingsScenario,
  StandingsZoneInfo,
  StreakStabilityInfo,
  TeamProfile,
  TeamStanding,
  TravelInfo,
  VenueDetails,
} from "./types";
import { stripDiacritics } from "./teamNameMatch";

// Sofascore is the base/primary source for the merged report -- every other
// source only supplements fields Sofascore doesn't have. This order is both
// "who's the base" (first entry) and "fill-gap priority" (fallback order)
// for everything downstream.
const SOURCE_ORDER = ["sofascore", "fotmob", "soccerdesk", "goal", "365scores"] as const;
export type Source = (typeof SOURCE_ORDER)[number];

const scrapers: Record<Source, { run: (t: string) => Promise<MatchInfo[]>; details: (m: MatchInfo) => Promise<MatchDetails>; profile: (t: string) => Promise<TeamProfile> }> = {
  sofascore: { run: getSofascoreMatches, details: getSofascoreMatchDetails, profile: getSofascoreTeamProfile },
  fotmob: { run: getFotmobMatches, details: getFotmobMatchDetails, profile: getFotmobTeamProfile },
  soccerdesk: { run: getSoccerdeskMatches, details: getSoccerdeskMatchDetails, profile: getSoccerdeskTeamProfile },
  goal: { run: getGoalMatches, details: getGoalMatchDetails, profile: getGoalTeamProfile },
  "365scores": { run: get365ScoresMatches, details: get365ScoresMatchDetails, profile: get365ScoresTeamProfile },
};

const OUTPUT_DIR = path.resolve(process.cwd(), "output");

function nextMatch(matches: MatchInfo[]): MatchInfo | null {
  const now = Date.now();
  const upcoming = matches
    .filter((m) => m.kickoffUtc && new Date(m.kickoffUtc).getTime() > now)
    .sort((a, b) => new Date(a.kickoffUtc!).getTime() - new Date(b.kickoffUtc!).getTime());
  return upcoming[0] ?? null;
}

function formatWhen(kickoffUtc: string | null): string {
  return kickoffUtc ? new Date(kickoffUtc).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "TBD";
}

function normalizeTeamName(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isTeamHome(m: MatchInfo, teamName: string): boolean | null {
  const target = normalizeTeamName(teamName);
  const home = normalizeTeamName(m.homeTeam);
  const away = normalizeTeamName(m.awayTeam);
  if (home.includes(target) || target.includes(home)) return true;
  if (away.includes(target) || target.includes(away)) return false;
  return null;
}

const dayDiff = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

function computeFormSummary(teamName: string, matches: MatchInfo[]): FormSummary {
  const now = Date.now();

  const played = matches
    .filter((m) => m.homeScore != null && m.awayScore != null && m.kickoffUtc)
    .sort((a, b) => new Date(b.kickoffUtc!).getTime() - new Date(a.kickoffUtc!).getTime());

  const toFormResult = (m: MatchInfo): FormResult | null => {
    const home = isTeamHome(m, teamName);
    if (home === null) return null;
    const teamScore = home ? m.homeScore! : m.awayScore!;
    const oppScore = home ? m.awayScore! : m.homeScore!;
    const result: "W" | "D" | "L" = teamScore > oppScore ? "W" : teamScore < oppScore ? "L" : "D";
    return {
      opponent: home ? m.awayTeam : m.homeTeam,
      competition: m.competition,
      date: m.kickoffUtc,
      result,
      scoreline: `${m.homeScore}-${m.awayScore}`,
      venue: home ? "home" : "away",
      margin: Math.abs(teamScore - oppScore),
    };
  };

  const allResults = played.map(toFormResult).filter((r): r is FormResult => r !== null);

  const chronological = matches.filter((m) => m.kickoffUtc).sort((a, b) => new Date(a.kickoffUtc!).getTime() - new Date(b.kickoffUtc!).getTime());
  const upcoming = chronological.filter((m) => new Date(m.kickoffUtc!).getTime() > now).slice(0, 5);
  const next5WithGaps: FixtureGap[] = upcoming.map((m) => {
    const idx = chronological.indexOf(m);
    const prev = chronological[idx - 1];
    const home = isTeamHome(m, teamName);
    return {
      opponent: home === false ? m.homeTeam : m.awayTeam,
      date: m.kickoffUtc,
      daysSincePrevious: prev?.kickoffUtc ? dayDiff(m.kickoffUtc!, prev.kickoffUtc) : null,
    };
  });

  const lastThreePlayed = played.slice(0, 3);
  const gapsBetweenLastThree: number[] = [];
  for (let i = 0; i < lastThreePlayed.length - 1; i++) {
    gapsBetweenLastThree.push(dayDiff(lastThreePlayed[i].kickoffUtc!, lastThreePlayed[i + 1].kickoffUtc!));
  }

  // Only Sofascore's fixture list carries homeScoreHT/awayScoreHT (from the
  // same events/next|last response already fetched -- no extra request).
  // Silently empty for every other source, which is a real source
  // limitation, not a bug in this computation.
  const withHalfTime = played.filter((m) => m.homeScoreHT != null && m.awayScoreHT != null);
  let halfSplit = null as FormSummary["halfSplit"];
  if (withHalfTime.length) {
    let fhFor = 0, fhAgainst = 0, shFor = 0, shAgainst = 0;
    for (const m of withHalfTime) {
      const home = isTeamHome(m, teamName);
      if (home === null) continue;
      const htFor = home ? m.homeScoreHT! : m.awayScoreHT!;
      const htAgainst = home ? m.awayScoreHT! : m.homeScoreHT!;
      const ftFor = home ? m.homeScore! : m.awayScore!;
      const ftAgainst = home ? m.awayScore! : m.homeScore!;
      fhFor += htFor;
      fhAgainst += htAgainst;
      shFor += ftFor - htFor;
      shAgainst += ftAgainst - htAgainst;
    }
    halfSplit = { sampleSize: withHalfTime.length, firstHalfGoalsFor: fhFor, firstHalfGoalsAgainst: fhAgainst, secondHalfGoalsFor: shFor, secondHalfGoalsAgainst: shAgainst };
  }

  const recentCompetitions = [...new Set(played.slice(0, 10).map((r) => r.competition).filter((c): c is string => c !== null))];

  // Longest run of the same result starting from the most recent match.
  let currentStreak: FormSummary["currentStreak"] = null;
  if (allResults.length) {
    const first = allResults[0].result;
    let count = 1;
    while (count < allResults.length && allResults[count].result === first) count++;
    currentStreak = { result: first, count };
  }

  const winRate = (results: FormResult[]) => (results.length ? Math.round((results.filter((r) => r.result === "W").length / results.length) * 100) : null);
  const homeResults = allResults.filter((r) => r.venue === "home");
  const awayResults = allResults.filter((r) => r.venue === "away");

  const points = (r: FormResult) => (r.result === "W" ? 3 : r.result === "D" ? 1 : 0);
  let momentum: FormSummary["momentum"] = null;
  if (allResults.length >= 6) {
    const recent = allResults.slice(0, 3);
    const prior = allResults.slice(3, 6);
    const recentPPG = Number((recent.reduce((s, r) => s + points(r), 0) / recent.length).toFixed(2));
    const priorPPG = Number((prior.reduce((s, r) => s + points(r), 0) / prior.length).toFixed(2));
    const diff = recentPPG - priorPPG;
    momentum = { recentPPG, priorPPG, trend: diff >= 0.5 ? "improving" : diff <= -0.5 ? "declining" : "stable" };
  }

  // "Narrow win" means genuinely tight and low-scoring (1-0, 2-1) -- a
  // 1-goal margin alone would also catch high-scoring shootouts like 4-3,
  // which isn't the same thing. totalGoals comes from the scoreline string
  // rather than a new field, since margin + scoreline already fully
  // determine it.
  const totalGoals = (r: FormResult) => r.scoreline.split("-").reduce((sum, n) => sum + Number(n), 0);
  const last10Wins = allResults.slice(0, 10).filter((r) => r.result === "W");
  const narrowWinSharePct = last10Wins.length
    ? Math.round((last10Wins.filter((r) => r.margin === 1 && totalGoals(r) <= 3).length / last10Wins.length) * 100)
    : null;

  // Among draws, how many weren't 0-0 -- "found the net despite not
  // winning" as a companion to resilience (ResilienceInfo), which only
  // looks at W/D/L, not whether a draw was scoreless.
  const last10Draws = allResults.slice(0, 10).filter((r) => r.result === "D");
  const scoringDrawSharePct = last10Draws.length ? Math.round((last10Draws.filter((r) => totalGoals(r) > 0).length / last10Draws.length) * 100) : null;

  // Both Teams To Score -- independent of W/D/L, just whether both sides on
  // the scoreline found the net.
  const last10Played = allResults.slice(0, 10);
  const bothScored = (r: FormResult) => {
    const [h, a] = r.scoreline.split("-").map(Number);
    return h > 0 && a > 0;
  };
  const bttsSharePct = last10Played.length ? Math.round((last10Played.filter(bothScored).length / last10Played.length) * 100) : null;

  // Longest run of consecutive most-recent matches with zero goals
  // conceded / zero goals scored -- same shape as currentStreak above, just
  // a different condition. teamGoalsFor/Against read off the scoreline
  // string using each result's own recorded venue.
  const teamGoals = (r: FormResult): { for: number; against: number } => {
    const [h, a] = r.scoreline.split("-").map(Number);
    return r.venue === "home" ? { for: h, against: a } : { for: a, against: h };
  };
  let cleanSheetStreak: number | null = null;
  let scorelessStreak: number | null = null;
  if (allResults.length) {
    let cs = 0;
    while (cs < allResults.length && teamGoals(allResults[cs]).against === 0) cs++;
    cleanSheetStreak = cs;
    let ss = 0;
    while (ss < allResults.length && teamGoals(allResults[ss]).for === 0) ss++;
    scorelessStreak = ss;
  }

  return {
    last5Overall: allResults.slice(0, 5),
    last10Overall: allResults.slice(0, 10),
    last5Home: allResults.filter((r) => r.venue === "home").slice(0, 5),
    last5Away: allResults.filter((r) => r.venue === "away").slice(0, 5),
    next5WithGaps,
    gapsBetweenLastThree,
    halfSplit,
    recentCompetitions,
    currentStreak,
    homeWinRatePct: winRate(homeResults),
    awayWinRatePct: winRate(awayResults),
    momentum,
    narrowWinSharePct,
    scoringDrawSharePct,
    bttsSharePct,
    cleanSheetStreak,
    scorelessStreak,
  };
}

function isEmpty(v: any): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

// Fields Sofascore might not have, that another source can fill in.
const MATCH_MERGE_FIELDS: (keyof MatchDetails)[] = [
  "venueName", "venueCity", "venueCountry", "referee", "refereeStats", "attendance", "weather",
  "headToHeadSummary", "headToHeadStreaks", "homeLineup", "awayLineup", "homeFormation", "awayFormation",
  "homeTeamStanding", "awayTeamStanding", "homeTeamSeasonStats", "awayTeamSeasonStats", "matchStats",
  "eventTimeline", "playerOfTheMatch", "homeSuspendedPlayers", "awaySuspendedPlayers",
];

const PROFILE_MERGE_FIELDS: (keyof TeamProfile)[] = ["squad", "averageAge", "injuries", "keyInjuries", "recentTransfers"];

// wttr.in isn't a per-team Source (it has no fixtures/lineups/squad to
// search) -- it only ever fills the single `weather` field, as a
// post-merge supplemental fetch, so fieldSources needs to name it too.
export type FieldSource = Source | "wttr.in";

export interface MergedMatch extends MatchDetails {
  baseSource: Source;
  fieldSources: Partial<Record<string, FieldSource>>;
  additionalNotes: { source: Source; note: string }[];
}

function mergeMatchDetails(bySource: Map<Source, MatchDetails>): MergedMatch {
  const baseSource = SOURCE_ORDER.find((s) => bySource.has(s)) ?? [...bySource.keys()][0];
  const base = bySource.get(baseSource)!;
  const merged: any = { ...base };
  const fieldSources: Partial<Record<string, FieldSource>> = {};

  for (const field of MATCH_MERGE_FIELDS) {
    if (!isEmpty(merged[field])) continue;
    for (const src of SOURCE_ORDER) {
      if (src === baseSource) continue;
      const candidate = bySource.get(src) as any;
      if (candidate && !isEmpty(candidate[field])) {
        merged[field] = candidate[field];
        fieldSources[field] = src;
        break;
      }
    }
  }

  const additionalNotes = [...bySource.entries()]
    .filter(([src, d]) => src !== baseSource && d.note)
    .map(([source, d]) => ({ source, note: d.note! }));

  return { ...merged, baseSource, fieldSources, additionalNotes };
}

export interface MergedProfile extends TeamProfile {
  baseSource: Source;
  fieldSources: Partial<Record<string, Source>>;
}

// Matches Fotmob/365scores' full word ("Midfielder"), Goal's uppercase enum
// ("MIDFIELDER"), and Sofascore's single-letter code ("M"). SoccerDesk never
// sets role at all, so its injuries (never populated anyway) are unaffected.
function isMidfieldRole(role: string | null): boolean {
  if (!role) return false;
  return role.toUpperCase() === "M" || role.toLowerCase().includes("mid");
}

// Same tolerance-for-format-differences approach as isMidfieldRole --
// Sofascore's single-letter code ("D"), Goal's uppercase enum
// ("DEFENDER"), and full words all match.
function isDefenderRole(role: string | null): boolean {
  if (!role) return false;
  return role.toUpperCase() === "D" || role.toLowerCase().includes("defen") || role.toLowerCase().includes("back");
}

function computeMissingMidfielders(injuries: TeamProfile["injuries"]): string[] | null {
  if (!injuries) return null;
  return injuries.filter((p) => isMidfieldRole(p.role)).map((p) => p.name);
}

// Only Goal.com's squad carries per-player season stats, and it abbreviates
// first names ("A. Becker"), so it can't be matched against another source's
// squad by exact name -- last-name-only match is the best available common
// ground. This is approximate: two same-surname players in one squad (rare
// but real, e.g. father/son or two unrelated players) would collide, and the
// stats attach to whichever matches first.
function surname(name: string): string {
  const parts = normalizeTeamName(name).split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function enrichSquadWithSeasonStats(squad: SquadMember[], bySource: Map<Source, TeamProfile>): SquadMember[] {
  const statsBySurname = new Map<string, { stats: NonNullable<SquadMember["seasonStats"]>; source: Source }>();
  for (const src of SOURCE_ORDER) {
    for (const member of bySource.get(src)?.squad ?? []) {
      if (member.seasonStats) statsBySurname.set(surname(member.name), { stats: member.seasonStats, source: src });
    }
  }
  if (!statsBySurname.size) return squad;
  return squad.map((m) => {
    if (m.seasonStats) return m;
    const found = statsBySurname.get(surname(m.name));
    return found ? { ...m, seasonStats: found.stats, seasonStatsSource: found.source } : m;
  });
}

// Squawka isn't a MatchInfo source, so this is a separate enrichment step
// (async, needs a live fetch) rather than folding into the SOURCE_ORDER
// merge loop -- same pattern as StadiumDB/wttr.in. Matches by exact
// normalized name (Squawka publishes full names, same as Sofascore).
async function enrichSquadWithDefensiveStats(squad: SquadMember[], teamName: string, competitionCandidates: string[]): Promise<SquadMember[]> {
  const statsByName = await getSquawkaDefensiveStats(teamName, competitionCandidates).catch(() => new Map<string, DefensiveStats>());
  if (!statsByName.size) return squad;
  return squad.map((m) => {
    const stats = statsByName.get(normalizeTeamName(m.name));
    return stats ? { ...m, defensiveStats: stats } : m;
  });
}

interface TopPerformer {
  name: string;
  goals: number;
  assists: number;
  appearances: number;
  rating: number | null;
  source: Source | null;
}

function computeTopPerformers(squad: SquadMember[] | null, by: "goals" | "assists", count = 3): TopPerformer[] {
  if (!squad) return [];
  return squad
    .filter((m) => m.seasonStats && m.seasonStats[by] > 0)
    .sort((a, b) => b.seasonStats![by] - a.seasonStats![by])
    .slice(0, count)
    .map((m) => ({
      name: m.name,
      goals: m.seasonStats!.goals,
      assists: m.seasonStats!.assists,
      appearances: m.seasonStats!.appearances,
      rating: m.seasonStats!.rating,
      source: m.seasonStatsSource as Source | null,
    }));
}

interface TopDefender {
  name: string;
  tacklesMade: number;
  interceptions: number;
}

// Ranked by tackles+interceptions combined -- both are real defensive-
// activity counts (see DefensiveStats), not the literal pressing/defensive-
// line metrics the original checklist asked for.
function computeTopDefenders(squad: SquadMember[] | null, count = 3): TopDefender[] {
  if (!squad) return [];
  return squad
    .filter((m) => m.defensiveStats && ((m.defensiveStats.tacklesMade ?? 0) > 0 || (m.defensiveStats.interceptions ?? 0) > 0))
    .sort((a, b) => {
      const scoreA = (a.defensiveStats!.tacklesMade ?? 0) + (a.defensiveStats!.interceptions ?? 0);
      const scoreB = (b.defensiveStats!.tacklesMade ?? 0) + (b.defensiveStats!.interceptions ?? 0);
      return scoreB - scoreA;
    })
    .slice(0, count)
    .map((m) => ({ name: m.name, tacklesMade: m.defensiveStats!.tacklesMade ?? 0, interceptions: m.defensiveStats!.interceptions ?? 0 }));
}

function mergeTeamProfile(bySource: Map<Source, TeamProfile>): MergedProfile {
  const baseSource = SOURCE_ORDER.find((s) => bySource.has(s)) ?? [...bySource.keys()][0];
  const base = bySource.get(baseSource)!;
  const merged: any = { ...base };
  const fieldSources: Partial<Record<string, Source>> = {};

  for (const field of PROFILE_MERGE_FIELDS) {
    if (!isEmpty(merged[field])) continue;
    for (const src of SOURCE_ORDER) {
      if (src === baseSource) continue;
      const candidate = bySource.get(src) as any;
      if (candidate && !isEmpty(candidate[field])) {
        merged[field] = candidate[field];
        fieldSources[field] = src;
        break;
      }
    }
  }

  merged.missingMidfielders = computeMissingMidfielders(merged.injuries);
  if (merged.squad) merged.squad = enrichSquadWithSeasonStats(merged.squad, bySource);

  return { ...merged, baseSource, fieldSources };
}

function via(fieldSources: Partial<Record<string, FieldSource>>, field: string): string {
  const src = fieldSources[field];
  return src ? ` (via ${src})` : "";
}

function formResultStr(r: FormResult): string {
  return `${r.result} ${r.scoreline} vs ${r.opponent}${r.margin === 1 ? " (narrow)" : ""}`;
}

function halfSplitStr(h: HalfSplitStats): string {
  return `1H ${h.firstHalfGoalsFor}-${h.firstHalfGoalsAgainst}, 2H ${h.secondHalfGoalsFor}-${h.secondHalfGoalsAgainst} (n=${h.sampleSize})`;
}

function printFormSummary(f: FormSummary) {
  if (f.last5Overall.length) console.log(`  Last 5 (all):  ${f.last5Overall.map(formResultStr).join(", ")}`);
  if (f.last5Home.length) console.log(`  Last 5 (home): ${f.last5Home.map(formResultStr).join(", ")}`);
  if (f.last5Away.length) console.log(`  Last 5 (away): ${f.last5Away.map(formResultStr).join(", ")}`);
  if (f.next5WithGaps.length) {
    console.log(`  Next 5:        ${f.next5WithGaps.map((g) => `${formatWhen(g.date)} vs ${g.opponent}${g.daysSincePrevious != null ? ` (+${g.daysSincePrevious}d rest)` : ""}`).join(" | ")}`);
  }
  if (f.gapsBetweenLastThree.length) console.log(`  Gaps (last 3): ${f.gapsBetweenLastThree.join(", ")} days`);
  if (f.halfSplit) console.log(`  Half split:    ${halfSplitStr(f.halfSplit)}`);
  if (f.recentCompetitions.length > 1) console.log(`  Competitions:  ${f.recentCompetitions.join(" | ")} (${f.recentCompetitions.length} in recent run)`);
  if (f.currentStreak) console.log(`  Streak:        ${f.currentStreak.count}-game ${f.currentStreak.result === "W" ? "winning" : f.currentStreak.result === "L" ? "losing" : "drawing"} streak`);
  if (f.homeWinRatePct != null || f.awayWinRatePct != null) console.log(`  Win rate:      Home ${f.homeWinRatePct ?? "n/a"}% / Away ${f.awayWinRatePct ?? "n/a"}%`);
  if (f.momentum) console.log(`  Momentum:      ${f.momentum.recentPPG} ppg (last 3) vs ${f.momentum.priorPPG} ppg (prior 3) -- ${f.momentum.trend}`);
  if (f.narrowWinSharePct != null) console.log(`  Narrow wins:   ${f.narrowWinSharePct}% of last 10 wins were tight and low-scoring (1-0, 2-1 style)`);
  if (f.scoringDrawSharePct != null) console.log(`  Scoring draws: ${f.scoringDrawSharePct}% of last 10 draws weren't 0-0`);
  if (f.bttsSharePct != null) console.log(`  BTTS:          ${f.bttsSharePct}% of last 10 played matches had both teams scoring`);
  if (f.cleanSheetStreak != null && f.cleanSheetStreak >= 2) console.log(`  Clean sheets:  ${f.cleanSheetStreak}-game clean sheet streak`);
  if (f.scorelessStreak != null && f.scorelessStreak >= 2) console.log(`  Scoreless:     ${f.scorelessStreak}-game scoreless streak`);
}

function formSummaryMarkdown(f: FormSummary, lines: string[]) {
  if (f.last5Overall.length) lines.push(`- Last 5 (all): ${f.last5Overall.map(formResultStr).join(", ")}`);
  if (f.last5Home.length) lines.push(`- Last 5 (home): ${f.last5Home.map(formResultStr).join(", ")}`);
  if (f.last5Away.length) lines.push(`- Last 5 (away): ${f.last5Away.map(formResultStr).join(", ")}`);
  if (f.next5WithGaps.length) {
    lines.push(`- Next 5: ${f.next5WithGaps.map((g) => `${formatWhen(g.date)} vs ${g.opponent}${g.daysSincePrevious != null ? ` (+${g.daysSincePrevious}d rest)` : ""}`).join(" | ")}`);
  }
  if (f.gapsBetweenLastThree.length) lines.push(`- Gaps between last 3 matches: ${f.gapsBetweenLastThree.join(", ")} days`);
  if (f.halfSplit) lines.push(`- Half split: ${halfSplitStr(f.halfSplit)}`);
  if (f.recentCompetitions.length > 1) lines.push(`- Competitions played recently: ${f.recentCompetitions.join(" | ")} (${f.recentCompetitions.length})`);
  if (f.currentStreak) lines.push(`- Streak: ${f.currentStreak.count}-game ${f.currentStreak.result === "W" ? "winning" : f.currentStreak.result === "L" ? "losing" : "drawing"} streak`);
  if (f.homeWinRatePct != null || f.awayWinRatePct != null) lines.push(`- Win rate: Home ${f.homeWinRatePct ?? "n/a"}% / Away ${f.awayWinRatePct ?? "n/a"}%`);
  if (f.momentum) lines.push(`- Momentum: ${f.momentum.recentPPG} ppg (last 3) vs ${f.momentum.priorPPG} ppg (prior 3) -- ${f.momentum.trend}`);
  if (f.narrowWinSharePct != null) lines.push(`- Narrow wins: ${f.narrowWinSharePct}% of last 10 wins were tight and low-scoring (1-0, 2-1 style)`);
  if (f.scoringDrawSharePct != null) lines.push(`- Scoring draws: ${f.scoringDrawSharePct}% of last 10 draws weren't 0-0`);
  if (f.bttsSharePct != null) lines.push(`- BTTS: ${f.bttsSharePct}% of last 10 played matches had both teams scoring`);
  if (f.cleanSheetStreak != null && f.cleanSheetStreak >= 2) lines.push(`- Clean sheets: ${f.cleanSheetStreak}-game clean sheet streak`);
  if (f.scorelessStreak != null && f.scorelessStreak >= 2) lines.push(`- Scoreless: ${f.scorelessStreak}-game scoreless streak`);
}

function printMergedDetails(d: MergedMatch) {
  console.log(`  Next match: ${d.homeTeam} vs ${d.awayTeam}  [base: ${d.baseSource}]`);
  console.log(`    Kickoff:     ${formatWhen(d.kickoffUtc)}`);
  console.log(`    Competition: ${d.competition ?? "unknown"}`);
  console.log(`    Status:      ${d.status}`);
  const fs = d.fieldSources;
  if (d.venueName) console.log(`    Venue:       ${d.venueName}${d.venueCity ? `, ${d.venueCity}` : ""}${d.venueCountry ? `, ${d.venueCountry}` : ""}${via(fs, "venueName")}`);
  if (d.referee) {
    const rs = d.refereeStats;
    console.log(`    Referee:     ${d.referee}${rs ? ` (${rs.games} games, ${rs.yellowCards} yellow / ${rs.redCards} red, ${rs.yellowCardsPerGame} yellow/game)` : ""}${via(fs, "referee")}`);
  }
  if (d.attendance) console.log(`    Attendance:  ${d.attendance}${via(fs, "attendance")}`);
  if (d.weather) console.log(`    Weather:     ${d.weather}${via(fs, "weather")}`);
  if (d.headToHeadSummary) {
    const h = d.headToHeadSummary;
    console.log(`    H2H:         ${d.homeTeam} ${h.homeWins}W - ${h.draws}D - ${h.awayWins}W ${d.awayTeam}${via(fs, "headToHeadSummary")}`);
  }
  if (d.headToHeadStreaks?.length) console.log(`    H2H streaks: ${d.headToHeadStreaks.join("; ")}${via(fs, "headToHeadStreaks")}`);
  if (d.homeTeamStanding) {
    const s = d.homeTeamStanding;
    console.log(`    ${d.homeTeam} rank: #${s.position} (${s.points} pts, ${s.wins}W-${s.draws}D-${s.losses}L, ${s.goalDiff})${via(fs, "homeTeamStanding")}`);
  }
  if (d.awayTeamStanding) {
    const s = d.awayTeamStanding;
    console.log(`    ${d.awayTeam} rank: #${s.position} (${s.points} pts, ${s.wins}W-${s.draws}D-${s.losses}L, ${s.goalDiff})${via(fs, "awayTeamStanding")}`);
  }
  if (d.homeTeamSeasonStats) {
    const s = d.homeTeamSeasonStats;
    console.log(`    ${d.homeTeam} season: ${s.goalsScored} scored, ${s.goalsConceded} conceded, ${s.cleanSheets} clean sheets, ${s.yellowCards} yellow / ${s.redCards} red${s.averageBallPossession ? `, ${s.averageBallPossession}% avg possession` : ""}${via(fs, "homeTeamSeasonStats")}`);
  }
  if (d.awayTeamSeasonStats) {
    const s = d.awayTeamSeasonStats;
    console.log(`    ${d.awayTeam} season: ${s.goalsScored} scored, ${s.goalsConceded} conceded, ${s.cleanSheets} clean sheets, ${s.yellowCards} yellow / ${s.redCards} red${s.averageBallPossession ? `, ${s.averageBallPossession}% avg possession` : ""}${via(fs, "awayTeamSeasonStats")}`);
  }
  if (d.matchStats?.length) console.log(`    Match stats: ${d.matchStats.map((s) => `${s.name} ${s.home}-${s.away}`).join(", ")}${via(fs, "matchStats")}`);
  if (d.eventTimeline?.length) console.log(`    Timeline:    ${d.eventTimeline.map((e) => `${e.minute}' ${e.type}${e.player ? ` (${e.player})` : ""}`).join(", ")}${via(fs, "eventTimeline")}`);
  if (d.playerOfTheMatch) console.log(`    Player of the match: ${d.playerOfTheMatch.name}${d.playerOfTheMatch.rating ? ` (${d.playerOfTheMatch.rating})` : ""}${via(fs, "playerOfTheMatch")}`);
  if (d.homeFormation) console.log(`    ${d.homeTeam} formation: ${d.homeFormation}${via(fs, "homeFormation")}`);
  if (d.homeLineup?.length) console.log(`    ${d.homeTeam} lineup: ${d.homeLineup.map((p) => p.name).join(", ")}${via(fs, "homeLineup")}`);
  if (d.awayFormation) console.log(`    ${d.awayTeam} formation: ${d.awayFormation}${via(fs, "awayFormation")}`);
  if (d.awayLineup?.length) console.log(`    ${d.awayTeam} lineup: ${d.awayLineup.map((p) => p.name).join(", ")}${via(fs, "awayLineup")}`);
  if (d.homeManager || d.awayManager) {
    console.log(
      `    Managers:    ${d.homeTeam}: ${d.homeManager ? `${d.homeManager.name}${d.homeManager.country ? ` (${d.homeManager.country})` : ""}` : "unknown"} | ${d.awayTeam}: ${d.awayManager ? `${d.awayManager.name}${d.awayManager.country ? ` (${d.awayManager.country})` : ""}` : "unknown"} (via sofascore)`,
    );
  }
  if (d.homeManagerVsAwayClub?.sampleSize) {
    const r = d.homeManagerVsAwayClub;
    console.log(`    ${r.managerName} vs ${r.opponentClub} (his last ${r.sampleSize} meetings, any club he's managed): ${r.wins}W-${r.draws}D-${r.losses}L (via sofascore)`);
  }
  if (d.awayManagerVsHomeClub?.sampleSize) {
    const r = d.awayManagerVsHomeClub;
    console.log(`    ${r.managerName} vs ${r.opponentClub} (his last ${r.sampleSize} meetings, any club he's managed): ${r.wins}W-${r.draws}D-${r.losses}L (via sofascore)`);
  }
  if (d.note) console.log(`    Note (${d.baseSource}): ${d.note}`);
  for (const n of d.additionalNotes) console.log(`    Note (${n.source}): ${n.note}`);
  console.log(`    Source:      ${d.sourceUrl}`);
}

function printVenueDetails(v: VenueDetails) {
  console.log(
    `    Stadium: ${v.stadiumName}${v.capacity ? `, capacity ${v.capacity.toLocaleString()}` : ""}${v.opened ? `, opened ${v.opened}` : ""}${v.renovated ? `, renovated ${v.renovated}` : ""} (via stadiumdb)`,
  );
}

function performerStr(t: TopPerformer): string {
  const stat = t.goals && t.assists ? `${t.goals}g/${t.assists}a` : t.goals ? `${t.goals}g` : `${t.assists}a`;
  return `${t.name} (${stat} in ${t.appearances} apps${t.rating ? `, ${t.rating.toFixed(2)} avg rating` : ""})${t.source ? ` (via ${t.source})` : ""}`;
}

function defenderStr(d: TopDefender): string {
  return `${d.name} (${d.tacklesMade} tackles, ${d.interceptions} interceptions)`;
}

function printMergedProfile(p: MergedProfile) {
  const fs = p.fieldSources;
  console.log(`  Team profile (${p.teamName})  [base: ${p.baseSource}]:`);
  if (p.squad?.length) console.log(`    Squad (${p.squad.length}${p.averageAge ? `, avg age ${p.averageAge}` : ""}): ${p.squad.map((m) => m.name).join(", ")}${via(fs, "squad")}`);
  if (p.injuries?.length) console.log(`    Injuries: ${p.injuries.map((m) => `${m.name} - ${m.injury}`).join("; ")}${via(fs, "injuries")}`);
  else console.log(`    Injuries: none reported`);
  if (p.keyInjuries?.length) console.log(`    Key injuries (by squad value): ${p.keyInjuries.map((m) => m.name).join(", ")}${via(fs, "keyInjuries")}`);
  if (p.missingMidfielders?.length) console.log(`    Missing midfielders: ${p.missingMidfielders.join(", ")}`);
  if (p.recentTransfers?.length) {
    const shown = p.recentTransfers.slice(0, 5);
    console.log(`    Recent transfers: ${shown.map((t) => `${t.playerName} (${t.direction}${t.fromClub && t.toClub ? `, ${t.fromClub} -> ${t.toClub}` : ""})`).join("; ")}${p.recentTransfers.length > 5 ? ` (+${p.recentTransfers.length - 5} more)` : ""}${via(fs, "recentTransfers")}`);
  }
  const topScorers = computeTopPerformers(p.squad, "goals");
  const topAssists = computeTopPerformers(p.squad, "assists");
  if (topScorers.length) console.log(`    Top scorers: ${topScorers.map(performerStr).join(", ")}`);
  if (topAssists.length) console.log(`    Top assists: ${topAssists.map(performerStr).join(", ")}`);
  const topDefenders = computeTopDefenders(p.squad);
  if (topDefenders.length) console.log(`    Top defenders (via squawka): ${topDefenders.map(defenderStr).join(", ")}`);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function mergedMatchMarkdown(d: MergedMatch, lines: string[]) {
  lines.push(`**${d.homeTeam} vs ${d.awayTeam}** _(base: ${d.baseSource})_`, "");
  const fs = d.fieldSources;
  lines.push(`- Kickoff: ${formatWhen(d.kickoffUtc)}`);
  lines.push(`- Competition: ${d.competition ?? "unknown"}`);
  lines.push(`- Status: ${d.status}`);
  if (d.venueName) lines.push(`- Venue: ${d.venueName}${d.venueCity ? `, ${d.venueCity}` : ""}${d.venueCountry ? `, ${d.venueCountry}` : ""}${via(fs, "venueName")}`);
  if (d.referee) {
    const rs = d.refereeStats;
    lines.push(`- Referee: ${d.referee}${rs ? ` (${rs.games} games, ${rs.yellowCards} yellow / ${rs.redCards} red, ${rs.yellowCardsPerGame} yellow/game)` : ""}${via(fs, "referee")}`);
  }
  if (d.attendance) lines.push(`- Attendance: ${d.attendance}${via(fs, "attendance")}`);
  if (d.weather) lines.push(`- Weather: ${d.weather}${via(fs, "weather")}`);
  if (d.headToHeadSummary) {
    const h = d.headToHeadSummary;
    lines.push(`- H2H: ${d.homeTeam} ${h.homeWins}W - ${h.draws}D - ${h.awayWins}W ${d.awayTeam}${via(fs, "headToHeadSummary")}`);
  }
  if (d.headToHeadStreaks?.length) lines.push(`- H2H streaks: ${d.headToHeadStreaks.join("; ")}${via(fs, "headToHeadStreaks")}`);
  if (d.homeTeamStanding) {
    const s = d.homeTeamStanding;
    lines.push(`- ${d.homeTeam} rank: #${s.position} (${s.points} pts, ${s.wins}W-${s.draws}D-${s.losses}L, ${s.goalDiff})${via(fs, "homeTeamStanding")}`);
  }
  if (d.awayTeamStanding) {
    const s = d.awayTeamStanding;
    lines.push(`- ${d.awayTeam} rank: #${s.position} (${s.points} pts, ${s.wins}W-${s.draws}D-${s.losses}L, ${s.goalDiff})${via(fs, "awayTeamStanding")}`);
  }
  if (d.homeTeamSeasonStats) {
    const s = d.homeTeamSeasonStats;
    lines.push(`- ${d.homeTeam} season: ${s.goalsScored} scored, ${s.goalsConceded} conceded, ${s.cleanSheets} clean sheets, ${s.yellowCards} yellow / ${s.redCards} red${s.averageBallPossession ? `, ${s.averageBallPossession}% avg possession` : ""}${via(fs, "homeTeamSeasonStats")}`);
  }
  if (d.awayTeamSeasonStats) {
    const s = d.awayTeamSeasonStats;
    lines.push(`- ${d.awayTeam} season: ${s.goalsScored} scored, ${s.goalsConceded} conceded, ${s.cleanSheets} clean sheets, ${s.yellowCards} yellow / ${s.redCards} red${s.averageBallPossession ? `, ${s.averageBallPossession}% avg possession` : ""}${via(fs, "awayTeamSeasonStats")}`);
  }
  if (d.matchStats?.length) lines.push(`- Match stats: ${d.matchStats.map((s) => `${s.name} ${s.home}-${s.away}`).join(", ")}${via(fs, "matchStats")}`);
  if (d.eventTimeline?.length) lines.push(`- Timeline: ${d.eventTimeline.map((e) => `${e.minute}' ${e.type}${e.player ? ` (${e.player})` : ""}`).join(", ")}${via(fs, "eventTimeline")}`);
  if (d.playerOfTheMatch) lines.push(`- Player of the match: ${d.playerOfTheMatch.name}${d.playerOfTheMatch.rating ? ` (${d.playerOfTheMatch.rating})` : ""}${via(fs, "playerOfTheMatch")}`);
  if (d.homeFormation) lines.push(`- ${d.homeTeam} formation: ${d.homeFormation}${via(fs, "homeFormation")}`);
  if (d.homeLineup?.length) lines.push(`- ${d.homeTeam} lineup: ${d.homeLineup.map((p) => p.name).join(", ")}${via(fs, "homeLineup")}`);
  if (d.awayFormation) lines.push(`- ${d.awayTeam} formation: ${d.awayFormation}${via(fs, "awayFormation")}`);
  if (d.awayLineup?.length) lines.push(`- ${d.awayTeam} lineup: ${d.awayLineup.map((p) => p.name).join(", ")}${via(fs, "awayLineup")}`);
  if (d.homeManager || d.awayManager) {
    lines.push(
      `- Managers: ${d.homeTeam}: ${d.homeManager ? `${d.homeManager.name}${d.homeManager.country ? ` (${d.homeManager.country})` : ""}` : "unknown"} | ${d.awayTeam}: ${d.awayManager ? `${d.awayManager.name}${d.awayManager.country ? ` (${d.awayManager.country})` : ""}` : "unknown"} (via sofascore)`,
    );
  }
  if (d.homeManagerVsAwayClub?.sampleSize) {
    const r = d.homeManagerVsAwayClub;
    lines.push(`- ${r.managerName} vs ${r.opponentClub} (his last ${r.sampleSize} meetings, any club he's managed): ${r.wins}W-${r.draws}D-${r.losses}L (via sofascore)`);
  }
  if (d.awayManagerVsHomeClub?.sampleSize) {
    const r = d.awayManagerVsHomeClub;
    lines.push(`- ${r.managerName} vs ${r.opponentClub} (his last ${r.sampleSize} meetings, any club he's managed): ${r.wins}W-${r.draws}D-${r.losses}L (via sofascore)`);
  }
  if (d.note) lines.push(`- Note (${d.baseSource}): ${d.note}`);
  for (const n of d.additionalNotes) lines.push(`- Note (${n.source}): ${n.note}`);
  lines.push(`- Source: ${d.sourceUrl}`);
}

function venueDetailsMarkdown(v: VenueDetails, lines: string[]) {
  lines.push(
    `- Stadium: ${v.stadiumName}${v.capacity ? `, capacity ${v.capacity.toLocaleString()}` : ""}${v.opened ? `, opened ${v.opened}` : ""}${v.renovated ? `, renovated ${v.renovated}` : ""} (via stadiumdb)`,
  );
}

function mergedProfileMarkdown(p: MergedProfile, lines: string[]) {
  const fs = p.fieldSources;
  lines.push("", `**Team profile (${p.teamName})** _(base: ${p.baseSource})_`, "");
  if (p.squad?.length) lines.push(`- Squad (${p.squad.length}${p.averageAge ? `, avg age ${p.averageAge}` : ""}): ${p.squad.map((m) => m.name).join(", ")}${via(fs, "squad")}`);
  lines.push(`- Injuries: ${p.injuries?.length ? p.injuries.map((m) => `${m.name} - ${m.injury}`).join("; ") : "none reported"}${via(fs, "injuries")}`);
  if (p.keyInjuries?.length) lines.push(`- Key injuries (by squad value): ${p.keyInjuries.map((m) => m.name).join(", ")}${via(fs, "keyInjuries")}`);
  if (p.missingMidfielders?.length) lines.push(`- Missing midfielders: ${p.missingMidfielders.join(", ")}`);
  if (p.recentTransfers?.length) lines.push(`- Recent transfers: ${p.recentTransfers.map((t) => `${t.playerName} (${t.direction}${t.fromClub && t.toClub ? `, ${t.fromClub} -> ${t.toClub}` : ""})`).join("; ")}${via(fs, "recentTransfers")}`);
  const topScorers = computeTopPerformers(p.squad, "goals");
  const topAssists = computeTopPerformers(p.squad, "assists");
  if (topScorers.length) lines.push(`- Top scorers: ${topScorers.map(performerStr).join(", ")}`);
  if (topAssists.length) lines.push(`- Top assists: ${topAssists.map(performerStr).join(", ")}`);
  const topDefenders = computeTopDefenders(p.squad);
  if (topDefenders.length) lines.push(`- Top defenders (via squawka): ${topDefenders.map(defenderStr).join(", ")}`);
}

function zoneStr(z: StandingsZoneInfo, label: string): string {
  const stakes = z.pointsFromBoundary != null ? `, ${z.pointsFromBoundary}pts from nearest zone boundary${z.inTheMix ? " -- in the mix" : ""}` : "";
  return `${label}: #${z.position}/${z.totalTeams} (${z.zone}${stakes})`;
}

function cardStr(c: CardDisciplineInfo, label: string): string {
  return `${label}: ${c.yellowPerGame} yellow/game, ${c.redPerGame} red/game${c.elevatedRisk ? " (elevated risk)" : ""}`;
}

function cardDisciplineVenueSplitStr(s: CardDisciplineVenueSplit, label: string): string {
  const home = s.atHomeSampleSize ? `${s.atHomeYellowPerGame}Y/${s.atHomeRedPerGame}R (n=${s.atHomeSampleSize})` : "n/a";
  const away = s.awaySampleSize ? `${s.awayYellowPerGame}Y/${s.awayRedPerGame}R (n=${s.awaySampleSize})` : "n/a";
  return `${label} card discipline by venue (last 5, ${s.source}): at home ${home} / away ${away}`;
}

function travelStr(t: TravelInfo, homeTeam: string, awayTeam: string): string {
  const side = (traveling: boolean | null, team: string, country: string | null, km: number | null) => {
    if (traveling == null) return `${team}: unknown`;
    if (!traveling) return `${team} at home turf (${country})`;
    return `${team} traveling (${country} -> ${t.venueCountry}${km != null ? `, ~${km.toLocaleString()}km` : ""})`;
  };
  return `Travel: ${side(t.homeTraveling, homeTeam, t.homeTeamCountry, t.homeTravelDistanceKm)}; ${side(t.awayTraveling, awayTeam, t.awayTeamCountry, t.awayTravelDistanceKm)}`;
}

function rankRecordStr(r: OpponentRankRecord, label: string): string {
  return `${label} vs currently-higher-ranked opponents (same competition): ${r.wins}W-${r.draws}D-${r.losses}L (n=${r.sampleSize})`;
}

function presenceStr(p: PresenceEntry[], label: string): string {
  const present = p.filter((e) => e.status === "P");
  const absent = p.filter((e) => e.status === "A");
  const starting = present.filter((e) => e.starting).length;
  const absentList = absent.length ? `: ${absent.map((e) => `${e.name} (${e.reason})`).join(", ")}` : "";
  return `${label} availability: ${present.length} present (${starting} starting), ${absent.length} absent${absentList}`;
}

const RESULT_WORD: Record<"W" | "D" | "L", string> = { W: "a win", D: "a draw", L: "a loss" };

function rotationStr(r: RotationInfo, label: string): string {
  const trigger = r.precedingResult ? ` after ${RESULT_WORD[r.precedingResult]}` : "";
  const base = `${label} rotation${trigger}: ${r.changedPlayers}/${r.startingXISize} starting XI changed from the previous match (${r.previousMatchDate?.slice(0, 10) ?? "?"} -> ${r.lastMatchDate?.slice(0, 10) ?? "?"})`;
  if (!r.previousFormation || !r.lastFormation) return base;
  const shape = r.formationChanged
    ? `shape changed ${r.previousFormation} -> ${r.lastFormation}${r.lastDefenderCount != null && r.previousDefenderCount != null && r.lastDefenderCount !== r.previousDefenderCount ? ` (${r.previousDefenderCount} -> ${r.lastDefenderCount} defenders)` : ""}`
    : `shape unchanged (${r.lastFormation})`;
  return `${base}, ${shape}`;
}

function resilienceStr(r: ResilienceInfo, label: string): string {
  return `${label} resilience: ${r.drawSharePct}% of non-win results (n=${r.nonWinSampleSize}) were draws rather than losses`;
}

function restPerformanceStr(r: RestPerformanceInfo, label: string): string {
  const short = r.shortRestPPG != null ? `${r.shortRestPPG} ppg (n=${r.shortRestSampleSize})` : "n/a";
  const long = r.longRestPPG != null ? `${r.longRestPPG} ppg (n=${r.longRestSampleSize})` : "n/a";
  return `${label} performance by rest: <=3 days rest ${short} vs longer rest ${long}`;
}

function experienceH2HStr(e: ExperienceH2HNote): string {
  if (e.aligned == null) return `Experience/H2H: more experienced squad is "${e.moreExperienced}", h2h leader is "${e.h2hLeader}" -- not directly comparable (one side is even)`;
  return `Experience/H2H: more experienced squad (${e.moreExperienced}) ${e.aligned ? "also holds" : "does not hold"} the head-to-head edge`;
}

function fatigueFlagStr(f: FatigueFlag, label: string): string {
  return `${label} fatigue risk: ${f.flagged ? "elevated" : "normal"} (${f.competitions.length} competitions recently, ${f.avgGapDays ?? "n/a"}d avg gap between last 3)`;
}

function homeAdvantageStr(h: HomeAdvantageInfo, label: string): string {
  return `${label} home advantage: ${h.strength} (home ${h.homeWinRatePct}% / away ${h.awayWinRatePct}% win rate, ${h.gapPct! >= 0 ? "+" : ""}${h.gapPct}pp)`;
}

function streakStabilityStr(s: StreakStabilityInfo, label: string): string {
  if (s.streakResult !== "W" || s.streakCount < 2) return `${label} streak: ${s.streakCount}-game ${s.streakResult === "W" ? "winning" : s.streakResult === "L" ? "losing" : "drawing"} run`;
  const stability = s.stable == null ? "unknown (no rotation data)" : s.stable ? "stable XI" : "rotated XI";
  return `${label} streak: ${s.streakCount}-game winning run, ${stability}${s.changedPlayers != null ? ` (${s.changedPlayers} changes since previous match)` : ""}`;
}

function losingStreakContextStr(l: LosingStreakContextInfo, teamName: string): string {
  const xg = l.xgDelta != null ? `${l.xgDelta >= 0 ? "+" : ""}${l.xgDelta} actual-vs-xG` : "xG data unavailable";
  return `${teamName} losing streak context: ${l.streakCount} games, ${xg}${l.potentialTurnaround ? " -- underperforming their chances, potential turnaround" : ""}`;
}

function xgEstimateStr(x: SeasonXGEstimate, label: string): string {
  return `${label} xG estimate (last ${x.sampleSize} finished, ${x.source}): ${x.xgFor} xGF / ${x.xgAgainst} xGA vs actual ${x.actualGoalsFor}-${x.actualGoalsAgainst}`;
}

function shotsEstimateStr(x: SeasonShotsEstimate, label: string): string {
  return `${label} shots estimate (last ${x.sampleSize} finished, ${x.source}): ${x.shotsFor} shots for (${x.shotsOnTargetFor} on target) / ${x.shotsAgainst} against (${x.shotsOnTargetAgainst} on target)`;
}

function aerialEstimateStr(x: SeasonAerialEstimate, label: string): string {
  return `${label} aerial duels (last ${x.sampleSize} finished, ${x.source}): ${x.aerialDuelsWonFor} won / ${x.aerialDuelsWonAgainst} lost`;
}

function bigChancesEstimateStr(x: SeasonBigChancesEstimate, label: string): string {
  return `${label} big chances (last ${x.sampleSize} finished, ${x.source}): ${x.bigChancesCreatedFor} created (${x.bigChancesMissedFor} missed) / ${x.bigChancesCreatedAgainst} conceded (${x.bigChancesMissedAgainst} missed by opponent)`;
}

function passingStyleStr(x: SeasonPassingStyleEstimate, label: string): string {
  return `${label} passing style (last ${x.sampleSize} finished, ${x.source}): ${x.passAccuracyPct ?? "n/a"}% pass accuracy, ${x.longBallSharePct ?? "n/a"}% of accurate passes were long balls`;
}

function foulsEstimateStr(x: SeasonFoulsEstimate, label: string): string {
  return `${label} fouls estimate (last ${x.sampleSize} finished, ${x.source}): ${x.foulsCommittedFor} committed / ${x.foulsCommittedAgainst} suffered`;
}

function goalkeepingEstimateStr(x: SeasonGoalkeepingEstimate, label: string): string {
  return `${label} goalkeeping estimate (last ${x.sampleSize} finished, ${x.source}): ${x.savesFor} saves on ${x.shotsOnTargetFaced} shots faced (${x.savePct ?? "n/a"}% save rate), ${x.goalsConceded} conceded`;
}

function setPieceThreatStr(f: SetPieceThreatFlag, label: string): string {
  return `${label} set-piece threat: ${f.cornersPerGame ?? "n/a"} corners/game vs opponent's ${f.opponentAerialWinPct ?? "n/a"}% aerial win rate${f.elevated ? " -- elevated" : ""}`;
}

function directPlayExposureStr(f: DirectPlayExposureFlag, label: string): string {
  return `${label} direct-play exposure: ${f.longBallSharePct ?? "n/a"}% long-ball share vs opponent's ${f.opponentAerialWinPct ?? "n/a"}% aerial win rate${f.elevated ? " -- elevated" : ""}`;
}

function cardRisksStr(risks: PlayerCardRisk[], label: string): string {
  const list = risks.map((r) => `${r.name} (${r.yellowCards}Y${r.redCards ? `/${r.redCards}R` : ""}${r.priorDismissal ? ", prior dismissal" : ""})`).join(", ");
  return `${label} card risk: ${list}`;
}

function refereeCardRiskNoteStr(n: RefereeCardRiskNote, homeTeam: string, awayTeam: string): string {
  const list = n.flaggedPlayers.map((p) => `${p.name} (${p.side === "home" ? homeTeam : awayTeam}${p.priorDismissal ? ", prior dismissal" : ""})`).join(", ");
  return `Referee ${n.refereeName} books ${n.yellowCardsPerGame} yellow/game${n.elevatedCardReferee ? " (elevated)" : ""} -- already-flagged players: ${list}`;
}

function duelVulnerabilitiesStr(vulns: DuelVulnerability[], label: string): string {
  const list = vulns.map((v) => `${v.name} (${v.groundDuelSuccessPct.toFixed(1)}% ground duels won)`).join(", ");
  return `${label} defensive duel risk (via squawka): ${list}`;
}

function fullbackExposureStr(exposure: FullbackExposureInfo[], label: string): string {
  const list = exposure.map((e) => `${e.name} (${e.chancesCreated} chances created, ${e.groundDuelSuccessPct.toFixed(1)}% ground duels won)`).join(", ");
  return `${label} attacking-defender exposure (via squawka): ${list}`;
}

function standingsImpactStr(s: StandingsImpactInfo, label: string): string {
  const parts = s.scenarios.map((sc) => {
    const delta = sc.newPosition != null ? sc.newPosition - s.currentPosition : null;
    const arrow = delta == null ? "" : delta < 0 ? ` (up ${-delta})` : delta > 0 ? ` (down ${delta})` : " (no change)";
    return `${sc.outcome}: #${sc.newPosition ?? "?"}${arrow}`;
  });
  return `${label} new standing if: ${parts.join(", ")} (currently #${s.currentPosition}, ${s.currentPoints}pts)`;
}

function possessionMatchupStr(p: PossessionMatchupInfo, teamName: string): string {
  const high = p.highOpponentPossessionPPG != null ? `${p.highOpponentPossessionPPG} ppg (n=${p.highOpponentPossessionSampleSize})` : "n/a";
  const other = p.otherPPG != null ? `${p.otherPPG} ppg (n=${p.otherSampleSize})` : "n/a";
  return `${teamName} vs high-possession opponents (>=55%): ${high} vs other opponents: ${other}`;
}

function cornersEstimateStr(x: SeasonCornersEstimate, label: string): string {
  return `${label} corners estimate (last ${x.sampleSize} finished, ${x.source}): ${x.cornersFor} for / ${x.cornersAgainst} against`;
}

function defensiveErrorsEstimateStr(x: SeasonDefensiveErrorsEstimate, label: string): string {
  return `${label} defensive errors (last ${x.sampleSize} published, ${x.source}): ${x.defensiveErrorsFor} for / ${x.defensiveErrorsAgainst} against`;
}

// Same <=3 day threshold used for RestPerformanceInfo's "short rest" bucket
// and FatigueFlag's "tight schedule" -- labels the gap before THIS match,
// not a historical bucket.
function restLabel(days: number | null): string {
  return days != null && days <= 3 ? " (short rest)" : "";
}

function printInsights(insights: MatchInsights, homeTeam: string, awayTeam: string) {
  console.log("  Insights (rule-based, see README for thresholds):");
  if (insights.restComparison) {
    const r = insights.restComparison;
    console.log(
      `    Rest: own ${r.ownRestDays ?? "n/a"}d${restLabel(r.ownRestDays)} / opponent ${r.opponentRestDays ?? "n/a"}d${restLabel(r.opponentRestDays)}${r.moreRested ? ` -- ${r.moreRested === "even" ? "even" : `${r.moreRested} team more rested`}` : ""}`,
    );
  }
  if (insights.experienceComparison) {
    const e = insights.experienceComparison;
    console.log(`    Experience: own avg age ${e.ownAverageAge ?? "n/a"} / opponent ${e.opponentAverageAge ?? "n/a"}${e.moreExperienced ? ` -- ${e.moreExperienced === "even" ? "even" : `${e.moreExperienced} squad older`}` : ""}`);
  }
  if (insights.homeStandingsZone) console.log(`    ${zoneStr(insights.homeStandingsZone, homeTeam)}`);
  if (insights.awayStandingsZone) console.log(`    ${zoneStr(insights.awayStandingsZone, awayTeam)}`);
  if (insights.homeCardDiscipline) console.log(`    ${cardStr(insights.homeCardDiscipline, homeTeam)}`);
  if (insights.awayCardDiscipline) console.log(`    ${cardStr(insights.awayCardDiscipline, awayTeam)}`);
  if (insights.homeCardDisciplineVenueSplit) console.log(`    ${cardDisciplineVenueSplitStr(insights.homeCardDisciplineVenueSplit, homeTeam)}`);
  if (insights.awayCardDisciplineVenueSplit) console.log(`    ${cardDisciplineVenueSplitStr(insights.awayCardDisciplineVenueSplit, awayTeam)}`);
  if (insights.homeXgEstimate) console.log(`    ${xgEstimateStr(insights.homeXgEstimate, homeTeam)}`);
  if (insights.awayXgEstimate) console.log(`    ${xgEstimateStr(insights.awayXgEstimate, awayTeam)}`);
  if (insights.homeShotsEstimate) console.log(`    ${shotsEstimateStr(insights.homeShotsEstimate, homeTeam)}`);
  if (insights.awayShotsEstimate) console.log(`    ${shotsEstimateStr(insights.awayShotsEstimate, awayTeam)}`);
  if (insights.homeAerialEstimate) console.log(`    ${aerialEstimateStr(insights.homeAerialEstimate, homeTeam)}`);
  if (insights.awayAerialEstimate) console.log(`    ${aerialEstimateStr(insights.awayAerialEstimate, awayTeam)}`);
  if (insights.homeBigChancesEstimate) console.log(`    ${bigChancesEstimateStr(insights.homeBigChancesEstimate, homeTeam)}`);
  if (insights.awayBigChancesEstimate) console.log(`    ${bigChancesEstimateStr(insights.awayBigChancesEstimate, awayTeam)}`);
  if (insights.homePassingStyle) console.log(`    ${passingStyleStr(insights.homePassingStyle, homeTeam)}`);
  if (insights.awayPassingStyle) console.log(`    ${passingStyleStr(insights.awayPassingStyle, awayTeam)}`);
  if (insights.homeFoulsEstimate) console.log(`    ${foulsEstimateStr(insights.homeFoulsEstimate, homeTeam)}`);
  if (insights.awayFoulsEstimate) console.log(`    ${foulsEstimateStr(insights.awayFoulsEstimate, awayTeam)}`);
  if (insights.homeGoalkeepingEstimate) console.log(`    ${goalkeepingEstimateStr(insights.homeGoalkeepingEstimate, homeTeam)}`);
  if (insights.awayGoalkeepingEstimate) console.log(`    ${goalkeepingEstimateStr(insights.awayGoalkeepingEstimate, awayTeam)}`);
  if (insights.homeSetPieceThreat) console.log(`    ${setPieceThreatStr(insights.homeSetPieceThreat, homeTeam)}`);
  if (insights.awaySetPieceThreat) console.log(`    ${setPieceThreatStr(insights.awaySetPieceThreat, awayTeam)}`);
  if (insights.homeDirectPlayExposure) console.log(`    ${directPlayExposureStr(insights.homeDirectPlayExposure, homeTeam)}`);
  if (insights.awayDirectPlayExposure) console.log(`    ${directPlayExposureStr(insights.awayDirectPlayExposure, awayTeam)}`);
  if (insights.travelInfo) console.log(`    ${travelStr(insights.travelInfo, homeTeam, awayTeam)}`);
  if (insights.homeOpponentRankRecord) console.log(`    ${rankRecordStr(insights.homeOpponentRankRecord, homeTeam)}`);
  if (insights.awayOpponentRankRecord) console.log(`    ${rankRecordStr(insights.awayOpponentRankRecord, awayTeam)}`);
  if (insights.homeRotation) console.log(`    ${rotationStr(insights.homeRotation, homeTeam)}`);
  if (insights.awayRotation) console.log(`    ${rotationStr(insights.awayRotation, awayTeam)}`);
  if (insights.homePresence) console.log(`    ${presenceStr(insights.homePresence, homeTeam)}`);
  if (insights.awayPresence) console.log(`    ${presenceStr(insights.awayPresence, awayTeam)}`);
  if (insights.homeResilience) console.log(`    ${resilienceStr(insights.homeResilience, homeTeam)}`);
  if (insights.awayResilience) console.log(`    ${resilienceStr(insights.awayResilience, awayTeam)}`);
  if (insights.homeRestPerformance) console.log(`    ${restPerformanceStr(insights.homeRestPerformance, homeTeam)}`);
  if (insights.awayRestPerformance) console.log(`    ${restPerformanceStr(insights.awayRestPerformance, awayTeam)}`);
  if (insights.experienceH2H) console.log(`    ${experienceH2HStr(insights.experienceH2H)}`);
  if (insights.homeFatigueFlag) console.log(`    ${fatigueFlagStr(insights.homeFatigueFlag, homeTeam)}`);
  if (insights.awayFatigueFlag) console.log(`    ${fatigueFlagStr(insights.awayFatigueFlag, awayTeam)}`);
  if (insights.homeAdvantage) console.log(`    ${homeAdvantageStr(insights.homeAdvantage, homeTeam)}`);
  if (insights.awayAdvantage) console.log(`    ${homeAdvantageStr(insights.awayAdvantage, awayTeam)}`);
  if (insights.homeStreakStability) console.log(`    ${streakStabilityStr(insights.homeStreakStability, homeTeam)}`);
  if (insights.awayStreakStability) console.log(`    ${streakStabilityStr(insights.awayStreakStability, awayTeam)}`);
  if (insights.homeLosingStreakContext) console.log(`    ${losingStreakContextStr(insights.homeLosingStreakContext, homeTeam)}`);
  if (insights.awayLosingStreakContext) console.log(`    ${losingStreakContextStr(insights.awayLosingStreakContext, awayTeam)}`);
  if (insights.homeCardRisks?.length) console.log(`    ${cardRisksStr(insights.homeCardRisks, homeTeam)}`);
  if (insights.awayCardRisks?.length) console.log(`    ${cardRisksStr(insights.awayCardRisks, awayTeam)}`);
  if (insights.refereeCardRiskNote) console.log(`    ${refereeCardRiskNoteStr(insights.refereeCardRiskNote, homeTeam, awayTeam)}`);
  if (insights.homeDuelVulnerabilities?.length) console.log(`    ${duelVulnerabilitiesStr(insights.homeDuelVulnerabilities, homeTeam)}`);
  if (insights.awayDuelVulnerabilities?.length) console.log(`    ${duelVulnerabilitiesStr(insights.awayDuelVulnerabilities, awayTeam)}`);
  if (insights.homePossessionMatchup) console.log(`    ${possessionMatchupStr(insights.homePossessionMatchup, homeTeam)}`);
  if (insights.awayPossessionMatchup) console.log(`    ${possessionMatchupStr(insights.awayPossessionMatchup, awayTeam)}`);
  if (insights.homeCornersEstimate) console.log(`    ${cornersEstimateStr(insights.homeCornersEstimate, homeTeam)}`);
  if (insights.awayCornersEstimate) console.log(`    ${cornersEstimateStr(insights.awayCornersEstimate, awayTeam)}`);
  if (insights.homeDefensiveErrorsEstimate) console.log(`    ${defensiveErrorsEstimateStr(insights.homeDefensiveErrorsEstimate, homeTeam)}`);
  if (insights.awayDefensiveErrorsEstimate) console.log(`    ${defensiveErrorsEstimateStr(insights.awayDefensiveErrorsEstimate, awayTeam)}`);
  if (insights.homeFullbackExposure?.length) console.log(`    ${fullbackExposureStr(insights.homeFullbackExposure, homeTeam)}`);
  if (insights.awayFullbackExposure?.length) console.log(`    ${fullbackExposureStr(insights.awayFullbackExposure, awayTeam)}`);
  if (insights.homeStandingsImpact) console.log(`    ${standingsImpactStr(insights.homeStandingsImpact, homeTeam)}`);
  if (insights.awayStandingsImpact) console.log(`    ${standingsImpactStr(insights.awayStandingsImpact, awayTeam)}`);
  if (insights.opponentContextError) console.log(`    (opponent lookup issue: ${insights.opponentContextError})`);
}

function insightsMarkdown(insights: MatchInsights, homeTeam: string, awayTeam: string, lines: string[]) {
  lines.push("", "**Insights** _(rule-based, see README for thresholds)_", "");
  if (insights.restComparison) {
    const r = insights.restComparison;
    lines.push(
      `- Rest: own ${r.ownRestDays ?? "n/a"}d${restLabel(r.ownRestDays)} / opponent ${r.opponentRestDays ?? "n/a"}d${restLabel(r.opponentRestDays)}${r.moreRested ? ` -- ${r.moreRested === "even" ? "even" : `${r.moreRested} team more rested`}` : ""}`,
    );
  }
  if (insights.experienceComparison) {
    const e = insights.experienceComparison;
    lines.push(`- Experience: own avg age ${e.ownAverageAge ?? "n/a"} / opponent ${e.opponentAverageAge ?? "n/a"}${e.moreExperienced ? ` -- ${e.moreExperienced === "even" ? "even" : `${e.moreExperienced} squad older`}` : ""}`);
  }
  if (insights.homeStandingsZone) lines.push(`- ${zoneStr(insights.homeStandingsZone, homeTeam)}`);
  if (insights.awayStandingsZone) lines.push(`- ${zoneStr(insights.awayStandingsZone, awayTeam)}`);
  if (insights.homeCardDiscipline) lines.push(`- ${cardStr(insights.homeCardDiscipline, homeTeam)}`);
  if (insights.awayCardDiscipline) lines.push(`- ${cardStr(insights.awayCardDiscipline, awayTeam)}`);
  if (insights.homeCardDisciplineVenueSplit) lines.push(`- ${cardDisciplineVenueSplitStr(insights.homeCardDisciplineVenueSplit, homeTeam)}`);
  if (insights.awayCardDisciplineVenueSplit) lines.push(`- ${cardDisciplineVenueSplitStr(insights.awayCardDisciplineVenueSplit, awayTeam)}`);
  if (insights.homeXgEstimate) lines.push(`- ${xgEstimateStr(insights.homeXgEstimate, homeTeam)}`);
  if (insights.awayXgEstimate) lines.push(`- ${xgEstimateStr(insights.awayXgEstimate, awayTeam)}`);
  if (insights.homeShotsEstimate) lines.push(`- ${shotsEstimateStr(insights.homeShotsEstimate, homeTeam)}`);
  if (insights.awayShotsEstimate) lines.push(`- ${shotsEstimateStr(insights.awayShotsEstimate, awayTeam)}`);
  if (insights.homeAerialEstimate) lines.push(`- ${aerialEstimateStr(insights.homeAerialEstimate, homeTeam)}`);
  if (insights.awayAerialEstimate) lines.push(`- ${aerialEstimateStr(insights.awayAerialEstimate, awayTeam)}`);
  if (insights.homeBigChancesEstimate) lines.push(`- ${bigChancesEstimateStr(insights.homeBigChancesEstimate, homeTeam)}`);
  if (insights.awayBigChancesEstimate) lines.push(`- ${bigChancesEstimateStr(insights.awayBigChancesEstimate, awayTeam)}`);
  if (insights.homePassingStyle) lines.push(`- ${passingStyleStr(insights.homePassingStyle, homeTeam)}`);
  if (insights.awayPassingStyle) lines.push(`- ${passingStyleStr(insights.awayPassingStyle, awayTeam)}`);
  if (insights.homeFoulsEstimate) lines.push(`- ${foulsEstimateStr(insights.homeFoulsEstimate, homeTeam)}`);
  if (insights.awayFoulsEstimate) lines.push(`- ${foulsEstimateStr(insights.awayFoulsEstimate, awayTeam)}`);
  if (insights.homeGoalkeepingEstimate) lines.push(`- ${goalkeepingEstimateStr(insights.homeGoalkeepingEstimate, homeTeam)}`);
  if (insights.awayGoalkeepingEstimate) lines.push(`- ${goalkeepingEstimateStr(insights.awayGoalkeepingEstimate, awayTeam)}`);
  if (insights.homeSetPieceThreat) lines.push(`- ${setPieceThreatStr(insights.homeSetPieceThreat, homeTeam)}`);
  if (insights.awaySetPieceThreat) lines.push(`- ${setPieceThreatStr(insights.awaySetPieceThreat, awayTeam)}`);
  if (insights.homeDirectPlayExposure) lines.push(`- ${directPlayExposureStr(insights.homeDirectPlayExposure, homeTeam)}`);
  if (insights.awayDirectPlayExposure) lines.push(`- ${directPlayExposureStr(insights.awayDirectPlayExposure, awayTeam)}`);
  if (insights.travelInfo) lines.push(`- ${travelStr(insights.travelInfo, homeTeam, awayTeam)}`);
  if (insights.homeOpponentRankRecord) lines.push(`- ${rankRecordStr(insights.homeOpponentRankRecord, homeTeam)}`);
  if (insights.awayOpponentRankRecord) lines.push(`- ${rankRecordStr(insights.awayOpponentRankRecord, awayTeam)}`);
  if (insights.homeRotation) lines.push(`- ${rotationStr(insights.homeRotation, homeTeam)}`);
  if (insights.awayRotation) lines.push(`- ${rotationStr(insights.awayRotation, awayTeam)}`);
  if (insights.homePresence) lines.push(`- ${presenceStr(insights.homePresence, homeTeam)}`);
  if (insights.awayPresence) lines.push(`- ${presenceStr(insights.awayPresence, awayTeam)}`);
  if (insights.homeResilience) lines.push(`- ${resilienceStr(insights.homeResilience, homeTeam)}`);
  if (insights.awayResilience) lines.push(`- ${resilienceStr(insights.awayResilience, awayTeam)}`);
  if (insights.homeRestPerformance) lines.push(`- ${restPerformanceStr(insights.homeRestPerformance, homeTeam)}`);
  if (insights.awayRestPerformance) lines.push(`- ${restPerformanceStr(insights.awayRestPerformance, awayTeam)}`);
  if (insights.experienceH2H) lines.push(`- ${experienceH2HStr(insights.experienceH2H)}`);
  if (insights.homeFatigueFlag) lines.push(`- ${fatigueFlagStr(insights.homeFatigueFlag, homeTeam)}`);
  if (insights.awayFatigueFlag) lines.push(`- ${fatigueFlagStr(insights.awayFatigueFlag, awayTeam)}`);
  if (insights.homeAdvantage) lines.push(`- ${homeAdvantageStr(insights.homeAdvantage, homeTeam)}`);
  if (insights.awayAdvantage) lines.push(`- ${homeAdvantageStr(insights.awayAdvantage, awayTeam)}`);
  if (insights.homeStreakStability) lines.push(`- ${streakStabilityStr(insights.homeStreakStability, homeTeam)}`);
  if (insights.awayStreakStability) lines.push(`- ${streakStabilityStr(insights.awayStreakStability, awayTeam)}`);
  if (insights.homeLosingStreakContext) lines.push(`- ${losingStreakContextStr(insights.homeLosingStreakContext, homeTeam)}`);
  if (insights.awayLosingStreakContext) lines.push(`- ${losingStreakContextStr(insights.awayLosingStreakContext, awayTeam)}`);
  if (insights.homeCardRisks?.length) lines.push(`- ${cardRisksStr(insights.homeCardRisks, homeTeam)}`);
  if (insights.awayCardRisks?.length) lines.push(`- ${cardRisksStr(insights.awayCardRisks, awayTeam)}`);
  if (insights.refereeCardRiskNote) lines.push(`- ${refereeCardRiskNoteStr(insights.refereeCardRiskNote, homeTeam, awayTeam)}`);
  if (insights.homeDuelVulnerabilities?.length) lines.push(`- ${duelVulnerabilitiesStr(insights.homeDuelVulnerabilities, homeTeam)}`);
  if (insights.awayDuelVulnerabilities?.length) lines.push(`- ${duelVulnerabilitiesStr(insights.awayDuelVulnerabilities, awayTeam)}`);
  if (insights.homePossessionMatchup) lines.push(`- ${possessionMatchupStr(insights.homePossessionMatchup, homeTeam)}`);
  if (insights.awayPossessionMatchup) lines.push(`- ${possessionMatchupStr(insights.awayPossessionMatchup, awayTeam)}`);
  if (insights.homeCornersEstimate) lines.push(`- ${cornersEstimateStr(insights.homeCornersEstimate, homeTeam)}`);
  if (insights.awayCornersEstimate) lines.push(`- ${cornersEstimateStr(insights.awayCornersEstimate, awayTeam)}`);
  if (insights.homeDefensiveErrorsEstimate) lines.push(`- ${defensiveErrorsEstimateStr(insights.homeDefensiveErrorsEstimate, homeTeam)}`);
  if (insights.awayDefensiveErrorsEstimate) lines.push(`- ${defensiveErrorsEstimateStr(insights.awayDefensiveErrorsEstimate, awayTeam)}`);
  if (insights.homeFullbackExposure?.length) lines.push(`- ${fullbackExposureStr(insights.homeFullbackExposure, homeTeam)}`);
  if (insights.awayFullbackExposure?.length) lines.push(`- ${fullbackExposureStr(insights.awayFullbackExposure, awayTeam)}`);
  if (insights.homeStandingsImpact) lines.push(`- ${standingsImpactStr(insights.homeStandingsImpact, homeTeam)}`);
  if (insights.awayStandingsImpact) lines.push(`- ${standingsImpactStr(insights.awayStandingsImpact, awayTeam)}`);
  if (insights.opponentContextError) lines.push(`- (opponent lookup issue: ${insights.opponentContextError})`);
}

interface SeasonMatchStatsEstimate {
  xg: SeasonXGEstimate | null;
  shots: SeasonShotsEstimate | null;
  cardSplit: CardDisciplineVenueSplit | null;
  aerial: SeasonAerialEstimate | null;
  bigChances: SeasonBigChancesEstimate | null;
  passingStyle: SeasonPassingStyleEstimate | null;
  fouls: SeasonFoulsEstimate | null;
  goalkeeping: SeasonGoalkeepingEstimate | null;
}

// Fotmob stat values are sometimes plain integers ("3") and sometimes
// "count (%)" strings ("21 (58%)") -- parseInt stops at the first
// non-digit character either way, so this handles both without needing to
// know which shape a given stat name uses.
function parseLeadingInt(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

// Fotmob's per-match stats include "Expected goals (xG)", "Total shots",
// "Shots on target", "Yellow cards", "Red cards", "Aerial duels won", "Big
// chances", "Big chances missed", "Passes", "Accurate passes", and
// "Accurate long balls" (all confirmed field names from real data), but
// there's no season-aggregate endpoint for any of them on any of the 5
// sources (checked twice for xG specifically). This builds real aggregates
// ourselves from the last 5 *finished* Fotmob matches -- one fetch loop
// derives all six, still just reusing getFotmobMatchDetails, no new
// endpoint. 5 plain HTTP requests total (cheap; Fotmob needs no browser),
// same cost as the xG estimate alone used to be -- everything else here is
// a free addition on top. Real gotcha caught during testing: "Passes"
// appears TWICE in Fotmob's stats array, the first occurrence with empty
// `home`/`away` strings (a placeholder/header row) and the second with the
// actual total -- naively using .find() would silently grab the empty one,
// so this explicitly skips empty values.
async function computeSeasonMatchStatsEstimate(teamName: string, fotmobMatches: MatchInfo[]): Promise<SeasonMatchStatsEstimate> {
  const finished = fotmobMatches
    .filter((m) => m.status === "finished" && m.kickoffUtc)
    .sort((a, b) => new Date(b.kickoffUtc!).getTime() - new Date(a.kickoffUtc!).getTime())
    .slice(0, 5);
  if (!finished.length) return { xg: null, shots: null, cardSplit: null, aerial: null, bigChances: null, passingStyle: null, fouls: null, goalkeeping: null };

  let xgFor = 0, xgAgainst = 0, goalsFor = 0, goalsAgainst = 0, xgSampleSize = 0;
  let shotsFor = 0, shotsAgainst = 0, sotFor = 0, sotAgainst = 0, shotsSampleSize = 0;
  let savesFor = 0, shotsOnTargetFaced = 0, keeperGoalsConceded = 0, keeperSampleSize = 0;
  let atHomeYellow = 0, atHomeRed = 0, atHomeSampleSize = 0;
  let awayYellow = 0, awayRed = 0, awaySampleSize = 0;
  let aerialFor = 0, aerialAgainst = 0, aerialSampleSize = 0;
  let chancesCreatedFor = 0, chancesCreatedAgainst = 0, chancesMissedFor = 0, chancesMissedAgainst = 0, bigChancesSampleSize = 0;
  let totalPassesFor = 0, accuratePassesFor = 0, accurateLongBallsFor = 0, passingSampleSize = 0;
  let foulsFor = 0, foulsAgainst = 0, foulsSampleSize = 0;

  for (const m of finished) {
    const home = isTeamHome(m, teamName);
    if (home === null) continue;
    try {
      const details = await getFotmobMatchDetails(m);

      const xgStat = details.matchStats?.find((s) => s.name === "Expected goals (xG)");
      if (xgStat) {
        xgFor += Number(home ? xgStat.home : xgStat.away);
        xgAgainst += Number(home ? xgStat.away : xgStat.home);
        goalsFor += home ? m.homeScore! : m.awayScore!;
        goalsAgainst += home ? m.awayScore! : m.homeScore!;
        xgSampleSize++;
      }

      const shotsStat = details.matchStats?.find((s) => s.name === "Total shots");
      const sotStat = details.matchStats?.find((s) => s.name === "Shots on target");
      if (shotsStat && sotStat) {
        const sotAgainstThisMatch = Number(home ? sotStat.away : sotStat.home);
        shotsFor += Number(home ? shotsStat.home : shotsStat.away);
        shotsAgainst += Number(home ? shotsStat.away : shotsStat.home);
        sotFor += Number(home ? sotStat.home : sotStat.away);
        sotAgainst += sotAgainstThisMatch;
        shotsSampleSize++;

        const keeperStat = details.matchStats?.find((s) => s.name === "Keeper saves");
        if (keeperStat) {
          savesFor += Number(home ? keeperStat.home : keeperStat.away);
          shotsOnTargetFaced += sotAgainstThisMatch;
          keeperGoalsConceded += home ? m.awayScore! : m.homeScore!;
          keeperSampleSize++;
        }
      }

      const yellowStat = details.matchStats?.find((s) => s.name === "Yellow cards");
      if (yellowStat) {
        const redStat = details.matchStats?.find((s) => s.name === "Red cards");
        const yellow = Number(home ? yellowStat.home : yellowStat.away);
        const red = redStat ? Number(home ? redStat.home : redStat.away) : 0;
        if (home) {
          atHomeYellow += yellow;
          atHomeRed += red;
          atHomeSampleSize++;
        } else {
          awayYellow += yellow;
          awayRed += red;
          awaySampleSize++;
        }
      }

      const aerialStat = details.matchStats?.find((s) => s.name === "Aerial duels won");
      if (aerialStat) {
        const forVal = parseLeadingInt(home ? aerialStat.home : aerialStat.away);
        const againstVal = parseLeadingInt(home ? aerialStat.away : aerialStat.home);
        if (forVal != null && againstVal != null) {
          aerialFor += forVal;
          aerialAgainst += againstVal;
          aerialSampleSize++;
        }
      }

      const bigChancesStat = details.matchStats?.find((s) => s.name === "Big chances");
      const bigChancesMissedStat = details.matchStats?.find((s) => s.name === "Big chances missed");
      if (bigChancesStat && bigChancesMissedStat) {
        chancesCreatedFor += Number(home ? bigChancesStat.home : bigChancesStat.away);
        chancesCreatedAgainst += Number(home ? bigChancesStat.away : bigChancesStat.home);
        chancesMissedFor += Number(home ? bigChancesMissedStat.home : bigChancesMissedStat.away);
        chancesMissedAgainst += Number(home ? bigChancesMissedStat.away : bigChancesMissedStat.home);
        bigChancesSampleSize++;
      }

      const passesStat = details.matchStats?.find((s) => s.name === "Passes" && s.home !== "" && s.away !== "");
      const accuratePassesStat = details.matchStats?.find((s) => s.name === "Accurate passes");
      const longBallsStat = details.matchStats?.find((s) => s.name === "Accurate long balls");
      if (passesStat && accuratePassesStat && longBallsStat) {
        const totalOwn = parseLeadingInt(home ? passesStat.home : passesStat.away);
        const accurateOwn = parseLeadingInt(home ? accuratePassesStat.home : accuratePassesStat.away);
        const longBallsOwn = parseLeadingInt(home ? longBallsStat.home : longBallsStat.away);
        if (totalOwn != null && accurateOwn != null && longBallsOwn != null) {
          totalPassesFor += totalOwn;
          accuratePassesFor += accurateOwn;
          accurateLongBallsFor += longBallsOwn;
          passingSampleSize++;
        }
      }

      const foulsStat = details.matchStats?.find((s) => s.name === "Fouls committed");
      if (foulsStat) {
        foulsFor += Number(home ? foulsStat.home : foulsStat.away);
        foulsAgainst += Number(home ? foulsStat.away : foulsStat.home);
        foulsSampleSize++;
      }
    } catch {
      // one match's detail fetch failing shouldn't drop the whole estimate
    }
  }

  const xg: SeasonXGEstimate | null = xgSampleSize
    ? { sampleSize: xgSampleSize, xgFor: Number(xgFor.toFixed(2)), xgAgainst: Number(xgAgainst.toFixed(2)), actualGoalsFor: goalsFor, actualGoalsAgainst: goalsAgainst, source: "fotmob" }
    : null;

  const shots: SeasonShotsEstimate | null = shotsSampleSize
    ? { sampleSize: shotsSampleSize, shotsFor, shotsAgainst, shotsOnTargetFor: sotFor, shotsOnTargetAgainst: sotAgainst, source: "fotmob" }
    : null;

  const cardSplit: CardDisciplineVenueSplit | null = atHomeSampleSize || awaySampleSize
    ? {
        atHomeSampleSize,
        atHomeYellowPerGame: atHomeSampleSize ? Number((atHomeYellow / atHomeSampleSize).toFixed(2)) : null,
        atHomeRedPerGame: atHomeSampleSize ? Number((atHomeRed / atHomeSampleSize).toFixed(2)) : null,
        awaySampleSize,
        awayYellowPerGame: awaySampleSize ? Number((awayYellow / awaySampleSize).toFixed(2)) : null,
        awayRedPerGame: awaySampleSize ? Number((awayRed / awaySampleSize).toFixed(2)) : null,
        source: "fotmob",
      }
    : null;

  const aerial: SeasonAerialEstimate | null = aerialSampleSize
    ? { sampleSize: aerialSampleSize, aerialDuelsWonFor: aerialFor, aerialDuelsWonAgainst: aerialAgainst, source: "fotmob" }
    : null;

  const bigChances: SeasonBigChancesEstimate | null = bigChancesSampleSize
    ? {
        sampleSize: bigChancesSampleSize,
        bigChancesCreatedFor: chancesCreatedFor,
        bigChancesCreatedAgainst: chancesCreatedAgainst,
        bigChancesMissedFor: chancesMissedFor,
        bigChancesMissedAgainst: chancesMissedAgainst,
        source: "fotmob",
      }
    : null;

  const passingStyle: SeasonPassingStyleEstimate | null = passingSampleSize
    ? {
        sampleSize: passingSampleSize,
        totalPassesFor,
        accuratePassesFor,
        passAccuracyPct: totalPassesFor ? Number(((accuratePassesFor / totalPassesFor) * 100).toFixed(1)) : null,
        accurateLongBallsFor,
        longBallSharePct: accuratePassesFor ? Number(((accurateLongBallsFor / accuratePassesFor) * 100).toFixed(1)) : null,
        source: "fotmob",
      }
    : null;

  const fouls: SeasonFoulsEstimate | null = foulsSampleSize
    ? { sampleSize: foulsSampleSize, foulsCommittedFor: foulsFor, foulsCommittedAgainst: foulsAgainst, source: "fotmob" }
    : null;

  const goalkeeping: SeasonGoalkeepingEstimate | null = keeperSampleSize
    ? {
        sampleSize: keeperSampleSize,
        savesFor,
        shotsOnTargetFaced,
        savePct: shotsOnTargetFaced ? Number(((savesFor / shotsOnTargetFaced) * 100).toFixed(1)) : null,
        goalsConceded: keeperGoalsConceded,
        source: "fotmob",
      }
    : null;

  return { xg, shots, cardSplit, aerial, bigChances, passingStyle, fouls, goalkeeping };
}

interface PossessionAndCornersEstimate {
  possession: PossessionMatchupInfo | null;
  corners: SeasonCornersEstimate | null;
  defensiveErrors: SeasonDefensiveErrorsEstimate | null;
}

// >=55% opponent possession is the "high" threshold -- comfortably above a
// genuinely even game (50%), a deliberately round cutoff rather than a
// competition-tuned one, consistent with the other thresholds in this file.
// "Corner total" and "Defensive error" (confirmed field names from real
// data) come free from the same Goal.com match-detail fetch already made
// for the possession stat -- no extra requests. "Defensive error" isn't
// published for every match (see SeasonDefensiveErrorsEstimate's doc
// comment), unlike "Corner total" which is reliably present.
async function computePossessionMatchup(teamName: string, goalMatches: MatchInfo[]): Promise<PossessionAndCornersEstimate> {
  const finished = goalMatches
    .filter((m) => m.status === "finished" && m.kickoffUtc)
    .sort((a, b) => new Date(b.kickoffUtc!).getTime() - new Date(a.kickoffUtc!).getTime())
    .slice(0, 5);
  if (!finished.length) return { possession: null, corners: null, defensiveErrors: null };

  let highPts = 0, highCount = 0, otherPts = 0, otherCount = 0;
  let cornersFor = 0, cornersAgainst = 0, cornersSampleSize = 0;
  let defErrorsFor = 0, defErrorsAgainst = 0, defErrorsSampleSize = 0;
  for (const m of finished) {
    const home = isTeamHome(m, teamName);
    if (home === null) continue;
    try {
      const details = await getGoalMatchDetails(m);
      const possessionStat = details.matchStats?.find((s) => /possession/i.test(s.name));
      if (possessionStat) {
        const opponentPossession = Number(home ? possessionStat.away : possessionStat.home);
        if (!Number.isNaN(opponentPossession)) {
          const teamScore = home ? m.homeScore! : m.awayScore!;
          const oppScore = home ? m.awayScore! : m.homeScore!;
          const pts = teamScore > oppScore ? 3 : teamScore === oppScore ? 1 : 0;
          if (opponentPossession >= 55) {
            highPts += pts;
            highCount++;
          } else {
            otherPts += pts;
            otherCount++;
          }
        }
      }

      const cornersStat = details.matchStats?.find((s) => s.name === "Corner total");
      if (cornersStat) {
        cornersFor += Number(home ? cornersStat.home : cornersStat.away);
        cornersAgainst += Number(home ? cornersStat.away : cornersStat.home);
        cornersSampleSize++;
      }

      const defErrorsStat = details.matchStats?.find((s) => s.name === "Defensive error");
      if (defErrorsStat) {
        defErrorsFor += Number(home ? defErrorsStat.home : defErrorsStat.away);
        defErrorsAgainst += Number(home ? defErrorsStat.away : defErrorsStat.home);
        defErrorsSampleSize++;
      }
    } catch {
      // one match's detail fetch failing shouldn't drop the whole estimate
    }
  }

  const possession: PossessionMatchupInfo | null = highCount || otherCount
    ? {
        highOpponentPossessionPPG: highCount ? Number((highPts / highCount).toFixed(2)) : null,
        highOpponentPossessionSampleSize: highCount,
        otherPPG: otherCount ? Number((otherPts / otherCount).toFixed(2)) : null,
        otherSampleSize: otherCount,
      }
    : null;

  const corners: SeasonCornersEstimate | null = cornersSampleSize
    ? { sampleSize: cornersSampleSize, cornersFor, cornersAgainst, source: "goal" }
    : null;

  const defensiveErrors: SeasonDefensiveErrorsEstimate | null = defErrorsSampleSize
    ? { sampleSize: defErrorsSampleSize, defensiveErrorsFor: defErrorsFor, defensiveErrorsAgainst: defErrorsAgainst, source: "goal" }
    : null;

  return { possession, corners, defensiveErrors };
}

interface OpponentContext {
  restDays: number | null;
  averageAge: number | null;
  // Full multi-source merged profile -- same treatment as the searched
  // team's own profile (squad with Sofascore + Goal.com-fallback player
  // stats, injuries, transfers, top scorers/assists), not a cut-down
  // single-source version. Both teams in a match get scraped to the same
  // depth; only the fixture-list fetch (for rest days) stays single-source,
  // since that's a single number, not something that benefits from merging.
  mergedProfile: MergedProfile | null;
  // Same fixture list already fetched for restDays -- kept here too so form
  // (for opponent-rank-record) and rotation (last-2-lineups diff) can reuse
  // it instead of fetching it a second time.
  matches: MatchInfo[];
  error: string | null;
}

// Rest days only needs one source's fixture list (a single number, no
// benefit from merging), fetched against the base source. The profile,
// though, goes through the exact same multi-source fetch-then-merge as the
// searched team's own profile -- up to 5 requests, same as the main team --
// so the opponent's squad/injuries/transfers/player-stats are just as real,
// not a lighter-weight stand-in.
async function fetchOpponentContext(baseSource: Source, opponentName: string): Promise<OpponentContext> {
  const now = Date.now();
  let restDays: number | null = null;
  let matches: MatchInfo[] = [];
  let error: string | null = null;

  try {
    matches = await scrapers[baseSource].run(opponentName);
    const played = matches
      .filter((m) => m.kickoffUtc && new Date(m.kickoffUtc).getTime() < now)
      .sort((a, b) => new Date(b.kickoffUtc!).getTime() - new Date(a.kickoffUtc!).getTime());
    if (played[0]?.kickoffUtc) {
      restDays = Math.round((now - new Date(played[0].kickoffUtc).getTime()) / 86400000);
    }
  } catch (err: any) {
    error = err.message;
  }

  const opponentProfileBySource = new Map<Source, TeamProfile>();
  for (const source of SOURCE_ORDER) {
    try {
      opponentProfileBySource.set(source, await scrapers[source].profile(opponentName));
    } catch (err: any) {
      error = error ? `${error}; ${err.message}` : err.message;
    }
  }
  const mergedProfile = opponentProfileBySource.size > 0 ? mergeTeamProfile(opponentProfileBySource) : null;

  return { restDays, averageAge: mergedProfile?.averageAge ?? null, mergedProfile, matches, error };
}

// Tries the home club first, then the away club -- StadiumDB is indexed by
// club, so a neutral-venue match (pre-season friendlies at a rented
// stadium, e.g. Soldier Field) correctly resolves to nothing rather than a
// wrong guess.
async function fetchVenueDetails(merged: MergedMatch, venueCountry: string | null): Promise<VenueDetails | null> {
  try {
    return (
      (await getStadiumDbVenueDetails(merged.homeTeam, venueCountry)) ??
      (await getStadiumDbVenueDetails(merged.awayTeam, venueCountry))
    );
  } catch {
    return null;
  }
}

// Fixed positional rule (top 4 / bottom 3), not tuned per-competition -- see
// the StandingsZoneInfo type comment for why this is an approximation.
// Real continental/relegation spot counts for competitions we can name
// exactly (matched against Sofascore's own competition name string, e.g.
// "Premier League", "Brasileirão Betano" -- confirmed exact strings from
// real fetches during development). Falls back to the generic 4/3 rule for
// anything not in this table -- most leagues don't use exactly 4 continental
// spots or exactly 3 relegation spots, so an unmatched competition is still
// an approximation, just no longer the default for well-known leagues.
const LEAGUE_STAKES: Record<string, { continentalSpots: number; relegationSpots: number }> = {
  "Premier League": { continentalSpots: 4, relegationSpots: 3 },
  LaLiga: { continentalSpots: 4, relegationSpots: 3 },
  "La Liga": { continentalSpots: 4, relegationSpots: 3 },
  "Serie A": { continentalSpots: 4, relegationSpots: 3 },
  Bundesliga: { continentalSpots: 4, relegationSpots: 2 },
  "Ligue 1": { continentalSpots: 3, relegationSpots: 2 },
  "Brasileirão Betano": { continentalSpots: 6, relegationSpots: 4 },
  "Primeira Liga": { continentalSpots: 3, relegationSpots: 3 },
  Eredivisie: { continentalSpots: 3, relegationSpots: 2 },
};

function classifyStandingsZone(
  standing: TeamStanding | null,
  competition: string | null,
  standingsTable: MatchDetails["standingsTable"],
): StandingsZoneInfo | null {
  if (!standing || !standing.totalTeams) return null;
  const stakes = competition ? LEAGUE_STAKES[competition] : undefined;
  const continentalSpots = stakes?.continentalSpots ?? 4;
  const relegationSpots = stakes?.relegationSpots ?? 3;
  const zone = standing.position <= continentalSpots ? "top-of-table" : standing.position > standing.totalTeams - relegationSpots ? "relegation-zone" : "midtable";

  let pointsFromBoundary: number | null = null;
  if (standingsTable?.length) {
    const byPosition = new Map(standingsTable.map((r) => [r.position, r.points]));
    const continentalBoundaryPts = byPosition.get(continentalSpots) ?? byPosition.get(continentalSpots + 1);
    const relegationBoundaryPts = byPosition.get(standing.totalTeams - relegationSpots) ?? byPosition.get(standing.totalTeams - relegationSpots + 1);
    const gaps = [continentalBoundaryPts, relegationBoundaryPts].filter((p): p is number => p != null).map((p) => Math.abs(standing.points - p));
    if (gaps.length) pointsFromBoundary = Math.min(...gaps);
  }

  return { position: standing.position, totalTeams: standing.totalTeams, zone, pointsFromBoundary, inTheMix: pointsFromBoundary != null ? pointsFromBoundary <= 6 : null };
}

function classifyCardDiscipline(stats: MatchDetails["homeTeamSeasonStats"], standing: TeamStanding | null): CardDisciplineInfo | null {
  const played = standing?.played;
  if (!stats || !played) return null;
  const yellowPerGame = Number((stats.yellowCards / played).toFixed(2));
  const redPerGame = Number((stats.redCards / played).toFixed(2));
  return { yellowPerGame, redPerGame, elevatedRisk: yellowPerGame > 2.5 || redPerGame > 0.2 };
}

// Sofascore-only fields (venueCountry/homeTeamCountry/awayTeamCountry) --
// null from every other base source, same graceful-degradation as
// everything else that's Sofascore-exclusive.
function computeTravelInfo(merged: MergedMatch): TravelInfo | null {
  if (!merged.venueCountry || (!merged.homeTeamCountry && !merged.awayTeamCountry)) return null;
  const homeTraveling = merged.homeTeamCountry ? merged.homeTeamCountry !== merged.venueCountry : null;
  const awayTraveling = merged.awayTeamCountry ? merged.awayTeamCountry !== merged.venueCountry : null;
  return {
    venueCountry: merged.venueCountry,
    homeTeamCountry: merged.homeTeamCountry,
    awayTeamCountry: merged.awayTeamCountry,
    homeTraveling,
    awayTraveling,
    homeTravelDistanceKm: homeTraveling && merged.homeTeamCountry ? countryDistanceKm(merged.homeTeamCountry, merged.venueCountry) : homeTraveling === false ? 0 : null,
    awayTravelDistanceKm: awayTraveling && merged.awayTeamCountry ? countryDistanceKm(merged.awayTeamCountry, merged.venueCountry) : awayTraveling === false ? 0 : null,
  };
}

// Only counts results in the SAME competition as the upcoming match (cross-
// competition rank isn't comparable), and only against opponents CURRENTLY
// ranked higher -- "currently," not at the time that result happened, since
// no source publishes point-in-time historical standings.
function computeOpponentRankRecord(
  results: FormResult[],
  competition: string | null,
  standingsTable: MergedMatch["standingsTable"],
  ownPosition: number | null,
): OpponentRankRecord | null {
  if (!competition || !standingsTable?.length || ownPosition == null) return null;
  let wins = 0, draws = 0, losses = 0, sampleSize = 0;
  for (const r of results.filter((res) => res.competition === competition)) {
    const target = normalizeTeamName(r.opponent);
    const row = standingsTable.find((s) => {
      const name = normalizeTeamName(s.teamName);
      return name === target || name.includes(target) || target.includes(name);
    });
    if (!row || row.position >= ownPosition) continue;
    sampleSize++;
    if (r.result === "W") wins++;
    else if (r.result === "D") draws++;
    else losses++;
  }
  return sampleSize ? { sampleSize, wins, draws, losses } : null;
}

// Present = not on the injuries or suspensions list; Absent = either one.
// "starting" comes from this match's own lineup where published. Doesn't
// distinguish "available but not selected" from "on the bench" -- none of
// our sources publish a separate bench list, only starting XI + injuries +
// (SoccerDesk only) suspensions.
function computePresence(
  squad: SquadMember[] | null,
  lineup: LineupPlayer[] | null,
  injuries: SquadMember[] | null,
  suspended: string[] | null,
): PresenceEntry[] | null {
  if (!squad?.length) return null;
  const lineupNames = new Set((lineup ?? []).map((p) => normalizeTeamName(p.name)));
  const injuryByName = new Map((injuries ?? []).map((p) => [normalizeTeamName(p.name), p.injury]));
  const suspendedNames = new Set((suspended ?? []).map(normalizeTeamName));
  return squad.map((m) => {
    const norm = normalizeTeamName(m.name);
    const reason = injuryByName.get(norm) ?? (suspendedNames.has(norm) ? "Suspended" : null);
    return { name: m.name, status: reason ? "A" : "P", starting: lineupNames.has(norm), reason };
  });
}

// Diffs the starting XI between the last TWO played matches (not the
// upcoming match's lineup, which is usually unpublished until close to
// kickoff) -- a general rotation-tendency signal. Two extra details()
// fetches against the same source used for form, sequential (matters for
// Sofascore's Cloudflare pacing).
async function computeRotationInfo(teamName: string, source: Source, matches: MatchInfo[]): Promise<RotationInfo | null> {
  const played = matches
    .filter((m) => m.homeScore != null && m.awayScore != null && m.kickoffUtc)
    .sort((a, b) => new Date(b.kickoffUtc!).getTime() - new Date(a.kickoffUtc!).getTime());
  if (played.length < 2) return null;
  const [last, prev] = played;

  try {
    const lastDetails = await scrapers[source].details(last);
    const prevDetails = await scrapers[source].details(prev);
    const lastHome = isTeamHome(last, teamName);
    const prevHome = isTeamHome(prev, teamName);
    if (lastHome == null || prevHome == null) return null;

    const lastXI = (lastHome ? lastDetails.homeLineup : lastDetails.awayLineup) ?? [];
    const prevXI = (prevHome ? prevDetails.homeLineup : prevDetails.awayLineup) ?? [];
    if (!lastXI.length || !prevXI.length) return null;

    const prevNames = new Set(prevXI.map((p) => normalizeTeamName(p.name)));
    const changedPlayers = lastXI.filter((p) => !prevNames.has(normalizeTeamName(p.name))).length;

    const lastFormation = (lastHome ? lastDetails.homeFormation : lastDetails.awayFormation) ?? null;
    const previousFormation = (prevHome ? prevDetails.homeFormation : prevDetails.awayFormation) ?? null;
    const defenderCount = (f: string | null) => (f ? Number(f.split("-")[0]) || null : null);

    // The team's own result IN `prev` -- what happened right before the
    // changes shown here were made, straight off data already on hand
    // (prev.homeScore/awayScore), no extra fetch.
    const prevTeamScore = prevHome ? prev.homeScore : prev.awayScore;
    const prevOppScore = prevHome ? prev.awayScore : prev.homeScore;
    const precedingResult: RotationInfo["precedingResult"] =
      prevTeamScore != null && prevOppScore != null ? (prevTeamScore > prevOppScore ? "W" : prevTeamScore < prevOppScore ? "L" : "D") : null;

    return {
      changedPlayers,
      startingXISize: lastXI.length,
      lastMatchDate: last.kickoffUtc,
      previousMatchDate: prev.kickoffUtc,
      lastFormation,
      previousFormation,
      formationChanged: lastFormation && previousFormation ? lastFormation !== previousFormation : null,
      lastDefenderCount: defenderCount(lastFormation),
      previousDefenderCount: defenderCount(previousFormation),
      precedingResult,
    };
  } catch {
    return null;
  }
}

// Among results that WEREN'T wins, what share were draws -- "still earns a
// point when struggling" as an objective number rather than a narrative
// claim. Null (not zero) if there are no non-win results to sample.
function computeResilience(results: FormResult[]): ResilienceInfo | null {
  const nonWins = results.filter((r) => r.result !== "W");
  if (!nonWins.length) return null;
  const draws = nonWins.filter((r) => r.result === "D").length;
  return { nonWinSampleSize: nonWins.length, drawSharePct: Math.round((draws / nonWins.length) * 100) };
}

// PPG split by rest before that match, across ALL played matches on record
// (not just the recent-form sample) so each bucket has enough of a sample
// to mean something. <=3 days rest is "short" -- same threshold already
// used elsewhere in this codebase for "tight schedule."
function computeRestPerformance(teamName: string, matches: MatchInfo[]): RestPerformanceInfo | null {
  const played = matches
    .filter((m) => m.homeScore != null && m.awayScore != null && m.kickoffUtc)
    .sort((a, b) => new Date(a.kickoffUtc!).getTime() - new Date(b.kickoffUtc!).getTime());
  if (played.length < 2) return null;

  const points = (m: MatchInfo): number | null => {
    const home = isTeamHome(m, teamName);
    if (home == null) return null;
    const teamScore = home ? m.homeScore! : m.awayScore!;
    const oppScore = home ? m.awayScore! : m.homeScore!;
    return teamScore > oppScore ? 3 : teamScore === oppScore ? 1 : 0;
  };

  let shortPts = 0, shortCount = 0, longPts = 0, longCount = 0;
  for (let i = 1; i < played.length; i++) {
    const pts = points(played[i]);
    if (pts == null) continue;
    const restDays = dayDiff(played[i].kickoffUtc!, played[i - 1].kickoffUtc!);
    if (restDays <= 3) {
      shortPts += pts;
      shortCount++;
    } else {
      longPts += pts;
      longCount++;
    }
  }

  if (!shortCount && !longCount) return null;
  return {
    shortRestPPG: shortCount ? Number((shortPts / shortCount).toFixed(2)) : null,
    shortRestSampleSize: shortCount,
    longRestPPG: longCount ? Number((longPts / longCount).toFixed(2)) : null,
    longRestSampleSize: longCount,
  };
}

// Correlation only, not causation -- reports whether the more experienced
// squad also happens to hold the head-to-head edge, doesn't claim
// experience explains it.
function computeExperienceH2H(
  experienceComparison: ExperienceComparison | null,
  h2h: MatchDetails["headToHeadSummary"],
  ownIsHome: boolean | null,
): ExperienceH2HNote | null {
  if (!experienceComparison?.moreExperienced || !h2h || ownIsHome == null) return null;
  const ownWins = ownIsHome ? h2h.homeWins : h2h.awayWins;
  const oppWins = ownIsHome ? h2h.awayWins : h2h.homeWins;
  const h2hLeader = ownWins === oppWins ? "even" : ownWins > oppWins ? "own" : "opponent";
  const aligned =
    experienceComparison.moreExperienced === "even" || h2hLeader === "even"
      ? null
      : experienceComparison.moreExperienced === h2hLeader;
  return { moreExperienced: experienceComparison.moreExperienced, h2hLeader, aligned };
}

// Flags multiple competitions AND a short average gap between the last 3
// matches TOGETHER -- either signal alone isn't flagged, since a team can
// handle multiple competitions fine with normal rest, or a tight schedule
// fine within a single competition. <5 days average gap is the threshold.
function computeFatigueFlag(recentCompetitions: string[], gapsBetweenLastThree: number[]): FatigueFlag | null {
  if (!gapsBetweenLastThree.length) return null;
  const avgGapDays = Number((gapsBetweenLastThree.reduce((a, b) => a + b, 0) / gapsBetweenLastThree.length).toFixed(1));
  const multiCompetition = recentCompetitions.length > 1;
  return { multiCompetition, competitions: recentCompetitions, avgGapDays, flagged: multiCompetition && avgGapDays < 5 };
}

// Gap between a team's own home and away win rates -- >=20pp "strong",
// 5-20pp "slight", -5 to 5pp "negligible", <=-5pp "reverse" (does WORSE at
// home than away).
function computeHomeAdvantage(form: FormSummary | null): HomeAdvantageInfo | null {
  if (!form || form.homeWinRatePct == null || form.awayWinRatePct == null) return null;
  const gapPct = form.homeWinRatePct - form.awayWinRatePct;
  const strength: HomeAdvantageInfo["strength"] = gapPct >= 20 ? "strong" : gapPct >= 5 ? "slight" : gapPct <= -5 ? "reverse" : "negligible";
  return { homeWinRatePct: form.homeWinRatePct, awayWinRatePct: form.awayWinRatePct, gapPct, strength };
}

// "Stable" requires a winning streak of >=2 AND <=2 changes to the XI
// between the last two matches -- both conditions, not either alone (a
// 1-game win with a fully rotated XI isn't a stable streak).
function computeStreakStability(streak: FormSummary["currentStreak"], rotation: RotationInfo | null): StreakStabilityInfo | null {
  if (!streak) return null;
  const stable = streak.result === "W" && streak.count >= 2 ? (rotation ? rotation.changedPlayers <= 2 : null) : streak.result === "W" ? null : false;
  return { streakResult: streak.result, streakCount: streak.count, changedPlayers: rotation?.changedPlayers ?? null, stable };
}

// "Potential turnaround" requires a losing streak of >=2 AND actual goals
// scored at least 1 below the season xG estimate (they're creating enough
// to have scored more than they have) -- both conditions together, since a
// losing streak with UNDERWHELMING chances created doesn't support "due a
// turnaround" the same way.
function computeLosingStreakContext(streak: FormSummary["currentStreak"], xgEstimate: SeasonXGEstimate | null): LosingStreakContextInfo | null {
  if (!streak || streak.result !== "L" || streak.count < 2) return null;
  const xgDelta = xgEstimate ? Number((xgEstimate.actualGoalsFor - xgEstimate.xgFor).toFixed(2)) : null;
  return { streakCount: streak.count, xgDelta, potentialTurnaround: xgDelta != null ? xgDelta <= -1 : null };
}

// Only returns players actually flagged (accumulation risk or a prior
// dismissal), sorted worst-first, not the full squad -- this is meant as a
// short "watch list," not a data dump.
function computeCardRisks(squad: SquadMember[] | null, count = 5): PlayerCardRisk[] {
  if (!squad) return [];
  return squad
    .filter((m) => m.seasonStats)
    .map((m) => ({
      name: m.name,
      yellowCards: m.seasonStats!.yellowCards,
      redCards: m.seasonStats!.redCards,
      appearances: m.seasonStats!.appearances,
      accumulationRisk: m.seasonStats!.yellowCards >= 4,
      priorDismissal: m.seasonStats!.redCards >= 1,
    }))
    .filter((r) => r.accumulationRisk || r.priorDismissal)
    .sort((a, b) => b.yellowCards + b.redCards * 10 - (a.yellowCards + a.redCards * 10))
    .slice(0, count);
}

// Pure synthesis of two things already computed separately -- the match
// referee's own season card rate and each team's card-risk list (computed
// above) -- no new requests. computeCardRisks already filters down to only
// flagged players, so nothing further to threshold here beyond "is there
// anyone to report."
function computeRefereeCardRiskNote(
  refereeName: string | null,
  refereeStats: RefereeStats | null,
  homeCardRisks: PlayerCardRisk[] | null,
  awayCardRisks: PlayerCardRisk[] | null,
): RefereeCardRiskNote | null {
  if (!refereeName || !refereeStats) return null;
  const flaggedPlayers = [
    ...(homeCardRisks ?? []).map((r) => ({ name: r.name, side: "home" as const, priorDismissal: r.priorDismissal })),
    ...(awayCardRisks ?? []).map((r) => ({ name: r.name, side: "away" as const, priorDismissal: r.priorDismissal })),
  ];
  if (!flaggedPlayers.length) return null;
  const yellowCardsPerGame = parseFloat(refereeStats.yellowCardsPerGame);
  return { refereeName, yellowCardsPerGame, elevatedCardReferee: yellowCardsPerGame > 2.5, flaggedPlayers };
}

// Opponent's own aerial win rate, from their own SeasonAerialEstimate --
// shared by both cross-reference flags below.
function aerialWinPct(aerial: SeasonAerialEstimate | null): number | null {
  if (!aerial) return null;
  const total = aerial.aerialDuelsWonFor + aerial.aerialDuelsWonAgainst;
  return total ? Number(((aerial.aerialDuelsWonFor / total) * 100).toFixed(1)) : null;
}

// Cross-references a team's own corners-won rate against the SPECIFIC
// opponent's own aerial-duel record -- both already fetched independently,
// zero new requests. See SetPieceThreatFlag's doc comment for thresholds.
function computeSetPieceThreatFlag(corners: SeasonCornersEstimate | null, opponentAerial: SeasonAerialEstimate | null): SetPieceThreatFlag | null {
  if (!corners) return null;
  const cornersPerGame = Number((corners.cornersFor / corners.sampleSize).toFixed(2));
  const opponentPct = aerialWinPct(opponentAerial);
  return {
    cornersPerGame,
    opponentAerialWinPct: opponentPct,
    elevated: cornersPerGame >= 5 && opponentPct != null && opponentPct < 50,
  };
}

// Same cross-reference shape, pairing a team's own long-ball share against
// the same opponent aerial-win signal. See DirectPlayExposureFlag's doc
// comment for thresholds.
function computeDirectPlayExposureFlag(passingStyle: SeasonPassingStyleEstimate | null, opponentAerial: SeasonAerialEstimate | null): DirectPlayExposureFlag | null {
  if (!passingStyle || passingStyle.longBallSharePct == null) return null;
  const opponentPct = aerialWinPct(opponentAerial);
  return {
    longBallSharePct: passingStyle.longBallSharePct,
    opponentAerialWinPct: opponentPct,
    elevated: passingStyle.longBallSharePct >= 15 && opponentPct != null && opponentPct < 50,
  };
}

// Squawka-only (defensiveStats). Only returns defenders actually below the
// 50% threshold, not the full back line -- a short "watch list" like
// computeCardRisks, not a data dump.
function computeDuelVulnerabilities(squad: SquadMember[] | null, count = 5): DuelVulnerability[] {
  if (!squad) return [];
  return squad
    .filter((m) => isDefenderRole(m.role) && m.defensiveStats?.groundDuelSuccessPct != null && m.defensiveStats.groundDuelSuccessPct < 50)
    .map((m) => ({ name: m.name, groundDuelSuccessPct: m.defensiveStats!.groundDuelSuccessPct! }))
    .sort((a, b) => a.groundDuelSuccessPct - b.groundDuelSuccessPct)
    .slice(0, count);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Above-own-team-median chances created AND below-55% ground duel success --
// see FullbackExposureInfo for why this uses each team's own defenders as
// the baseline rather than a fixed league-wide creativity cutoff.
function computeFullbackExposure(squad: SquadMember[] | null, count = 3): FullbackExposureInfo[] {
  if (!squad) return [];
  const defenders = squad.filter((m) => isDefenderRole(m.role) && m.defensiveStats?.chancesCreated != null && m.defensiveStats?.groundDuelSuccessPct != null);
  if (defenders.length < 2) return [];
  const medianChances = median(defenders.map((d) => d.defensiveStats!.chancesCreated!));
  return defenders
    .filter((d) => d.defensiveStats!.chancesCreated! > medianChances && d.defensiveStats!.groundDuelSuccessPct! < 55)
    .map((d) => ({ name: d.name, chancesCreated: d.defensiveStats!.chancesCreated!, groundDuelSuccessPct: d.defensiveStats!.groundDuelSuccessPct! }))
    .sort((a, b) => b.chancesCreated - a.chancesCreated)
    .slice(0, count);
}

// Re-ranks by matching standings-table rows by POSITION (both teams'
// current positions are already reliably resolved via ID-based matching
// upstream), not by fuzzy team-name matching -- avoids an entire class of
// bug the name-matching approach elsewhere in this file is exposed to.
function simulateNewPosition(
  standingsTable: MergedMatch["standingsTable"],
  ownCurrentPosition: number,
  opponentCurrentPosition: number,
  newOwnPoints: number,
  newOpponentPoints: number,
): number | null {
  if (!standingsTable?.length) return null;
  const simulated = standingsTable.map((r) => {
    if (r.position === ownCurrentPosition) return { ...r, points: newOwnPoints };
    if (r.position === opponentCurrentPosition) return { ...r, points: newOpponentPoints };
    return r;
  });
  simulated.sort((a, b) => b.points - a.points || a.position - b.position);
  const idx = simulated.findIndex((r) => r.position === ownCurrentPosition);
  return idx === -1 ? null : idx + 1;
}

function computeStandingsImpact(
  standing: TeamStanding | null,
  opponentStanding: TeamStanding | null,
  standingsTable: MergedMatch["standingsTable"],
): StandingsImpactInfo | null {
  if (!standing || !opponentStanding || !standingsTable?.length) return null;
  const scenarios: StandingsScenario[] = (["win", "draw", "loss"] as const).map((outcome) => {
    const ownPts = outcome === "win" ? 3 : outcome === "draw" ? 1 : 0;
    const oppPts = outcome === "win" ? 0 : outcome === "draw" ? 1 : 3;
    const newPoints = standing.points + ownPts;
    const newOpponentPoints = opponentStanding.points + oppPts;
    return { outcome, newPoints, newPosition: simulateNewPosition(standingsTable, standing.position, opponentStanding.position, newPoints, newOpponentPoints) };
  });
  return { currentPosition: standing.position, currentPoints: standing.points, scenarios };
}

function computeInsights(
  merged: MergedMatch,
  ownAverageAge: number | null,
  ownRestDays: number | null,
  opponent: OpponentContext,
): MatchInsights {
  let restComparison: RestComparison | null = null;
  if (ownRestDays != null || opponent.restDays != null) {
    let moreRested: RestComparison["moreRested"] = null;
    if (ownRestDays != null && opponent.restDays != null) {
      moreRested = ownRestDays === opponent.restDays ? "even" : ownRestDays > opponent.restDays ? "own" : "opponent";
    }
    restComparison = { ownRestDays, opponentRestDays: opponent.restDays, moreRested };
  }

  let experienceComparison: ExperienceComparison | null = null;
  if (ownAverageAge != null || opponent.averageAge != null) {
    let moreExperienced: ExperienceComparison["moreExperienced"] = null;
    if (ownAverageAge != null && opponent.averageAge != null) {
      const diff = ownAverageAge - opponent.averageAge;
      moreExperienced = Math.abs(diff) < 1.5 ? "even" : diff > 0 ? "own" : "opponent";
    }
    experienceComparison = { ownAverageAge, opponentAverageAge: opponent.averageAge, moreExperienced };
  }

  return {
    restComparison,
    experienceComparison,
    homeStandingsZone: classifyStandingsZone(merged.homeTeamStanding, merged.competition, merged.standingsTable),
    awayStandingsZone: classifyStandingsZone(merged.awayTeamStanding, merged.competition, merged.standingsTable),
    homeCardDiscipline: classifyCardDiscipline(merged.homeTeamSeasonStats, merged.homeTeamStanding),
    awayCardDiscipline: classifyCardDiscipline(merged.awayTeamSeasonStats, merged.awayTeamStanding),
    homeCardDisciplineVenueSplit: null,
    awayCardDisciplineVenueSplit: null,
    travelInfo: computeTravelInfo(merged),
    // Filled in by main() after this returns -- these need the merged team
    // profiles and per-team form/rotation data, which aren't available at
    // this call site.
    homeXgEstimate: null,
    awayXgEstimate: null,
    homeShotsEstimate: null,
    awayShotsEstimate: null,
    homeAerialEstimate: null,
    awayAerialEstimate: null,
    homeBigChancesEstimate: null,
    awayBigChancesEstimate: null,
    homePassingStyle: null,
    awayPassingStyle: null,
    homeFoulsEstimate: null,
    awayFoulsEstimate: null,
    homeGoalkeepingEstimate: null,
    awayGoalkeepingEstimate: null,
    homeSetPieceThreat: null,
    awaySetPieceThreat: null,
    homeDirectPlayExposure: null,
    awayDirectPlayExposure: null,
    homeOpponentRankRecord: null,
    awayOpponentRankRecord: null,
    homePresence: null,
    awayPresence: null,
    homeRotation: null,
    awayRotation: null,
    homeResilience: null,
    awayResilience: null,
    homeRestPerformance: null,
    awayRestPerformance: null,
    experienceH2H: null,
    homeFatigueFlag: null,
    awayFatigueFlag: null,
    homeAdvantage: null,
    awayAdvantage: null,
    homeStreakStability: null,
    awayStreakStability: null,
    homeLosingStreakContext: null,
    awayLosingStreakContext: null,
    homeCardRisks: null,
    awayCardRisks: null,
    refereeCardRiskNote: null,
    homeDuelVulnerabilities: null,
    awayDuelVulnerabilities: null,
    homePossessionMatchup: null,
    awayPossessionMatchup: null,
    homeCornersEstimate: null,
    awayCornersEstimate: null,
    homeDefensiveErrorsEstimate: null,
    awayDefensiveErrorsEstimate: null,
    homeFullbackExposure: null,
    awayFullbackExposure: null,
    homeStandingsImpact: computeStandingsImpact(merged.homeTeamStanding, merged.awayTeamStanding, merged.standingsTable),
    awayStandingsImpact: computeStandingsImpact(merged.awayTeamStanding, merged.homeTeamStanding, merged.standingsTable),
    opponentContextError: opponent.error,
  };
}

// Bookkeeping/identity fields, not "data" in the coverage sense -- always
// present regardless of how much a given match's actual reporting varies
// (friendlies vs competitive fixtures, early vs late season), so excluding
// them keeps the ratio meaningful rather than diluted by fields that are
// never null in the first place.
const COMPLETENESS_EXCLUDE = new Set([
  "source", "sourceUrl", "competition", "kickoffUtc", "status", "homeTeam", "awayTeam",
  "homeScore", "awayScore", "homeScoreHT", "awayScoreHT", "venue", "note",
  "baseSource", "fieldSources", "additionalNotes", "opponentContextError",
]);

function isPopulated(v: unknown): boolean {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

// How much of the *available* schema this particular run actually got real
// data for -- coverage varies a lot match-to-match (friendlies routinely
// lack full stats, cup ties lack standings, early-season referees lack a
// track record), so this is a per-run signal, not a fixed target.
function computeDataCompleteness(merged: MergedMatch, insights: MatchInsights | null): { populated: number; total: number } {
  let populated = 0;
  let total = 0;
  for (const [k, v] of Object.entries(merged)) {
    if (COMPLETENESS_EXCLUDE.has(k)) continue;
    total++;
    if (isPopulated(v)) populated++;
  }
  if (insights) {
    for (const [k, v] of Object.entries(insights)) {
      if (COMPLETENESS_EXCLUDE.has(k)) continue;
      total++;
      if (isPopulated(v)) populated++;
    }
  }
  return { populated, total };
}

export interface SourceStatus {
  source: Source;
  fixturesScraped: number;
  matchesError: string | null;
  detailsError: string | null;
  profileError: string | null;
}

function printSourceStatus(statuses: SourceStatus[]) {
  console.log("Sources:");
  for (const s of statuses) {
    const issues = [s.matchesError, s.detailsError, s.profileError].filter(Boolean);
    console.log(`  ${s.source}: ${s.fixturesScraped} fixtures${issues.length ? ` -- ${issues.join("; ")}` : ""}`);
  }
  console.log("");
}

// Everything runSearch() returns, keyed exactly the way the CLI's JSON
// output file already shapes it (see buildReportJson below) -- both the
// CLI and any other caller (e.g. the web dashboard) consume the same
// shape, computed by the same single code path, so there's no risk of the
// two drifting apart.
export interface RunSearchResult {
  team: string;
  generatedAt: string;
  statuses: SourceStatus[];
  merged: MergedMatch | null;
  opponentName: string | null;
  form: FormSummary | null;
  formSource: Source | undefined;
  opponentForm: FormSummary | null;
  mergedProfile: MergedProfile | null;
  opponentProfile: MergedProfile | null;
  insights: MatchInsights | null;
  venueDetails: VenueDetails | null;
}

export function buildReportJson(result: RunSearchResult) {
  return {
    team: result.team,
    generatedAt: result.generatedAt,
    sources: result.statuses,
    match: result.merged,
    venueDetails: result.venueDetails,
    formSource: result.formSource,
    form: result.form,
    opponentForm: result.opponentForm,
    teamProfile: result.mergedProfile,
    opponentProfile: result.opponentProfile,
    insights: result.insights,
  };
}

// The full fetch/merge/compute pipeline, decoupled from the CLI's own
// console-printing and file-writing (see main() below) so it can be called
// from anywhere -- e.g. the web dashboard's API route. onProgress is
// optional and purely cosmetic (used to stream "scraping X..." updates to
// a caller); the CLI feeds it into console.log, a caller with no interest
// in progress can just omit it.
export async function runSearch(teamName: string, onProgress: (msg: string) => void = () => {}): Promise<RunSearchResult> {
  onProgress(`Searching for "${teamName}" (base: Sofascore, supplemented by Fotmob, SoccerDesk, Goal.com, 365Scores)...`);

  const matchesBySource = new Map<Source, MatchInfo[]>();
  const detailsBySource = new Map<Source, MatchDetails>();
  const profileBySource = new Map<Source, TeamProfile>();
  const statuses: SourceStatus[] = [];

  // Sequential, not parallel -- Sofascore is rate-sensitive (Cloudflare), so
  // we never want another source's traffic overlapping with its requests.
  for (const source of SOURCE_ORDER) {
    onProgress(`Scraping ${source}...`);
    const scraper = scrapers[source];
    const status: SourceStatus = { source, fixturesScraped: 0, matchesError: null, detailsError: null, profileError: null };

    try {
      const matches = await scraper.run(teamName);
      matchesBySource.set(source, matches);
      status.fixturesScraped = matches.length;

      const next = nextMatch(matches);
      if (next) {
        try {
          detailsBySource.set(source, await scraper.details(next));
        } catch (err: any) {
          status.detailsError = err.message;
        }
      }
    } catch (err: any) {
      status.matchesError = err.message;
    }

    try {
      profileBySource.set(source, await scraper.profile(teamName));
    } catch (err: any) {
      status.profileError = err.message;
    }

    statuses.push(status);
    onProgress(`${source}: ${status.fixturesScraped} fixtures${status.matchesError ? ` -- ${status.matchesError}` : ""}`);
  }

  const merged = detailsBySource.size > 0 ? mergeMatchDetails(detailsBySource) : null;
  const formSource = SOURCE_ORDER.find((s) => matchesBySource.get(s)?.length);
  const form = formSource ? computeFormSummary(teamName, matchesBySource.get(formSource)!) : null;
  const mergedProfile = profileBySource.size > 0 ? mergeTeamProfile(profileBySource) : null;

  let insights: MatchInsights | null = null;
  let venueDetails: VenueDetails | null = null;
  let opponentName: string | null = null;
  let opponentProfile: MergedProfile | null = null;
  let opponentForm: FormSummary | null = null;
  if (merged) {
    const ownIsHome = isTeamHome(merged, teamName);
    opponentName = ownIsHome === false ? merged.homeTeam : merged.awayTeam;
    const ownRestDays = form?.next5WithGaps[0]?.daysSincePrevious ?? null;

    onProgress(`Next match found: ${merged.homeTeam} vs ${merged.awayTeam}. Fetching opponent (${opponentName}) and computing insights...`);
    const opponentContext = await fetchOpponentContext(merged.baseSource, opponentName);
    opponentProfile = opponentContext.mergedProfile;

    insights = computeInsights(merged, mergedProfile?.averageAge ?? null, ownRestDays, opponentContext);
    venueDetails = await fetchVenueDetails(merged, merged.venueCountry);

    // Both teams get the full-depth xG/possession-matchup/losing-streak
    // treatment, not just the searched team -- costs 2 extra fixture-list
    // fetches (Fotmob + Goal.com) for the opponent, since until now those
    // were only ever fetched for the searched team via the main per-source
    // loop.
    const opponentFotmobMatches = await getFotmobMatches(opponentName).catch(() => []);
    const opponentGoalMatches = await getGoalMatches(opponentName).catch(() => []);
    const ownMatchStats = await computeSeasonMatchStatsEstimate(teamName, matchesBySource.get("fotmob") ?? []);
    const opponentMatchStats = await computeSeasonMatchStatsEstimate(opponentName, opponentFotmobMatches);
    const ownXgEstimate = ownMatchStats.xg;
    const opponentXgEstimate = opponentMatchStats.xg;
    insights.homeXgEstimate = ownIsHome ? ownXgEstimate : opponentXgEstimate;
    insights.awayXgEstimate = ownIsHome ? opponentXgEstimate : ownXgEstimate;
    insights.homeShotsEstimate = ownIsHome ? ownMatchStats.shots : opponentMatchStats.shots;
    insights.awayShotsEstimate = ownIsHome ? opponentMatchStats.shots : ownMatchStats.shots;
    insights.homeCardDisciplineVenueSplit = ownIsHome ? ownMatchStats.cardSplit : opponentMatchStats.cardSplit;
    insights.awayCardDisciplineVenueSplit = ownIsHome ? opponentMatchStats.cardSplit : ownMatchStats.cardSplit;
    insights.homeAerialEstimate = ownIsHome ? ownMatchStats.aerial : opponentMatchStats.aerial;
    insights.awayAerialEstimate = ownIsHome ? opponentMatchStats.aerial : ownMatchStats.aerial;
    insights.homeBigChancesEstimate = ownIsHome ? ownMatchStats.bigChances : opponentMatchStats.bigChances;
    insights.awayBigChancesEstimate = ownIsHome ? opponentMatchStats.bigChances : ownMatchStats.bigChances;
    insights.homePassingStyle = ownIsHome ? ownMatchStats.passingStyle : opponentMatchStats.passingStyle;
    insights.awayPassingStyle = ownIsHome ? opponentMatchStats.passingStyle : ownMatchStats.passingStyle;
    insights.homeFoulsEstimate = ownIsHome ? ownMatchStats.fouls : opponentMatchStats.fouls;
    insights.awayFoulsEstimate = ownIsHome ? opponentMatchStats.fouls : ownMatchStats.fouls;
    insights.homeGoalkeepingEstimate = ownIsHome ? ownMatchStats.goalkeeping : opponentMatchStats.goalkeeping;
    insights.awayGoalkeepingEstimate = ownIsHome ? opponentMatchStats.goalkeeping : ownMatchStats.goalkeeping;

    const ownPossessionAndCorners = await computePossessionMatchup(teamName, matchesBySource.get("goal") ?? []);
    const opponentPossessionAndCorners = await computePossessionMatchup(opponentName, opponentGoalMatches);
    insights.homePossessionMatchup = ownIsHome ? ownPossessionAndCorners.possession : opponentPossessionAndCorners.possession;
    insights.awayPossessionMatchup = ownIsHome ? opponentPossessionAndCorners.possession : ownPossessionAndCorners.possession;
    insights.homeCornersEstimate = ownIsHome ? ownPossessionAndCorners.corners : opponentPossessionAndCorners.corners;
    insights.awayCornersEstimate = ownIsHome ? opponentPossessionAndCorners.corners : ownPossessionAndCorners.corners;
    insights.homeDefensiveErrorsEstimate = ownIsHome ? ownPossessionAndCorners.defensiveErrors : opponentPossessionAndCorners.defensiveErrors;
    insights.awayDefensiveErrorsEstimate = ownIsHome ? opponentPossessionAndCorners.defensiveErrors : ownPossessionAndCorners.defensiveErrors;

    // Cross-references corners/long-ball-share against the SPECIFIC
    // opponent's own aerial record -- both sides of aerial/corners/passing
    // are already set above, so this is pure synthesis, zero new requests.
    insights.homeSetPieceThreat = computeSetPieceThreatFlag(insights.homeCornersEstimate, insights.awayAerialEstimate);
    insights.awaySetPieceThreat = computeSetPieceThreatFlag(insights.awayCornersEstimate, insights.homeAerialEstimate);
    insights.homeDirectPlayExposure = computeDirectPlayExposureFlag(insights.homePassingStyle, insights.awayAerialEstimate);
    insights.awayDirectPlayExposure = computeDirectPlayExposureFlag(insights.awayPassingStyle, insights.homeAerialEstimate);

    // Rank record, presence, and rotation all need to know which side (home
    // or away) is "own" vs "opponent" -- computeInsights doesn't have that,
    // so these are filled in here instead and merged into the same object.
    const ownPosition = (ownIsHome ? merged.homeTeamStanding : merged.awayTeamStanding)?.position ?? null;
    const opponentPosition = (ownIsHome ? merged.awayTeamStanding : merged.homeTeamStanding)?.position ?? null;
    opponentForm = computeFormSummary(opponentName, opponentContext.matches);
    const ownRankRecord = computeOpponentRankRecord(form?.last10Overall ?? [], merged.competition, merged.standingsTable, ownPosition);
    const opponentRankRecord = computeOpponentRankRecord(opponentForm.last10Overall, merged.competition, merged.standingsTable, opponentPosition);

    // Candidate names are each team's OWN recent competitions, not the
    // upcoming match's specific competition -- that's often a friendly or
    // cup tie Squawka doesn't track as a league, which would silently
    // return nothing for most searches.
    if (mergedProfile?.squad) mergedProfile.squad = await enrichSquadWithDefensiveStats(mergedProfile.squad, teamName, form?.recentCompetitions ?? []);
    if (opponentProfile?.squad) opponentProfile.squad = await enrichSquadWithDefensiveStats(opponentProfile.squad, opponentName, opponentForm.recentCompetitions);

    const ownDuelVulnerabilities = computeDuelVulnerabilities(mergedProfile?.squad ?? null);
    const opponentDuelVulnerabilities = computeDuelVulnerabilities(opponentProfile?.squad ?? null);
    insights.homeDuelVulnerabilities = ownIsHome ? ownDuelVulnerabilities : opponentDuelVulnerabilities;
    insights.awayDuelVulnerabilities = ownIsHome ? opponentDuelVulnerabilities : ownDuelVulnerabilities;

    const ownFullbackExposure = computeFullbackExposure(mergedProfile?.squad ?? null);
    const opponentFullbackExposure = computeFullbackExposure(opponentProfile?.squad ?? null);
    insights.homeFullbackExposure = ownIsHome ? ownFullbackExposure : opponentFullbackExposure;
    insights.awayFullbackExposure = ownIsHome ? opponentFullbackExposure : ownFullbackExposure;

    const ownPresence = computePresence(
      mergedProfile?.squad ?? null,
      ownIsHome ? merged.homeLineup : merged.awayLineup,
      mergedProfile?.injuries ?? null,
      ownIsHome ? merged.homeSuspendedPlayers : merged.awaySuspendedPlayers,
    );
    const opponentPresence = computePresence(
      opponentProfile?.squad ?? null,
      ownIsHome ? merged.awayLineup : merged.homeLineup,
      opponentProfile?.injuries ?? null,
      ownIsHome ? merged.awaySuspendedPlayers : merged.homeSuspendedPlayers,
    );

    const ownRotation = await computeRotationInfo(teamName, merged.baseSource, matchesBySource.get(formSource!) ?? []);
    const opponentRotation = await computeRotationInfo(opponentName, merged.baseSource, opponentContext.matches);

    insights.homeOpponentRankRecord = ownIsHome ? ownRankRecord : opponentRankRecord;
    insights.awayOpponentRankRecord = ownIsHome ? opponentRankRecord : ownRankRecord;
    insights.homePresence = ownIsHome ? ownPresence : opponentPresence;
    insights.awayPresence = ownIsHome ? opponentPresence : ownPresence;
    insights.homeRotation = ownIsHome ? ownRotation : opponentRotation;
    insights.awayRotation = ownIsHome ? opponentRotation : ownRotation;

    const ownResilience = computeResilience(form?.last10Overall ?? []);
    const opponentResilience = computeResilience(opponentForm.last10Overall);
    insights.homeResilience = ownIsHome ? ownResilience : opponentResilience;
    insights.awayResilience = ownIsHome ? opponentResilience : ownResilience;

    const ownRestPerformance = computeRestPerformance(teamName, matchesBySource.get(formSource!) ?? []);
    const opponentRestPerformance = computeRestPerformance(opponentName, opponentContext.matches);
    insights.homeRestPerformance = ownIsHome ? ownRestPerformance : opponentRestPerformance;
    insights.awayRestPerformance = ownIsHome ? opponentRestPerformance : ownRestPerformance;

    insights.experienceH2H = computeExperienceH2H(insights.experienceComparison, merged.headToHeadSummary, ownIsHome);

    const ownFatigueFlag = computeFatigueFlag(form?.recentCompetitions ?? [], form?.gapsBetweenLastThree ?? []);
    const opponentFatigueFlag = computeFatigueFlag(opponentForm.recentCompetitions, opponentForm.gapsBetweenLastThree);
    insights.homeFatigueFlag = ownIsHome ? ownFatigueFlag : opponentFatigueFlag;
    insights.awayFatigueFlag = ownIsHome ? opponentFatigueFlag : ownFatigueFlag;

    const ownAdvantage = computeHomeAdvantage(form);
    const opponentAdvantage = computeHomeAdvantage(opponentForm);
    insights.homeAdvantage = ownIsHome ? ownAdvantage : opponentAdvantage;
    insights.awayAdvantage = ownIsHome ? opponentAdvantage : ownAdvantage;

    const ownStreakStability = computeStreakStability(form?.currentStreak ?? null, ownRotation);
    const opponentStreakStability = computeStreakStability(opponentForm.currentStreak, opponentRotation);
    insights.homeStreakStability = ownIsHome ? ownStreakStability : opponentStreakStability;
    insights.awayStreakStability = ownIsHome ? opponentStreakStability : ownStreakStability;

    const ownLosingStreakContext = computeLosingStreakContext(form?.currentStreak ?? null, ownXgEstimate);
    const opponentLosingStreakContext = computeLosingStreakContext(opponentForm.currentStreak, opponentXgEstimate);
    insights.homeLosingStreakContext = ownIsHome ? ownLosingStreakContext : opponentLosingStreakContext;
    insights.awayLosingStreakContext = ownIsHome ? opponentLosingStreakContext : ownLosingStreakContext;

    const ownCardRisks = computeCardRisks(mergedProfile?.squad ?? null);
    const opponentCardRisks = computeCardRisks(opponentProfile?.squad ?? null);
    insights.homeCardRisks = ownIsHome ? ownCardRisks : opponentCardRisks;
    insights.awayCardRisks = ownIsHome ? opponentCardRisks : ownCardRisks;

    insights.refereeCardRiskNote = computeRefereeCardRiskNote(merged.referee, merged.refereeStats, insights.homeCardRisks, insights.awayCardRisks);

    const weatherQueryCity = merged.venueCity ?? merged.venueName;
    if (!merged.weather && weatherQueryCity) {
      const weather = await getWttrWeather(weatherQueryCity, merged.kickoffUtc).catch(() => null);
      if (weather) {
        merged.weather = weather;
        merged.fieldSources.weather = "wttr.in";
      }
    }
  }

  onProgress("Done.");
  const generatedAt = new Date().toISOString();
  return { team: teamName, generatedAt, statuses, merged, opponentName, form, formSource, opponentForm, mergedProfile, opponentProfile, insights, venueDetails };
}

// Same markdown this project has always written to output/*.md, just built
// from a RunSearchResult instead of main()'s own local variables -- so the
// CLI and any other caller (the web dashboard's "download .md" button)
// produce byte-identical markdown from the same result object.
export function buildReportMarkdown(result: RunSearchResult): string {
  const { team: teamName, generatedAt, statuses, merged, opponentName, form, formSource, opponentForm, mergedProfile, opponentProfile, insights, venueDetails } = result;
  const mdLines: string[] = [`# ${teamName} — full match report`, "", `_Generated ${generatedAt}_`, "", "## Sources", ""];
  for (const s of statuses) {
    const issues = [s.matchesError, s.detailsError, s.profileError].filter(Boolean);
    mdLines.push(`- ${s.source}: ${s.fixturesScraped} fixtures${issues.length ? ` -- ${issues.join("; ")}` : ""}`);
  }
  mdLines.push("");
  if (merged) {
    mdLines.push("## Next match", "");
    mergedMatchMarkdown(merged, mdLines);
    if (venueDetails) venueDetailsMarkdown(venueDetails, mdLines);
    if (form && formSource) {
      mdLines.push("", `## Form _(base: ${formSource})_`, "");
      formSummaryMarkdown(form, mdLines);
    }
    if (opponentForm && opponentName) {
      mdLines.push("", `## ${opponentName} form _(base: ${merged.baseSource})_`, "");
      formSummaryMarkdown(opponentForm, mdLines);
    }
    if (mergedProfile) mergedProfileMarkdown(mergedProfile, mdLines);
    if (opponentProfile) mergedProfileMarkdown(opponentProfile, mdLines);
    if (insights) insightsMarkdown(insights, merged.homeTeam, merged.awayTeam, mdLines);
    const completeness = computeDataCompleteness(merged, insights);
    mdLines.push("", `**Data completeness:** ${completeness.populated}/${completeness.total} fields populated this run`);
  } else {
    mdLines.push("No upcoming match found from any source.");
  }
  return mdLines.join("\n") + "\n";
}

async function main() {
  const teamName = process.argv.slice(2).join(" ").trim();
  if (!teamName) {
    console.error('Usage: npm run search -- "Team Name"');
    process.exit(1);
  }

  console.log("");
  const result = await runSearch(teamName, (msg) => console.log(msg));
  console.log("");
  const { statuses, merged, form, formSource, opponentName, opponentForm, mergedProfile, opponentProfile, insights, venueDetails, generatedAt } = result;

  printSourceStatus(statuses);

  if (!merged) {
    console.log("No upcoming match found from any source.\n");
  } else {
    printMergedDetails(merged);
    if (venueDetails) printVenueDetails(venueDetails);
    console.log("");
    if (form) {
      console.log(`  Form (base: ${formSource}):`);
      printFormSummary(form);
      console.log("");
    }
    if (opponentForm && opponentName) {
      console.log(`  ${opponentName} form (base: ${merged.baseSource}):`);
      printFormSummary(opponentForm);
      console.log("");
    }
    if (mergedProfile) printMergedProfile(mergedProfile);
    if (opponentProfile) {
      console.log("");
      printMergedProfile(opponentProfile);
    }
    if (insights) {
      console.log("");
      printInsights(insights, merged.homeTeam, merged.awayTeam);
    }
    const completeness = computeDataCompleteness(merged, insights);
    console.log("");
    console.log(`  Data completeness: ${completeness.populated}/${completeness.total} fields populated this run`);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const base = `${slugify(teamName)}-${generatedAt.replace(/[:.]/g, "-")}`;
  const jsonPath = path.join(OUTPUT_DIR, `${base}.json`);
  const mdPath = path.join(OUTPUT_DIR, `${base}.md`);

  await writeFile(jsonPath, JSON.stringify(buildReportJson(result), null, 2), "utf-8");
  await writeFile(mdPath, buildReportMarkdown(result), "utf-8");

  console.log(`Saved:\n  ${jsonPath}\n  ${mdPath}`);
}

// Only auto-run the CLI when this file is executed directly (`tsx
// src/search.ts`) -- guarded so the web dashboard's API route can `import
// { runSearch } from "../../../src/search"` without triggering a CLI
// run (which would print a usage error and process.exit(1) since
// process.argv wouldn't have a team name, killing the whole server).
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
