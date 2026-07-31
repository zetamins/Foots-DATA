import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { LineupPlayer, MatchDetails, MatchInfo, SquadMember, TeamProfile, TimelineEvent, TransferRecord } from "../types";
import { stripDiacritics } from "../teamNameMatch";
import { dataReadDir, dataWriteDir } from "../dataDir";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const SITEMAP_INDEX_URL = "https://www.fotmob.com/sitemap/en/teams.xml";

interface TeamIndexEntry {
  id: number;
  slug: string;
  url: string;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

/**
 * Fotmob's own sitemap (allowed by robots.txt) is the only non-API way to
 * resolve a team name to its numeric id + canonical page URL.
 */
async function buildTeamsIndex(): Promise<TeamIndexEntry[]> {
  const indexXml = await fetchText(SITEMAP_INDEX_URL);
  const shardUrls = extractLocs(indexXml);

  const entries: TeamIndexEntry[] = [];
  for (const shardUrl of shardUrls) {
    const xml = await fetchText(shardUrl);
    for (const url of extractLocs(xml)) {
      const match = url.match(/\/teams\/(\d+)\/overview\/([^/?#]+)/);
      if (match) {
        entries.push({ id: Number(match[1]), slug: match[2], url });
      }
    }
  }
  return entries;
}

async function loadTeamsIndex(): Promise<TeamIndexEntry[]> {
  try {
    const raw = await readFile(path.join(dataReadDir(), "fotmob-teams.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    const entries = await buildTeamsIndex();
    const dir = dataWriteDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "fotmob-teams.json"), JSON.stringify(entries), "utf-8");
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
    // Prefer the shortest slug (main senior club page over "-u21"/"-women"/"-fc" variants)
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

interface FotmobFixture {
  id: number;
  pageUrl: string;
  home: { name: string; score?: number };
  away: { name: string; score?: number };
  tournament: { name: string };
  status: {
    utcTime: string;
    started: boolean;
    finished: boolean;
    cancelled: boolean;
  };
}

function extractNextData(html: string): any {
  const marker = "__NEXT_DATA__";
  const i = html.indexOf(marker);
  if (i === -1) throw new Error("__NEXT_DATA__ not found in Fotmob page");
  const start = html.indexOf(">", i) + 1;
  const end = html.indexOf("</script>", start);
  return JSON.parse(html.slice(start, end));
}

async function fetchTeamFixtures(entry: TeamIndexEntry): Promise<FotmobFixture[]> {
  const html = await fetchText(entry.url);
  const data = extractNextData(html);

  const fallback = data.props.pageProps.fallback;
  const key = Object.keys(fallback).find((k) => k.startsWith("team-"));
  if (!key) throw new Error("team fallback key not found in Fotmob __NEXT_DATA__");

  return fallback[key].fixtures.allFixtures.fixtures as FotmobFixture[];
}

export async function getFotmobMatches(teamName: string): Promise<MatchInfo[]> {
  const index = await loadTeamsIndex();
  const team = findBestTeamMatch(index, teamName);
  if (!team) throw new Error(`No Fotmob team found matching "${teamName}"`);

  const fixtures = await fetchTeamFixtures(team);

  return fixtures.map((f) => ({
    source: "fotmob",
    sourceUrl: `https://www.fotmob.com${f.pageUrl}`,
    competition: f.tournament?.name ?? null,
    homeTeam: f.home.name,
    awayTeam: f.away.name,
    kickoffUtc: f.status.utcTime ?? null,
    venue: null,
    status: f.status.cancelled
      ? "cancelled"
      : f.status.finished
        ? "finished"
        : f.status.started
          ? "live"
          : "scheduled",
    // Fotmob's raw fixture data sets score to 0 (not null/absent) for
    // matches that haven't been played yet -- only trust it once finished.
    homeScore: f.status.finished ? (f.home.score ?? null) : null,
    awayScore: f.status.finished ? (f.away.score ?? null) : null,
    // Fotmob's fixtures-list entries don't include a half-time split (only
    // full-time score); Sofascore's do, see sofascore.ts.
    homeScoreHT: null,
    awayScoreHT: null,
  }));
}

function extractLineup(team: any): LineupPlayer[] | null {
  if (!team?.starters) return null;
  // Fotmob only gives a numeric positionId here with no legend on this page
  // to translate it (e.g. GK/DF/MF/FW) -- storing the raw id rather than
  // guessing a mapping that could be wrong.
  return team.starters.map((p: any) => ({ name: p.name, position: p.positionId != null ? String(p.positionId) : null }));
}

// Field names (type/time/player/isHome/newScore) confirmed against a
// finished match's real events array -- this match's own array is empty
// pre-kickoff, which is expected (nothing has happened yet), not a bug.
function extractTimeline(matchFacts: any): TimelineEvent[] | null {
  const events = matchFacts?.events?.events;
  if (!events?.length) return null;
  return events.map((e: any) => ({
    minute: e.time ?? 0,
    type: e.type ?? "unknown",
    detail: e.type === "AddedTime" ? (e.minutesAddedStr ?? null) : null,
    player: e.player?.name ?? null,
    team: e.isHome === true ? "home" : e.isHome === false ? "away" : null,
  }));
}

function extractMatchStats(stats: any): { name: string; home: string; away: string }[] | null {
  const groups = stats?.Periods?.All?.stats;
  if (!groups?.length) return null;
  return groups.flatMap((g: any) =>
    (g.stats ?? []).map((it: any) => ({ name: it.title, home: String(it.stats?.[0] ?? ""), away: String(it.stats?.[1] ?? "") })),
  );
}

function extractPlayerOfTheMatch(potm: any): { name: string; rating: string | null } | null {
  const name = potm?.name?.fullName ?? potm?.name;
  if (!name) return null; // not populated until the match is live/finished
  return { name, rating: potm.rating?.num ?? null };
}

/**
 * `match.sourceUrl` from getFotmobMatches() is a full https://www.fotmob.com/matches/... page.
 * That page's own __NEXT_DATA__ embeds venue, referee, weather, predicted lineups, and h2h --
 * still a plain page GET, no /api/ involved.
 */
function extractSquad(squadData: any): SquadMember[] | null {
  const groups = squadData?.squad;
  if (!groups?.length) return null;
  return groups.flatMap((g: any) =>
    (g.members ?? []).map((m: any) => ({
      name: m.name,
      role: m.role?.fallback ?? null,
      // Fotmob's injury object here only has an id + expectedReturn, no
      // reason text (unlike Sofascore's), so that's all there is to report.
      injury: m.injury ? `Injured, expected return: ${m.injury.expectedReturn ?? "unknown"}` : null,
      age: m.age ?? null,
      marketValue: m.transferValue ?? null,
      seasonStats: null,
      seasonStatsSource: null,
      defensiveStats: null,
    })),
  );
}

function extractTransfers(transfersData: any): TransferRecord[] | null {
  const groups = transfersData?.data;
  if (!groups) return null;
  const out: TransferRecord[] = [];
  for (const [key, list] of Object.entries(groups)) {
    const direction: "in" | "out" = key.toLowerCase().includes("out") ? "out" : "in";
    for (const t of list as any[]) {
      out.push({
        playerName: t.name,
        direction,
        fromClub: t.fromClub ?? null,
        toClub: t.toClub ?? null,
        date: t.transferDate ?? null,
      });
    }
  }
  return out.length ? out : null;
}

/**
 * Reuses the same team page fetched for getFotmobMatches() -- squad and
 * transfers are embedded in the same __NEXT_DATA__ fallback object, so this
 * is just a second GET of a page already established as in scope.
 */
export async function getFotmobTeamProfile(teamName: string): Promise<TeamProfile> {
  const index = await loadTeamsIndex();
  const team = findBestTeamMatch(index, teamName);
  if (!team) throw new Error(`No Fotmob team found matching "${teamName}"`);

  const html = await fetchText(team.url);
  const data = extractNextData(html);
  const fallback = data.props.pageProps.fallback;
  const key = Object.keys(fallback).find((k) => k.startsWith("team-"));
  if (!key) throw new Error("team fallback key not found in Fotmob __NEXT_DATA__");
  const teamData = fallback[key];

  const squad = extractSquad(teamData.squad);
  const ages = squad?.map((s) => s.age).filter((a): a is number => a != null) ?? [];
  const injuries = squad ? squad.filter((s) => s.injury !== null) : null;
  const keyInjuries = injuries?.length
    ? [...injuries].sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0)).slice(0, 3)
    : null;

  return {
    source: "fotmob",
    teamName: teamData.details?.name ?? teamName,
    squad,
    averageAge: ages.length ? Number((ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1)) : null,
    injuries,
    keyInjuries,
    recentTransfers: extractTransfers(teamData.transfers),
    missingMidfielders: null, // computed centrally in search.ts after merging
  };
}

export async function getFotmobMatchDetails(match: MatchInfo): Promise<MatchDetails> {
  const html = await fetchText(match.sourceUrl);
  const data = extractNextData(html);
  const content = data.props.pageProps.content;
  const infoBox = content.matchFacts?.infoBox ?? {};
  const stadium = infoBox.Stadium ?? {};
  const weather = content.weather;

  return {
    ...match,
    venue: stadium.name ?? null,
    venueName: stadium.name ?? null,
    venueCity: stadium.city ?? null,
    venueCountry: stadium.country ?? null,
    referee: infoBox.Referee?.text || null,
    // Fotmob's referee object only has name/country/image, no career stats
    // (unlike Sofascore's, which includes games/cards) -- nothing to report.
    refereeStats: null,
    attendance: infoBox.Attendance ?? null,
    weather: weather ? `${weather.description}, ${weather.temperature}°C` : null,
    // Fotmob's h2h.summary is an undocumented 3-number array with no way to
    // verify which number is home/away/draws from this page alone -- leaving
    // unset rather than guessing at an attribution that could be wrong.
    headToHeadSummary: null,
    headToHeadStreaks: null,
    homeLineup: extractLineup(content.lineup?.homeTeam),
    awayLineup: extractLineup(content.lineup?.awayTeam),
    homeFormation: content.lineup?.homeTeam?.formation ?? null,
    awayFormation: content.lineup?.awayTeam?.formation ?? null,
    homeTeamCountry: null,
    awayTeamCountry: null,
    homeManager: null,
    awayManager: null,
    homeManagerVsAwayClub: null,
    awayManagerVsHomeClub: null,
    standingsTable: null,
    homeSuspendedPlayers: null,
    awaySuspendedPlayers: null,
    // Fotmob's `table` field is just a pointer to a table file on a separate
    // data.fotmob.com host, out of scope here (Sofascore already covers
    // standings), so these stay null for this source.
    homeTeamStanding: null,
    awayTeamStanding: null,
    // Fotmob's team-page `stats` field gives per-player leaderboards (top
    // scorer etc.) with actual values on data.fotmob.com, not team-aggregate
    // season card/goal totals -- confirmed checking a mid-season team.
    homeTeamSeasonStats: null,
    awayTeamSeasonStats: null,
    matchStats: extractMatchStats(content.stats),
    eventTimeline: extractTimeline(content.matchFacts),
    playerOfTheMatch: extractPlayerOfTheMatch(content.matchFacts?.playerOfTheMatch),
    note: content.lineup?.lineupType === "lastStartingLineups" ? "lineup is last known XI, not confirmed" : undefined,
  };
}
