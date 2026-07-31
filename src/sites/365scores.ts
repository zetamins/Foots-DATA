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

const BASE = "https://webws.365scores.com/web";
const COMMON = "appTypeId=5&langId=1&timezoneName=UTC&userCountryId=190";

/**
 * Plain fetch works throughout, no browser needed. webws.365scores.com (the
 * actual data API) has no robots.txt at all (a 404) -- per RFC 9309 that
 * means no crawling restrictions apply. www.365scores.com's own robots.txt
 * has no /api/-style disallow either, and even explicitly allows team pages
 * ("Allow: star/team/[0-9]star").
 */
async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

interface Competitor {
  id: number;
  name: string;
  nameForURL: string;
  type: number;
}

async function findTeam(teamName: string): Promise<Competitor | null> {
  // See teamNameMatch.ts -- retries with diacritics/generic-suffix-stripped
  // variants when the exact query returns nothing, same as soccerdesk.ts.
  let competitors: Competitor[] = [];
  let query = teamName;
  for (const variant of nameQueryVariants(teamName)) {
    const data = await fetchJson(`${BASE}/search/?${COMMON}&query=${encodeURIComponent(variant)}&filter=all`);
    competitors = data.competitors ?? [];
    if (competitors.length) {
      query = variant;
      break;
    }
  }
  if (!competitors.length) return null;

  // Diacritic-insensitive on both sides: the search query can succeed with
  // real results (e.g. "Almería" does return competitors) while still
  // mismatching locally if compared byte-for-byte against an accented
  // target -- e.g. "Almeria" (the real club, no accent in 365scores' own
  // data) failing to match target "almería" (with accent) here would let
  // "Unicaja Almería" (a same-city, differently-accented, wrong entity)
  // win the substring/shortest-name tiebreak instead.
  const target = stripDiacritics(query).toLowerCase().trim();
  const exact = competitors.find((c) => stripDiacritics(c.name).toLowerCase() === target);
  if (exact) return exact;

  const candidates = competitors.filter((c) => stripDiacritics(c.name).toLowerCase().includes(target));
  const pool = candidates.length ? candidates : competitors;
  return [...pool].sort((a, b) => a.name.length - b.name.length)[0];
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Match-detail lookups need homeId/awayId/competitionId, none of which fit
// MatchInfo -- cached here by gameId (populated in getMatches, read in
// getMatchDetails, both called in the same process run by the orchestrator).
interface MatchMeta {
  homeId: number;
  awayId: number;
  competitionId: number;
}
const matchMetaCache = new Map<number, MatchMeta>();

function toMatchInfo(g: any): MatchInfo {
  const home = g.homeCompetitor;
  const away = g.awayCompetitor;
  matchMetaCache.set(g.id, { homeId: home.id, awayId: away.id, competitionId: g.competitionId });

  const finished = g.statusText === "Ended";
  const compSlug = slugify(g.competitionDisplayName ?? "competition");
  const matchSlug = `${slugify(home.name)}-${slugify(away.name)}-${home.id}-${away.id}-${g.competitionId}`;

  return {
    source: "365scores",
    sourceUrl: `https://www.365scores.com/football/match/${compSlug}-${g.competitionId}/${matchSlug}#id=${g.id}`,
    competition: g.competitionDisplayName ?? null,
    homeTeam: home.name,
    awayTeam: away.name,
    kickoffUtc: g.startTime ?? null,
    venue: g.venue?.name ?? null,
    status: finished ? "finished" : g.statusText === "Scheduled" ? "scheduled" : g.statusText?.toLowerCase() ?? null,
    homeScore: finished ? Math.round(home.score) : null,
    awayScore: finished ? Math.round(away.score) : null,
    homeScoreHT: null,
    awayScoreHT: null,
  };
}

/**
 * Combines two endpoints: recentForm (real match history, requested 15 back)
 * and games/current (a narrow window that also covers near-term upcoming
 * fixtures) -- recentForm alone doesn't include future games, and
 * games/current alone only covers a handful of games either side of "now".
 */
export async function get365ScoresMatches(teamName: string): Promise<MatchInfo[]> {
  const team = await findTeam(teamName);
  if (!team) throw new Error(`No 365scores team found matching "${teamName}"`);

  const [recent, current] = await Promise.all([
    fetchJson(`${BASE}/competitors/recentForm?${COMMON}&competitor=${team.id}&numOfGames=15`),
    fetchJson(`${BASE}/games/current/?${COMMON}&competitors=${team.id}&showOdds=false`),
  ]);

  const byId = new Map<number, any>();
  for (const g of [...(recent.games ?? []), ...(current.games ?? [])]) byId.set(g.id, g);
  return [...byId.values()].map(toMatchInfo);
}

function extractLineupSide(competitor: any, nameById: Map<number, string>): LineupPlayer[] | null {
  const members = competitor?.lineups?.members;
  if (!members) return null;
  return members
    .filter((m: any) => m.status === 1) // 1 = Starting XI
    .map((m: any) => ({ name: nameById.get(m.id) ?? "Unknown", position: m.position?.name ?? null }));
}

const EVENT_TYPE_NAMES: Record<number, string> = { 1: "Goal", 1000: "Substitution" };

function extractTimeline(events: any[] | undefined, homeId: number, nameById: Map<number, string>): TimelineEvent[] | null {
  if (!events?.length) return null;
  return events
    .filter((e) => e.isMajor || e.eventType?.id === 1000)
    .map((e) => ({
      minute: e.gameTime ?? 0,
      type: e.eventType?.name ?? EVENT_TYPE_NAMES[e.eventType?.id] ?? `type ${e.eventType?.id}`,
      detail: null,
      player: nameById.get(e.playerId) ?? null,
      team: (e.competitorId === homeId ? "home" : "away") as "home" | "away",
    }))
    .sort((a, b) => a.minute - b.minute);
}

function extractStanding(rows: any[] | undefined, teamId: number): TeamStanding | null {
  const row = rows?.find((r: any) => r.competitor.id === teamId);
  if (!row) return null;
  const stat = (key: string) => Number(row.statsData?.find((s: any) => s.key === key)?.value ?? row[key] ?? 0);
  return {
    position: row.position ?? row.rank,
    played: stat("gamePlayed"),
    wins: stat("gamesWon"),
    draws: stat("gamesEven"),
    losses: stat("gamesLost"),
    points: stat("points"),
    goalDiff: String(stat("ratio")),
    totalTeams: rows?.length ?? null,
  };
}

async function fetchStandingsFor(teamId: number, competitionId: number): Promise<TeamStanding | null> {
  const data = await fetchJson(`${BASE}/standings/?${COMMON}&competitions=&competitor=${teamId}&live=false`).catch(() => null);
  const table = data?.standings?.find((s: any) => s.competitionId === competitionId) ?? data?.standings?.[0];
  return extractStanding(table?.rows, teamId);
}

/**
 * No match-stats (possession/shots) or head-to-head endpoint was found
 * during research within reasonable effort -- rather than keep guessing
 * endpoint names, those stay null here. Venue/referee/lineups/timeline/
 * standings are all confirmed working from real endpoints.
 */
export async function get365ScoresMatchDetails(match: MatchInfo): Promise<MatchDetails> {
  const gameId = Number(match.sourceUrl.split("#id=")[1]);
  const meta = matchMetaCache.get(gameId);
  if (!meta) throw new Error("365scores match metadata not found -- getMatches() must run in the same process first");

  const matchupId = `${meta.homeId}-${meta.awayId}-${meta.competitionId}`;
  const data = await fetchJson(`${BASE}/game/?${COMMON}&gameId=${gameId}&matchupId=${matchupId}`);
  const g = data.game;

  const nameById = new Map<number, string>((g.members ?? []).map((m: any) => [m.id, m.name]));
  const homeLineup = extractLineupSide(g.homeCompetitor, nameById);
  const awayLineup = extractLineupSide(g.awayCompetitor, nameById);

  const [homeStanding, awayStanding] = await Promise.all([
    fetchStandingsFor(meta.homeId, meta.competitionId),
    fetchStandingsFor(meta.awayId, meta.competitionId),
  ]);

  return {
    ...match,
    venueName: g.venue?.name ?? null,
    venueCity: null,
    venueCountry: null,
    referee: g.officials?.[0]?.name ?? null,
    refereeStats: null,
    attendance: g.venue?.attendance ?? null,
    weather: null,
    headToHeadSummary: null,
    headToHeadStreaks: null,
    homeLineup,
    awayLineup,
    homeFormation: g.homeCompetitor?.lineups?.formation ?? null,
    awayFormation: g.awayCompetitor?.lineups?.formation ?? null,
    homeTeamCountry: null,
    awayTeamCountry: null,
    homeManager: null,
    awayManager: null,
    homeManagerVsAwayClub: null,
    awayManagerVsHomeClub: null,
    standingsTable: null,
    homeSuspendedPlayers: null,
    awaySuspendedPlayers: null,
    homeTeamStanding: homeStanding,
    awayTeamStanding: awayStanding,
    homeTeamSeasonStats: null,
    awayTeamSeasonStats: null,
    matchStats: null,
    eventTimeline: extractTimeline(g.events, meta.homeId, nameById),
    playerOfTheMatch: null,
    note: "match stats and head-to-head not available from 365scores (no endpoint found)",
  };
}

/**
 * /web/squads/?competitors={id} gives age/position/height directly per
 * player -- no injury status or transfers endpoint was found during
 * research.
 */
export async function get365ScoresTeamProfile(teamName: string): Promise<TeamProfile> {
  const team = await findTeam(teamName);
  if (!team) throw new Error(`No 365scores team found matching "${teamName}"`);

  const data = await fetchJson(`${BASE}/squads/?${COMMON}&competitors=${team.id}`);
  const athletes: any[] = data.squads?.[0]?.athletes ?? [];

  const squad: SquadMember[] = athletes.map((a) => ({
    name: a.name,
    role: a.position?.name ?? null,
    injury: null,
    age: a.age ?? null,
    marketValue: null,
    seasonStats: null,
    seasonStatsSource: null,
    defensiveStats: null,
  }));

  const ages = squad.map((s) => s.age).filter((a): a is number => a != null);

  return {
    source: "365scores",
    teamName: team.name,
    squad: squad.length ? squad : null,
    averageAge: ages.length ? Number((ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1)) : null,
    injuries: null,
    keyInjuries: null,
    recentTransfers: null,
    missingMidfielders: null, // computed centrally in search.ts after merging
  };
}
