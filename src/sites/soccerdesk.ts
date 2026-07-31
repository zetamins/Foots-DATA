import type {
  LineupPlayer,
  MatchDetails,
  MatchInfo,
  SquadMember,
  TeamProfile,
  TeamStanding,
  TimelineEvent,
} from "../types";
import { nameQueryVariants, stripDiacritics } from "../teamNameMatch";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Unlike Sofascore, SoccerDesk needs no browser at all -- plain fetch works
 * throughout, and www.soccerdesk.com's robots.txt has no real disallow rules
 * (its one Disallow line is a broken unfilled template: "/[sport]/*", which
 * matches no real URL). api.soccerdesk.com (used only for team search) has
 * no robots.txt at all (404) -- per RFC 9309 a missing robots.txt means no
 * crawling restrictions apply.
 */
// Observed one-off Node fetch() ETIMEDOUT/ENETUNREACH pairs (IPv6-first
// dual-stack resolution failing before falling back to IPv4) that a plain
// curl retry immediately resolved -- a couple of quick retries absorbs that
// without needing Sofascore's heavier Cloudflare-oriented backoff schedule.
async function fetchJson(url: string, attempts = 3): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

interface SoccerdeskTeam {
  id: string;
  name: string;
  cname?: string;
}

async function findTeam(teamName: string): Promise<SoccerdeskTeam | null> {
  // SoccerDesk's search endpoint is a strict server-side match, not a fuzzy
  // one -- it returns zero results for "Girona FC" but finds "Girona", and
  // zero results for "Almería" but finds "Almeria". Retrying with the
  // diacritics-stripped / generic-suffix-stripped variants (see
  // teamNameMatch.ts) recovers both without guessing at an alias.
  let teams: SoccerdeskTeam[] = [];
  let query = teamName;
  for (const variant of nameQueryVariants(teamName)) {
    const data = await fetchJson(`https://api.soccerdesk.com/v1/en/search/soccer?userInput=${encodeURIComponent(variant)}`);
    teams = data.teams ?? [];
    if (teams.length) {
      query = variant;
      break;
    }
  }
  if (!teams.length) return null;

  // Diacritic-insensitive on both sides (see 365scores.ts's findTeam for
  // why this matters even when the query itself already succeeded).
  const target = stripDiacritics(query).toLowerCase().trim();
  const exact = teams.find((t) => stripDiacritics(t.name).toLowerCase() === target);
  if (exact) return exact;

  // Prefer the shortest name match (main senior club over "-U18"/"Academy"/"Women" variants)
  const candidates = teams.filter((t) => stripDiacritics(t.name).toLowerCase().includes(target));
  if (!candidates.length) return teams[0];
  candidates.sort((a, b) => a.name.length - b.name.length);
  return candidates[0];
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function parseTimestamp(ts: number | undefined): string | null {
  if (!ts) return null;
  const s = String(ts);
  const y = s.slice(0, 4), mo = s.slice(4, 6), d = s.slice(6, 8), h = s.slice(8, 10), mi = s.slice(10, 12), sec = s.slice(12, 14);
  return `${y}-${mo}-${d}T${h}:${mi}:${sec}.000Z`;
}

// Match-detail lookups (h2h, standings) need the two team ids and the stage
// id, none of which fit cleanly into MatchInfo -- cached here by match id
// (populated during getSoccerdeskMatches, read during getSoccerdeskMatchDetails,
// both called in the same process run by the orchestrator).
interface MatchMeta {
  homeId: string;
  awayId: string;
  stageId: string;
}
const matchMetaCache = new Map<string, MatchMeta>();

function toMatchInfo(m: any): MatchInfo {
  const home = m.teams.find((t: any) => t.pos === 0);
  const away = m.teams.find((t: any) => t.pos === 1);
  const compSlug = slugify(m.c_name);
  const stageSlug = slugify(m.st_name);
  const matchSlug = `${slugify(home.name)}-vs-${slugify(away.name)}`;
  const matchId = m.id;

  matchMetaCache.set(matchId, { homeId: home.id, awayId: away.id, stageId: m.st_id });

  // status: 6 observed for finished friendlies elsewhere in this codebase's
  // research; being conservative and deriving "finished" from score presence
  // plus a past kickoff instead of trusting an undocumented status enum.
  const kickoffUtc = parseTimestamp(m.start);
  const hasScore = Array.isArray(m.score) && m.score[0] != null && m.score[1] != null;
  const isPast = kickoffUtc ? new Date(kickoffUtc).getTime() < Date.now() : false;
  const finished = hasScore && isPast;

  return {
    source: "soccerdesk",
    sourceUrl: `https://www.soccerdesk.com/football/${compSlug}/${stageSlug}/${matchSlug}/${matchId}`,
    competition: m.st_name ? `${m.c_name} - ${m.st_name}` : m.c_name,
    homeTeam: home.name,
    awayTeam: away.name,
    kickoffUtc,
    venue: null,
    status: finished ? "finished" : isPast ? "unknown" : "scheduled",
    homeScore: finished ? m.score[0] : null,
    awayScore: finished ? m.score[1] : null,
    homeScoreHT: null,
    awayScoreHT: null,
  };
}

export async function getSoccerdeskMatches(teamName: string): Promise<MatchInfo[]> {
  const team = await findTeam(teamName);
  if (!team) throw new Error(`No SoccerDesk team found matching "${teamName}"`);

  const data = await fetchJson(`https://www.soccerdesk.com/v1/en/team/soccer/teampage/${team.id}`);
  const all = [...(data.fixtures ?? []), ...(data.results ?? [])];
  return all.map(toMatchInfo);
}

function extractLineupSide(side: any): LineupPlayer[] | null {
  if (!side?.starting) return null;
  return side.starting.map((p: any) => ({ name: p.name, position: null }));
}

// Undocumented incident type codes, reverse-engineered from real match data:
// 1 = substitution (pl_id in, pl_id_o out), 4 = goal (score changes at that
// player). Other codes (cards etc.) may exist but weren't observed in the
// matches checked during research -- unknown codes fall back to "type N".
const INCIDENT_TYPES: Record<number, string> = { 1: "Substitution", 4: "Goal" };

// The outer dict key in `incs` is not team side (it appears to be an
// internal grouping/period id) -- each event's own `pos` field (0/1) is
// what actually marks home/away, confirmed against real match data.
function extractTimeline(incs: any): TimelineEvent[] | null {
  if (!incs) return null;
  const events: TimelineEvent[] = [];
  for (const minutes of Object.values<any>(incs)) {
    for (const items of Object.values<any>(minutes)) {
      for (const e of items as any[]) {
        events.push({
          minute: e.min ?? 0,
          type: INCIDENT_TYPES[e.type] ?? `type ${e.type}`,
          detail: e.type === 1 ? `${e.pl_name} on for ${e.pl_name_o}` : null,
          player: e.pl_name ?? null,
          team: e.pos === 0 ? "home" : e.pos === 1 ? "away" : null,
        });
      }
    }
  }
  return events.length ? events.sort((a, b) => a.minute - b.minute) : null;
}

async function fetchH2H(homeId: string, awayId: string): Promise<{ homeWins: number; awayWins: number; draws: number } | null> {
  const data = await fetchJson(`https://www.soccerdesk.com/v1/en/match/h2h/soccer/1/${homeId}/${awayId}`);
  const matches: any[] = data.h2h?.matches ?? [];
  if (!matches.length) return null;

  const homeNum = Number(homeId.split("-")[1]);
  let homeWins = 0, awayWins = 0, draws = 0;
  for (const m of matches) {
    if (m.win == null) continue;
    if (m.win === 0) draws++;
    else if (m.win === homeNum) homeWins++;
    else awayWins++;
  }
  return { homeWins, awayWins, draws };
}

function extractStanding(rows: any[] | undefined, teamId: string): TeamStanding | null {
  const row = rows?.find((r: any) => r.team_id === teamId);
  if (!row) return null;
  return {
    position: row.ranking,
    played: Number(row.played),
    wins: Number(row.wins),
    draws: Number(row.draws),
    losses: Number(row.loss),
    points: Number(row.points),
    goalDiff: row.goal_difference,
    totalTeams: rows?.length ?? null,
  };
}

/**
 * SoccerDesk genuinely has no venue/referee/attendance/weather/match
 * stats anywhere in its UI (confirmed: the match page only has
 * Info/Lineups/H2H tabs, and none of those strings appear in the raw match
 * JSON) -- those stay null here, not a scraper gap.
 */
export async function getSoccerdeskMatchDetails(match: MatchInfo): Promise<MatchDetails> {
  const matchId = match.sourceUrl.split("/").filter(Boolean).pop()!;
  const data = await fetchJson(`https://www.soccerdesk.com/v1/en/match/soccer/full/${matchId}`);

  const home = data.lineup?.find((l: any) => l.pos === 0);
  const away = data.lineup?.find((l: any) => l.pos === 1);

  const meta = matchMetaCache.get(matchId);
  let headToHeadSummary = null;
  let homeTeamStanding: TeamStanding | null = null;
  let awayTeamStanding: TeamStanding | null = null;
  if (meta) {
    headToHeadSummary = await fetchH2H(meta.homeId, meta.awayId).catch(() => null);
    if (meta.stageId) {
      const stage = await fetchJson(`https://www.soccerdesk.com/v1/en/stage/soccer/${meta.stageId}`).catch(() => null);
      const rows = stage?.L?.tables?.[0]?.teams;
      homeTeamStanding = extractStanding(rows, meta.homeId);
      awayTeamStanding = extractStanding(rows, meta.awayId);
    }
  }

  const injuredNames = [...(home?.injured ?? []), ...(away?.injured ?? [])].map((p: any) => p.name);
  const homeSuspendedNames: string[] = (home?.suspended ?? []).map((p: any) => p.name);
  const awaySuspendedNames: string[] = (away?.suspended ?? []).map((p: any) => p.name);

  return {
    ...match,
    venueName: null,
    venueCity: null,
    venueCountry: null,
    referee: null,
    refereeStats: null,
    attendance: null,
    weather: null,
    headToHeadSummary,
    headToHeadStreaks: null,
    homeLineup: extractLineupSide(home),
    awayLineup: extractLineupSide(away),
    homeFormation: null,
    awayFormation: null,
    homeTeamCountry: null,
    awayTeamCountry: null,
    homeManager: null,
    awayManager: null,
    homeManagerVsAwayClub: null,
    awayManagerVsHomeClub: null,
    standingsTable: null,
    homeSuspendedPlayers: homeSuspendedNames.length ? homeSuspendedNames : null,
    awaySuspendedPlayers: awaySuspendedNames.length ? awaySuspendedNames : null,
    homeTeamStanding,
    awayTeamStanding,
    homeTeamSeasonStats: null,
    awayTeamSeasonStats: null,
    matchStats: null,
    eventTimeline: extractTimeline(data.incs),
    playerOfTheMatch: null,
    note: [
      "venue/referee/attendance/weather/match-stats not available on SoccerDesk",
      injuredNames.length ? `Injured (not playing): ${injuredNames.join(", ")}` : undefined,
      homeSuspendedNames.length || awaySuspendedNames.length ? `Suspended: ${[...homeSuspendedNames, ...awaySuspendedNames].join(", ")}` : undefined,
    ]
      .filter(Boolean)
      .join("; "),
  };
}

/**
 * SoccerDesk's squad list (from the same teampage response used for
 * fixtures) only has name/nationality/jersey number -- no injuries, age, or
 * market value at the team level (those only appear per-match, on players
 * who were actually named in a squad for that game -- see
 * getSoccerdeskMatchDetails' injured/suspended note). No transfers endpoint
 * was found either.
 */
export async function getSoccerdeskTeamProfile(teamName: string): Promise<TeamProfile> {
  const team = await findTeam(teamName);
  if (!team) throw new Error(`No SoccerDesk team found matching "${teamName}"`);

  const data = await fetchJson(`https://www.soccerdesk.com/v1/en/team/soccer/teampage/${team.id}`);
  const squad: SquadMember[] = (data.participants ?? []).map((p: any) => ({
    name: p.name,
    role: null,
    injury: null,
    age: null,
    marketValue: null,
    seasonStats: null,
    seasonStatsSource: null,
    defensiveStats: null,
  }));

  return {
    source: "soccerdesk",
    teamName: data.name ?? teamName,
    squad: squad.length ? squad : null,
    averageAge: null,
    injuries: null,
    keyInjuries: null,
    recentTransfers: null,
    missingMidfielders: null, // computed centrally in search.ts after merging
  };
}
