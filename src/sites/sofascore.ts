import type { Browser, Page } from "playwright-core";
import { launchBrowser } from "../browserLaunch";
import type {
  LineupPlayer,
  ManagerClubRecord,
  ManagerInfo,
  MatchDetails,
  MatchInfo,
  RefereeStats,
  SquadMember,
  TeamProfile,
  TeamSeasonStats,
  TeamStanding,
  TimelineEvent,
  TransferRecord,
} from "../types";
import { stripDiacritics } from "../teamNameMatch";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Sofascore blocks plain HTTP clients at the CDN (Cloudflare) level, so a
 * real headless browser is required just to load any page, including
 * robots.txt itself. Its robots.txt does NOT disallow /api/ (unlike Fotmob
 * and Livescore) -- only standings pages and dated archive URLs are
 * disallowed -- so hitting the same-origin JSON endpoints the site's own
 * pages call (search, team events) is in scope here.
 *
 * Cloudflare's challenge response time is variable -- observed anywhere from
 * ~2s to 40s+ under repeated automated traffic -- so every navigation here
 * goes through retryWithBackoff rather than a single fixed-timeout attempt.
 * Requests within a session are also paced ~800ms apart (see sleep() calls
 * below) and the orchestrator (search.ts) never runs this concurrently with
 * another source, to keep our own traffic pattern from looking bursty.
 */
async function retryWithBackoff<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const delayMs = 3000 * 2 ** i; // 3s, 6s, 12s
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function warmUp(page: Page): Promise<void> {
  await retryWithBackoff(() =>
    page.goto("https://www.sofascore.com/", { waitUntil: "domcontentloaded", timeout: 30000 }),
  );
}

async function fetchJson(page: Page, url: string): Promise<any> {
  return retryWithBackoff(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const text = await page.evaluate(() => document.body.innerText);
    return JSON.parse(text);
  });
}

// Sofascore's 404 responses are still valid JSON (`{"error":{"code":404,...}}`),
// so page.goto()/JSON.parse() never throws for them -- this is for endpoints
// like lineups/statistics that are only published closer to/after kickoff,
// where a 404 means "not published yet", not a fetch failure worth retrying.
async function fetchJsonOptional(page: Page, url: string): Promise<any | null> {
  const data = await fetchJson(page, url);
  return data?.error ? null : data;
}

function normalize(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

interface SofascoreTeam {
  id: number;
  name: string;
  slug: string;
}

// On Vercel specifically, this endpoint reliably comes back
// `{"error":{"code":403,"reason":"challenge"}}` -- confirmed live via a
// temporary diagnostic during development. That's Sofascore/Cloudflare
// actively identifying Vercel's datacenter IP range and hard-blocking it,
// a different and stronger signal than the JS-challenge-on-first-load a
// real headless browser already satisfies for normal (residential)
// traffic. No amount of retrying, waiting, or browser-fingerprint tuning
// gets past an explicit IP-based block like this -- the only way through
// would be routing requests via a different IP (e.g. a residential
// proxy), which is a real step up from "run a real browser to satisfy a
// JS check" into "actively evade an explicit block," and this project has
// held the line against that throughout. So: known, permanent limitation
// when this scraper runs on Vercel specifically, not a bug -- the CLI
// (run from a normal residential/non-datacenter connection) is unaffected.
async function findTeam(page: Page, teamName: string): Promise<SofascoreTeam | null> {
  const data = await fetchJson(
    page,
    `https://www.sofascore.com/api/v1/search/all?q=${encodeURIComponent(teamName)}&page=0`,
  );
  const hit = data.results?.find((r: any) => r.type === "team");
  if (!hit) return null;
  return { id: hit.entity.id, name: hit.entity.name, slug: hit.entity.slug };
}

interface SofascoreEvent {
  id: number;
  slug: string;
  startTimestamp: number;
  status: { type: string; description: string };
  homeTeam: { name: string };
  awayTeam: { name: string };
  tournament: { name: string };
  homeScore?: { current: number; period1: number };
  awayScore?: { current: number; period1: number };
  season?: { name: string };
  roundInfo?: { round: number };
}

function toMatchInfo(e: SofascoreEvent): MatchInfo {
  return {
    source: "sofascore",
    sourceUrl: `https://www.sofascore.com/event/${e.slug}/${e.id}`,
    competition: e.tournament?.name ?? null,
    homeTeam: e.homeTeam.name,
    awayTeam: e.awayTeam.name,
    kickoffUtc: new Date(e.startTimestamp * 1000).toISOString(),
    venue: null,
    status: e.status?.type ?? null,
    homeScore: e.homeScore?.current ?? null,
    awayScore: e.awayScore?.current ?? null,
    homeScoreHT: e.homeScore?.period1 ?? null,
    awayScoreHT: e.awayScore?.period1 ?? null,
    // Undefined (not just absent) for friendlies/cups with no round -- see
    // MatchInfo.round's doc comment.
    season: e.season?.name ?? null,
    round: e.roundInfo?.round ?? null,
    matchId: String(e.id),
  };
}

export async function getSofascoreMatches(teamName: string): Promise<MatchInfo[]> {
  const browser: Browser = await launchBrowser();
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await warmUp(page);

    const team = await findTeam(page, teamName);
    if (!team) throw new Error(`No Sofascore team found matching "${teamName}"`);

    await sleep(800);
    const next = await fetchJson(page, `https://www.sofascore.com/api/v1/team/${team.id}/events/next/0`);
    await sleep(800);
    const last = await fetchJson(page, `https://www.sofascore.com/api/v1/team/${team.id}/events/last/0`);

    const events: SofascoreEvent[] = [...(next.events ?? []), ...(last.events ?? [])];
    return events.map(toMatchInfo);
  } finally {
    await browser.close();
  }
}

