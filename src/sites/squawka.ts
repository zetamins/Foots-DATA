import type { Page } from "playwright-core";
import { launchBrowser } from "../browserLaunch";
import type { DefensiveStats } from "../types";
import { stripDiacritics } from "../teamNameMatch";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Requires Playwright: the data API (`/wp-json/vcsw/v2/statistics`) needs an
 * `X-WP-Nonce` header that's only ever embedded in a page's own server-
 * rendered HTML (`<script id="swp--common-block-args">`), not obtainable any
 * other way -- same category as a normal page's CSRF token, not a bypass of
 * anything (the endpoint itself isn't disallowed by robots.txt; only
 * /wp-admin/ and /cdn-cgi/* are). The competitions list (`window.swpConfig`)
 * comes free on the same page load.
 *
 * Confirmed by direct testing: "Errors Leading to Goals", "Pressures", and
 * "PPDA" are all listed as selectable stat-filter options but return ZERO
 * actual items when queried, in every competition checked -- the option
 * existing doesn't mean the data exists. "Tackles Made", "Interceptions",
 * "Ball Recoveries", and "Clearances" DO return real data and are the only
 * stats this module fetches.
 */
async function loadPageContext(page: Page): Promise<{ nonce: string; competitions: any[] }> {
  await page.goto("https://www.squawka.com/en/stats/clubs/arsenal/", { timeout: 20000, waitUntil: "networkidle" });
  const nonce = await page.evaluate(() => JSON.parse(document.getElementById("swp--common-block-args")!.textContent!).nonce);
  const competitions = await page.evaluate(() => (window as any).swpConfig?.competitions ?? []);
  return { nonce, competitions };
}

function normalize(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Picks the most recent season among duplicate entries for the same competition name. */
// Picking the latest start_date alone picks next season's not-yet-played
// entry once fixtures are announced (confirmed: a "Premier League 2026/27"
// entry existed with zero stats data, since that season hadn't started --
// picking it silently produced empty results for every player). Filtering
// to seasons that have actually started avoids that trap.
function resolveCompetitionId(competitions: any[], competitionName: string): string | null {
  const target = normalize(competitionName);
  const now = Date.now();
  const matches = competitions.filter((c) => normalize(c.competition) === target && new Date(c.start_date).getTime() <= now);
  if (!matches.length) return null;
  matches.sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());
  return matches[0]._id;
}

const STAT_NAMES: { key: keyof DefensiveStats; label: string }[] = [
  { key: "tacklesMade", label: "Tackles Made" },
  { key: "interceptions", label: "Interceptions" },
  { key: "ballRecoveries", label: "Ball Recoveries" },
  { key: "clearances", label: "Clearances" },
  { key: "groundDuelSuccessPct", label: "Ground Duel Success %" },
  { key: "chancesCreated", label: "Chances Created" },
];

async function fetchStatValues(page: Page, nonce: string, competitionId: string, statLabel: string): Promise<Map<string, number>> {
  const result = await page.evaluate(
    async ({ nonce, competitionId, statLabel }) => {
      const res = await fetch("https://www.squawka.com/en/wp-json/vcsw/v2/statistics", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-WP-Nonce": nonce },
        body: JSON.stringify({ sports_type: "football", top_count: 9999, entity_type: "members", competition_id: competitionId, stats: [statLabel] }),
      });
      return res.json();
    },
    { nonce, competitionId, statLabel },
  );
  const values = new Map<string, number>();
  for (const item of result?.items ?? []) {
    const value = item.statistic_groups?.[0]?.statistics?.[0]?.value;
    if (typeof value === "number") values.set(`${normalize(item.name)}::${normalize(item.participant_name)}`, value);
  }
  return values;
}

/**
 * Returns per-player defensive stats for a team, keyed by normalized player
 * name -- null if the competition isn't in Squawka's coverage (skews
 * English/European top leagues; confirmed no Brasileirão, for example) or
 * the team name doesn't match any entry.
 */
/**
 * Takes CANDIDATE competition names (a team's own recent competitions --
 * form.recentCompetitions), not the upcoming match's specific competition.
 * That distinction matters: the upcoming fixture is often a friendly or cup
 * tie ("Club Friendly Games", "Copa Betano do Brasil"), which Squawka
 * obviously doesn't track as a league -- using it directly would silently
 * return nothing for most searches. Tries each candidate in order and uses
 * the first one that actually resolves to a real Squawka competition.
 */
export async function getSquawkaDefensiveStats(teamName: string, competitionCandidates: string[]): Promise<Map<string, DefensiveStats>> {
  const result = new Map<string, DefensiveStats>();
  if (!competitionCandidates.length) return result;

  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    const { nonce, competitions } = await loadPageContext(page);
    let competitionId: string | null = null;
    for (const candidate of competitionCandidates) {
      competitionId = resolveCompetitionId(competitions, candidate);
      if (competitionId) break;
    }
    if (!competitionId) return result;

    const targetTeam = normalize(teamName);
    const byStat: Record<string, Map<string, number>> = {};
    for (const { label } of STAT_NAMES) {
      byStat[label] = await fetchStatValues(page, nonce, competitionId, label);
      await page.waitForTimeout(400);
    }

    const playerKeys = new Set<string>();
    for (const values of Object.values(byStat)) for (const key of values.keys()) playerKeys.add(key);

    for (const key of playerKeys) {
      const [playerNorm, teamNorm] = key.split("::");
      if (teamNorm !== targetTeam) continue;
      const stats: DefensiveStats = { tacklesMade: null, interceptions: null, ballRecoveries: null, clearances: null, groundDuelSuccessPct: null, chancesCreated: null };
      for (const { key: statKey, label } of STAT_NAMES) {
        stats[statKey] = byStat[label].get(key) ?? null;
      }
      result.set(playerNorm, stats);
    }
    return result;
  } catch {
    return result;
  } finally {
    await browser.close();
  }
}
