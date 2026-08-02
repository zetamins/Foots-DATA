import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  LineupPlayer,
  MatchDetails,
  MatchInfo,
  SquadMember,
  TeamProfile,
  TeamStanding,
  TimelineEvent,
} from "../types";
import { stripDiacritics } from "../teamNameMatch";
import { dataReadDir, dataWriteDir } from "../dataDir";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TEAMS_SITEMAP_URL = "https://www.goal.com/en/sitemap/teams.xml";

/**
 * Plain fetch works throughout (no Cloudflare-style block encountered).
 * robots.txt is `Allow: /` for all user-agents -- fully permissive.
 */
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

function extractNextData(html: string): any {
  const marker = "__NEXT_DATA__";
  const i = html.indexOf(marker);
  if (i === -1) throw new Error("__NEXT_DATA__ not found in Goal.com page");
  const start = html.indexOf(">", i) + 1;
  const end = html.indexOf("</script>", start);
  return JSON.parse(html.slice(start, end));
}

interface TeamIndexEntry {
  id: string;
  slug: string;
  url: string;
}

/** Goal.com's own teams sitemap is the only non-search way to resolve a team name to its id. */
async function buildTeamsIndex(): Promise<TeamIndexEntry[]> {
  const xml = await fetchText(TEAMS_SITEMAP_URL);
  const entries: TeamIndexEntry[] = [];
  for (const m of xml.matchAll(/<loc>(https:\/\/www\.goal\.com\/en\/team\/([^/]+)\/([^<]+))<\/loc>/g)) {
    entries.push({ url: m[1], slug: m[2], id: m[3] });
  }
  return entries;
}

async function loadTeamsIndex(): Promise<TeamIndexEntry[]> {
  try {
    const raw = await readFile(path.join(dataReadDir(), "goal-teams.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    const entries = await buildTeamsIndex();
    const dir = dataWriteDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "goal-teams.json"), JSON.stringify(entries), "utf-8");
    return entries;
  }
}

function normalize(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findBestTeamMatch(entries: TeamIndexEntry[], teamName: string): TeamIndexEntry | null {
  const target = normalize(teamName);
  const targetSlug = target.replace(/ /g, "-");

  const exact = entries.find((e) => e.slug === targetSlug);
  if (exact) return exact;

  const candidates = entries.filter((e) => normalize(e.slug).includes(target));
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.slug.length - b.slug.length);
    return candidates[0];
  }

  // Reverse direction: Sofascore's official name is sometimes longer than
  // this source's short slug ("Girona FC" vs slug "girona") -- a 4-char
  // floor (same convention as stadiumdb.ts) keeps this from letting a
  // generic short slug false-match an unrelated longer query.
  const reverseCandidates = entries.filter((e) => {
    const slugNorm = normalize(e.slug);
    return slugNorm.length >= 4 && target.includes(slugNorm);
  });
  if (reverseCandidates.length === 0) return null;
  reverseCandidates.sort((a, b) => b.slug.length - a.slug.length);
  return reverseCandidates[0];
}

function toMatchInfo(m: any): MatchInfo {
  const finished = m.status === "RESULT";
  return {
    source: "goal",
    sourceUrl: `https://www.goal.com/en/match/${m.link.slug}/${m.link.id}`,
    competition: m.competition?.name ?? null,
    homeTeam: m.teamA.name,
    awayTeam: m.teamB.name,
    kickoffUtc: m.startDate ?? null,
    venue: m.venue?.name ?? null,
    status: finished ? "finished" : m.status === "FIXTURE" ? "scheduled" : m.status?.toLowerCase() ?? null,
    homeScore: finished ? m.score?.teamA ?? null : null,
    awayScore: finished ? m.score?.teamB ?? null : null,
    homeScoreHT: null,
    awayScoreHT: null,
    season: null,
    round: null,
    matchId: String(m.link.id),
  };
}

export async function getGoalMatches(teamName: string): Promise<MatchInfo[]> {
  const index = await loadTeamsIndex();
  const team = findBestTeamMatch(index, teamName);
  if (!team) throw new Error(`No Goal.com team found matching "${teamName}"`);

  const url = `https://www.goal.com/en/team/${team.slug}/fixtures-results/${team.id}`;
  const html = await fetchText(url);
  const data = extractNextData(html);
  const matches: any[] = data.props.pageProps.content.matches ?? [];
  return matches.map(toMatchInfo);
}

function extractLineupSide(side: any): LineupPlayer[] | null {
  if (!side?.lineup) return null;
  return side.lineup.map((p: any) => ({ name: p.person.name, position: null, substitute: null, minutesPlayed: null, goals: null, assists: null, xg: null, xa: null, shots: null, shotsOnTarget: null, tackles: null, interceptions: null, fouls: null, rating: null, keyPasses: null }));
}

function formatFormation(f: string | undefined): string | null {
  if (!f) return null;
  return f.split("").join("-");
}

const STAT_CATEGORIES = ["summary", "attacking", "passing", "duels", "defence", "discipline"] as const;