// side.players carries the FULL matchday squad (starting XI + bench, both
// used and unused subs) -- confirmed live: a 20-player array for a normal
// matchday (11 + 9), each with its own `substitute` boolean and (once
// played) a `statistics.minutesPlayed`. Filtering here keeps homeLineup/
// awayLineup meaning exactly "starting XI" as every existing caller already
// assumes (computePresence, computeRotationInfo's startingXISize) -- see
// extractBench below for the other half.
function extractLineupPlayer(p: any, substitute: boolean): LineupPlayer {
  const s = p.statistics;
  return {
    name: p.player.name,
    position: p.player.position ?? null,
    substitute,
    minutesPlayed: s?.minutesPlayed ?? null,
    goals: s?.goals ?? null,
    assists: s?.goalAssist ?? null,
    xg: s?.expectedGoals ?? null,
    xa: s?.expectedAssists ?? null,
    shots: s?.totalShots ?? null,
    shotsOnTarget: s?.onTargetScoringAttempt ?? null,
    tackles: s?.totalTackle ?? null,
    interceptions: s?.interceptionWon ?? null,
    fouls: s?.fouls ?? null,
    rating: s?.rating ?? null,
    keyPasses: s?.keyPass ?? null,
  };
}

function extractLineup(side: any): LineupPlayer[] | null {
  if (!side?.players) return null;
  return side.players.filter((p: any) => p.substitute === false).map((p: any) => extractLineupPlayer(p, false));
}

function extractBench(side: any): LineupPlayer[] | null {
  if (!side?.players) return null;
  const bench = side.players.filter((p: any) => p.substitute === true);
  if (!bench.length) return null;
  return bench.map((p: any) => extractLineupPlayer(p, true));
}

function extractRefereeStats(referee: any): RefereeStats | null {
  if (!referee?.games) return null;
  return {
    games: referee.games,
    yellowCards: referee.yellowCards ?? 0,
    redCards: referee.redCards ?? 0,
    yellowCardsPerGame: (referee.yellowCards / referee.games).toFixed(1),
    penaltiesAwarded: null, // computed centrally in search.ts after merging
    homeAwayBias: null,
    foulsPerGame: null,
  };
}

function extractSeasonStats(data: any): TeamSeasonStats | null {
  const s = data?.statistics;
  if (!s) return null;
  return {
    goalsScored: s.goalsScored ?? 0,
    goalsConceded: s.goalsConceded ?? 0,
    cleanSheets: s.cleanSheets ?? 0,
    yellowCards: s.yellowCards ?? 0,
    redCards: s.redCards ?? 0,
    averageBallPossession: s.averageBallPossession ?? null,
  };
}

function extractStanding(rows: any[] | undefined, teamId: number): TeamStanding | null {
  const row = rows?.find((r: any) => r.team.id === teamId);
  if (!row) return null;
  return {
    position: row.position,
    played: row.matches,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    points: row.points,
    goalDiff: row.scoreDiffFormatted,
    totalTeams: rows?.length ?? null,
  };
}

function extractStreaks(streaks: any): string[] | null {
  const items = streaks?.head2head;
  if (!items?.length) return null;
  return items.map((s: any) => `${s.name} (${s.team}): ${s.value}`);
}

function extractMatchStats(stats: any): { name: string; home: string; away: string }[] | null {
  const groups = stats?.statistics?.[0]?.groups;
  if (!groups?.length) return null;
  return groups.flatMap((g: any) => g.statisticsItems.map((it: any) => ({ name: it.name, home: it.home, away: it.away })));
}

// Sofascore has no single "player of the match" field, only a best player
// per side -- taking the higher-rated of the two as the closest equivalent.
function extractPlayerOfTheMatch(best: any): { name: string; rating: string | null } | null {
  const home = best?.bestHomeTeamPlayer;
  const away = best?.bestAwayTeamPlayer;
  const top = [home, away].filter(Boolean).sort((a, b) => Number(b.value) - Number(a.value))[0];
  if (!top) return null;
  return { name: top.player.name, rating: top.value ?? null };
}

// "period" incidents are just HT/FT markers, not real match events -- filtered out.
function extractIncidents(incidents: any): TimelineEvent[] | null {
  const items = incidents?.incidents?.filter((i: any) => i.incidentType !== "period");
  if (!items?.length) return null;
  return items.map((i: any) => ({
    minute: i.time ?? 0,
    type: i.incidentType ?? "unknown",
    detail: i.incidentClass ?? i.reason ?? null,
    player: i.player?.name ?? i.playerIn?.name ?? null,
    team: i.isHome === true ? "home" : i.isHome === false ? "away" : null,
  }));
}

function emptyGoalCounts(): { corner: number; penalty: number; freeKick: number } {
  return { corner: 0, penalty: 0, freeKick: 0 };
}

// Confirmed live: shotmap's own `situation` field on a goal-type shot
// carries "corner", "penalty", "set-piece" (direct free-kicks) alongside
// open-play values ("regular", "assisted", "fast-break") -- a real
// classification the incidents/goal-events endpoint doesn't have
// (incidentClass there only ever showed "regular"/"ownGoal"). Only present
// once a match has actually been played -- empty (not null) for the
// not-yet-played upcoming match, same as other match-in-progress fields.
function extractSetPieceGoals(shotmap: any): MatchDetails["setPieceGoals"] {
  const shots: any[] = shotmap?.shotmap ?? [];
  const home = emptyGoalCounts();
  const away = emptyGoalCounts();
  for (const s of shots) {
    if (s.shotType !== "goal") continue;
    const side = s.isHome ? home : away;
    if (s.situation === "corner") side.corner++;
    else if (s.situation === "penalty") side.penalty++;
    else if (s.situation === "set-piece") side.freeKick++;
  }
  return { home, away };
}

/**
 * Every endpoint below is same-origin /api/v1/... , in scope since
 * Sofascore's robots.txt (unlike Fotmob's) doesn't disallow /api/. Several
 * are genuinely time-gated by the match itself, not scraper limitations:
 * lineups go from absent -> predicted -> confirmed as kickoff approaches;
 * statistics only exist once the match has actually started; standings only
 * exist for competitions that have a league table (not friendlies/one-off
 * cups), resolved via the event's own tournament+season ids. All handled
 * with fetchJsonOptional() rather than retried as transient failures.
 */
function extractManager(rawManager: any): ManagerInfo | null {
  if (!rawManager?.name) return null;
  return { name: rawManager.name, country: rawManager.country?.name ?? null, appointedDate: null, previousManager: null, recentAppointment: null };
}