function humanizeStatType(type: string): string {
  return type.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function extractMatchStats(stats: any): { name: string; home: string; away: string }[] | null {
  if (!stats) return null;
  const out: { name: string; home: string; away: string }[] = [];
  const seen = new Set<string>();
  for (const cat of STAT_CATEGORIES) {
    for (const item of stats[cat] ?? []) {
      if (seen.has(item.type)) continue; // "summary" duplicates some entries from other categories
      seen.add(item.type);
      out.push({ name: humanizeStatType(item.type), home: String(item.teamA), away: String(item.teamB) });
    }
  }
  return out.length ? out : null;
}

// Only "MatchGoalEvent" observed in keyEvents across the matches checked
// during research (substitutions/cards exist per-player under lineups
// instead, not merged into a single timeline here).
function extractTimeline(keyEvents: any): TimelineEvent[] | null {
  if (!keyEvents?.length) return null;
  return keyEvents
    .filter((e: any) => e.__typename === "MatchGoalEvent")
    .map((e: any) => ({
      minute: e.period?.minute ?? 0,
      type: "Goal",
      detail: e.assist ? `Assist: ${e.assist.name}` : null,
      player: e.scorer?.name ?? null,
      team: e.side === "TEAM_A" ? "home" : e.side === "TEAM_B" ? "away" : null,
    }))
    .sort((a: TimelineEvent, b: TimelineEvent) => a.minute - b.minute);
}

function extractStanding(rankings: any[] | undefined, teamId: string): TeamStanding | null {
  const row = rankings?.find((r: any) => r.team.id === teamId);
  if (!row) return null;
  return {
    position: row.position,
    played: row.played,
    wins: row.win,
    draws: row.draw,
    losses: row.lose,
    points: row.points,
    goalDiff: String(row.goalsDifference),
    totalTeams: rankings?.length ?? null,
  };
}

/**
 * Goal.com has no venue/referee gap like SoccerDesk -- venue is present, but
 * `referee` was an empty array on every match checked during research
 * (friendlies and competitive Champions League/Premier League fixtures
 * alike), so it's treated as genuinely unpopulated by this source rather
 * than retried or guessed at.
 */
export async function getGoalMatchDetails(match: MatchInfo): Promise<MatchDetails> {
  const html = await fetchText(match.sourceUrl);
  const data = extractNextData(html);
  const content = data.props.pageProps.content;
  const m = content.match;

  const rankings = content.summaryStandings?.table?.rankings;
  const homeTeamId = m.teamA?.id;
  const awayTeamId = m.teamB?.id;

  const h2hStats = content.h2h?.stats;

  return {
    ...match,
    venueName: m.venue?.name ?? null,
    venueCity: null,
    venueCountry: null,
    referee: null,
    refereeStats: null,
    attendance: null,
    weather: null,
    weatherDetail: null,
    headToHeadSummary: h2hStats
      ? { homeWins: h2hStats.teamAWins ?? 0, awayWins: h2hStats.teamBWins ?? 0, draws: h2hStats.draws ?? 0 }
      : null,
    headToHeadStreaks: null,
    recentMeetings: null,
    homeLineup: extractLineupSide(m.lineups?.teamA),
    awayLineup: extractLineupSide(m.lineups?.teamB),
    homeBench: null,
    awayBench: null,
    homeFormation: formatFormation(m.lineups?.teamA?.formation),
    awayFormation: formatFormation(m.lineups?.teamB?.formation),
    homeTeamCountry: null,
    awayTeamCountry: null,
    homeManager: null,
    awayManager: null,
    homeManagerVsAwayClub: null,
    awayManagerVsHomeClub: null,
    standingsTable: null,
    homeSuspendedPlayers: null,
    awaySuspendedPlayers: null,
    homeTeamStanding: extractStanding(rankings, homeTeamId),
    awayTeamStanding: extractStanding(rankings, awayTeamId),
    homeTeamSeasonStats: null,
    awayTeamSeasonStats: null,
    matchStats: extractMatchStats(m.stats),
    eventTimeline: extractTimeline(m.keyEvents),
    setPieceGoals: null,
    playerOfTheMatch: null,
    note: "referee not populated by Goal.com for any match checked; lineups include a `confirmed` flag not surfaced here",
  };
}

/**
 * Squad comes from the team's own /squad/ sub-page (same __NEXT_DATA__
 * pattern as fixtures) -- includes each player's season stats
 * (appearances/goals/assists/cards), captured in seasonStats. No injury
 * status, age, or market value here, and no transfers endpoint was found.
 * Names are abbreviated ("A. Becker") not full names, which matters for
 * cross-source enrichment in search.ts (surname match, not exact match).
 */
export async function getGoalTeamProfile(teamName: string): Promise<TeamProfile> {
  const index = await loadTeamsIndex();
  const team = findBestTeamMatch(index, teamName);
  if (!team) throw new Error(`No Goal.com team found matching "${teamName}"`);

  const url = `https://www.goal.com/en/team/${team.slug}/squad/${team.id}`;
  const html = await fetchText(url);
  const data = extractNextData(html);
  const content = data.props.pageProps.content;
  const players: any[] = content.squad?.players ?? [];

  const squad: SquadMember[] = players.map((p: any) => ({
    name: p.player.name,
    role: p.player.position ?? null,
    injury: null,
    age: null,
    marketValue: null,
    seasonStats: p.stats
      ? {
          appearances: p.stats.appearances ?? 0,
          goals: p.stats.goals ?? 0,
          assists: p.stats.assists ?? 0,
          yellowCards: p.stats.yellowCards ?? 0,
          redCards: p.stats.redCards ?? 0,
          rating: null,
          expectedGoals: null,
        }
      : null,
    seasonStatsSource: p.stats ? "goal" : null,
    defensiveStats: null,
    recentUsage: null,
  }));

  return {
    source: "goal",
    teamName: content.team?.name ?? teamName,
    squad: squad.length ? squad : null,
    averageAge: null,
    injuries: null,
    keyInjuries: null,
    recentTransfers: null,
    missingMidfielders: null, // computed centrally in search.ts after merging
    missingAttackers: null,
    missingDefenders: null,
    missingGoalkeepers: null,
  };
}