// See ManagerClubRecord's doc comment for exactly what this is (and isn't).
// The manager's own event history is scanned for finished matches against
// opponentClub; since a manager can't be in charge of both sides in the
// same match, whichever team ISN'T the opponent is treated as "his" team.
async function fetchManagerClubRecord(
  page: Page,
  rawManager: any,
  opponentClub: string,
): Promise<ManagerClubRecord | null> {
  if (!rawManager?.id || !rawManager?.name) return null;
  const data = await fetchJsonOptional(page, `https://www.sofascore.com/api/v1/manager/${rawManager.id}/events/last/0`);
  const events: any[] = data?.events ?? [];
  const target = normalize(opponentClub);
  let sampleSize = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const ev of events) {
    if (ev.status?.type !== "finished") continue;
    const homeIsOpponent = normalize(ev.homeTeam?.name ?? "") === target;
    const awayIsOpponent = normalize(ev.awayTeam?.name ?? "") === target;
    if (homeIsOpponent === awayIsOpponent) continue; // neither, or ambiguous
    const homeGoals = ev.homeScore?.current;
    const awayGoals = ev.awayScore?.current;
    if (homeGoals == null || awayGoals == null) continue;
    const managerGoals = homeIsOpponent ? awayGoals : homeGoals;
    const opponentGoals = homeIsOpponent ? homeGoals : awayGoals;
    sampleSize++;
    if (managerGoals > opponentGoals) wins++;
    else if (managerGoals < opponentGoals) losses++;
    else draws++;
  }
  return { managerName: rawManager.name, opponentClub, sampleSize, wins, draws, losses };
}

export async function getSofascoreMatchDetails(match: MatchInfo): Promise<MatchDetails> {
  const eventId = match.sourceUrl.split("/").filter(Boolean).pop();
  const browser: Browser = await launchBrowser();
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await warmUp(page);

    const eventData = await fetchJson(page, `https://www.sofascore.com/api/v1/event/${eventId}`);
    const e = eventData.event;

    await sleep(800);
    const h2h = await fetchJsonOptional(page, `https://www.sofascore.com/api/v1/event/${eventId}/h2h`);

    await sleep(800);
    const streaks = await fetchJsonOptional(page, `https://www.sofascore.com/api/v1/event/${eventId}/team-streaks`);

    await sleep(800);
    const lineups = await fetchJsonOptional(page, `https://www.sofascore.com/api/v1/event/${eventId}/lineups`);

    await sleep(800);
    const stats = await fetchJsonOptional(page, `https://www.sofascore.com/api/v1/event/${eventId}/statistics`);

    await sleep(800);
    const incidents = await fetchJsonOptional(page, `https://www.sofascore.com/api/v1/event/${eventId}/incidents`);

    await sleep(800);
    const shotmap = await fetchJsonOptional(page, `https://www.sofascore.com/api/v1/event/${eventId}/shotmap`);

    await sleep(800);
    const bestPlayers = await fetchJsonOptional(page, `https://www.sofascore.com/api/v1/event/${eventId}/best-players`);

    let standings: any = null;
    let homeSeasonStats: any = null;
    let awaySeasonStats: any = null;
    const utId = e.tournament?.uniqueTournament?.id;
    const seasonId = e.season?.id;
    if (utId && seasonId) {
      await sleep(800);
      standings = await fetchJsonOptional(
        page,
        `https://www.sofascore.com/api/v1/unique-tournament/${utId}/season/${seasonId}/standings/total`,
      );

      // Team-level season stats (goals, cards, possession) -- found by
      // observing the team page's own "Statistics" tab network calls, same
      // same-origin /api/ pattern as everything else here.
      await sleep(800);
      homeSeasonStats = await fetchJsonOptional(
        page,
        `https://www.sofascore.com/api/v1/team/${e.homeTeam.id}/unique-tournament/${utId}/season/${seasonId}/statistics/overall`,
      );
      await sleep(800);
      awaySeasonStats = await fetchJsonOptional(
        page,
        `https://www.sofascore.com/api/v1/team/${e.awayTeam.id}/unique-tournament/${utId}/season/${seasonId}/statistics/overall`,
      );
    }
    const standingRows = standings?.standings?.[0]?.rows;

    await sleep(800);
    const homeManagerVsAwayClub = await fetchManagerClubRecord(page, e.homeTeam.manager, e.awayTeam.name);
    await sleep(800);
    const awayManagerVsHomeClub = await fetchManagerClubRecord(page, e.awayTeam.manager, e.homeTeam.name);

    return {
      ...match,
      venue: e.venue?.name ?? null,
      venueName: e.venue?.name ?? null,
      venueCity: e.venue?.city?.name ?? null,
      venueCountry: e.venue?.country?.name ?? null,
      referee: e.referee?.name ?? null,
      refereeStats: extractRefereeStats(e.referee),
      attendance: e.attendance ?? null,
      weather: null,
      weatherDetail: null,
      headToHeadSummary: h2h?.teamDuel
        ? {
            homeWins: h2h.teamDuel.homeWins ?? 0,
            awayWins: h2h.teamDuel.awayWins ?? 0,
            draws: h2h.teamDuel.draws ?? 0,
          }
        : null,
      headToHeadStreaks: extractStreaks(streaks),
      recentMeetings: null, // computed centrally in search.ts after merging
      homeLineup: extractLineup(lineups?.home),
      awayLineup: extractLineup(lineups?.away),
      homeBench: extractBench(lineups?.home),
      awayBench: extractBench(lineups?.away),
      homeFormation: lineups?.home?.formation ?? null,
      awayFormation: lineups?.away?.formation ?? null,
      homeTeamCountry: e.homeTeam.country?.name ?? null,
      awayTeamCountry: e.awayTeam.country?.name ?? null,
      homeManager: extractManager(e.homeTeam.manager),
      awayManager: extractManager(e.awayTeam.manager),
      homeManagerVsAwayClub,
      awayManagerVsHomeClub,
      standingsTable: standingRows?.map((r: any) => ({ teamName: r.team.name, position: r.position, points: r.points })) ?? null,
      homeSuspendedPlayers: null,
      awaySuspendedPlayers: null,
      homeTeamStanding: extractStanding(standingRows, e.homeTeam.id),
      awayTeamStanding: extractStanding(standingRows, e.awayTeam.id),
      homeTeamSeasonStats: extractSeasonStats(homeSeasonStats),
      awayTeamSeasonStats: extractSeasonStats(awaySeasonStats),
      matchStats: extractMatchStats(stats),
      eventTimeline: extractIncidents(incidents),
      setPieceGoals: extractSetPieceGoals(shotmap),
      playerOfTheMatch: extractPlayerOfTheMatch(bestPlayers),
      note: [
        lineups ? `lineup ${lineups.confirmed ? "confirmed" : "predicted, not yet confirmed"}` : "lineup not published yet",
        stats ? undefined : "match statistics not available yet (match hasn't started)",
        standingRows ? undefined : "no league standings for this competition",
      ]
        .filter(Boolean)
        .join("; "),
    };
  } finally {
    await browser.close();
  }
}

/**
 * /api/v1/team/{id}/player-statistics/seasons lists every competition this
 * team has season stats for, most recent first -- [0] is the team's primary
 * current competition. /top-players/overall for that competition+season
 * gives per-category leaderboards (goals, assists, rating, xG, cards, etc),
 * each entry carrying the player's own appearance count for that category.
 * Only ~20-25 notable players show up (fringe/youth players with too few
 * minutes are excluded from every category), not the full squad -- same
 * general coverage Goal.com's squad stats give, just via Sofascore itself
 * so names match the squad list exactly (no cross-source name-matching
 * needed).
 */
async function fetchTopPlayerStats(page: Page, teamId: number): Promise<Map<string, SquadMember["seasonStats"]>> {
  const result = new Map<string, NonNullable<SquadMember["seasonStats"]>>();
  const seasons = await fetchJsonOptional(page, `https://www.sofascore.com/api/v1/team/${teamId}/player-statistics/seasons`);
  const primary = seasons?.uniqueTournamentSeasons?.[0];
  const utId = primary?.uniqueTournament?.id;
  const seasonId = primary?.seasons?.[0]?.id;
  if (!utId || !seasonId) return result;

  await sleep(800);
  const data = await fetchJsonOptional(
    page,
    `https://www.sofascore.com/api/v1/team/${teamId}/unique-tournament/${utId}/season/${seasonId}/top-players/overall`,
  );
  const topPlayers = data?.topPlayers ?? {};

  const get = (name: string) => {
    let entry = result.get(name);
    if (!entry) {
      entry = { appearances: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, rating: null, expectedGoals: null };
      result.set(name, entry);
    }
    return entry;
  };

  for (const [category, entries] of Object.entries<any[]>(topPlayers)) {
    for (const e of entries) {
      const entry = get(e.player.name);
      entry.appearances = Math.max(entry.appearances, e.statistics.appearances ?? 0);
      if (category === "goals") entry.goals = e.statistics.goals ?? 0;
      if (category === "assists") entry.assists = e.statistics.assists ?? 0;
      if (category === "yellowCards") entry.yellowCards = e.statistics.yellowCards ?? 0;
      if (category === "redCards") entry.redCards = e.statistics.redCards ?? 0;
      if (category === "rating") entry.rating = e.statistics.rating ?? null;
      if (category === "expectedGoals") entry.expectedGoals = e.statistics.expectedGoals ?? null;
    }
  }

  return result;
}

/**
 * /api/v1/team/{id}/players (squad, with per-player injury field) and
 * /api/v1/team/{id}/transfers -- both same-origin /api/, in scope. No
 * separate /injuries endpoint exists (confirmed: 404) -- injury status is
 * embedded per player instead.
 */
export async function getSofascoreTeamProfile(teamName: string): Promise<TeamProfile> {
  const browser: Browser = await launchBrowser();
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await warmUp(page);

    const team = await findTeam(page, teamName);
    if (!team) throw new Error(`No Sofascore team found matching "${teamName}"`);

    await sleep(800);
    const playersData = await fetchJson(page, `https://www.sofascore.com/api/v1/team/${team.id}/players`);

    await sleep(800);
    const transfersData = await fetchJsonOptional(page, `https://www.sofascore.com/api/v1/team/${team.id}/transfers`);

    await sleep(800);
    const topPlayerStats = await fetchTopPlayerStats(page, team.id);

    const ageFromTimestamp = (ts: number | undefined) =>
      ts ? Math.floor((Date.now() / 1000 - ts) / (365.25 * 24 * 3600)) : null;

    const squad: SquadMember[] = (playersData.players ?? []).map((p: any) => ({
      name: p.player.name,
      role: p.player.position ?? null,
      injury: p.player.injury ? `${p.player.injury.reason ?? "Injured"} (${p.player.injury.status ?? "out"})` : null,
      age: ageFromTimestamp(p.player.dateOfBirthTimestamp),
      marketValue: p.player.proposedMarketValueRaw?.value ?? null,
      seasonStats: topPlayerStats.get(p.player.name) ?? null,
      seasonStatsSource: topPlayerStats.has(p.player.name) ? "sofascore" : null,
      defensiveStats: null,
      recentUsage: null,
    }));

    const transferDate = (t: any) => (t.transferDateTimestamp ? new Date(t.transferDateTimestamp * 1000).toISOString() : null);
    const transfers: TransferRecord[] = [];
    for (const t of transfersData?.transfersIn ?? []) {
      transfers.push({ playerName: t.player.name, direction: "in", fromClub: t.fromTeamName ?? null, toClub: t.toTeamName ?? null, date: transferDate(t) });
    }
    for (const t of transfersData?.transfersOut ?? []) {
      transfers.push({ playerName: t.player.name, direction: "out", fromClub: t.fromTeamName ?? null, toClub: t.toTeamName ?? null, date: transferDate(t) });
    }
    // Sofascore's transfers endpoint isn't scoped to "recent" at all -- it
    // returns entries spanning multiple transfer windows (confirmed live:
    // ~11 months back for Arsenal), unsorted. Without sorting, genuinely
    // distinct dated events (e.g. a player signed, then loaned back to
    // their old club, then signed again the following window) interleave
    // in API order and read as exact duplicates. Sorting most-recent-first
    // fixes the ordering; the date is also now surfaced in search.ts's
    // display so two same-player entries are visibly different events.
    transfers.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

    const ages = squad.map((s) => s.age).filter((a): a is number => a != null);
    const injuries = squad.filter((s) => s.injury !== null);
    const keyInjuries = injuries.length
      ? [...injuries].sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0)).slice(0, 3)
      : null;

    return {
      source: "sofascore",
      teamName: team.name,
      squad,
      averageAge: ages.length ? Number((ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1)) : null,
      injuries,
      keyInjuries,
      recentTransfers: transfers.length ? transfers : null,
      missingMidfielders: null, // computed centrally in search.ts after merging
      missingAttackers: null,
      missingDefenders: null,
      missingGoalkeepers: null,
    };
  } finally {
    await browser.close();
  }
}
