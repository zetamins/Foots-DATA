import type { Page } from "playwright-core";
import { launchBrowser } from "../browserLaunch";
import { stripDiacritics } from "../teamNameMatch";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * worldfootball.net's robots.txt (Content-Signal: search=yes, ai-train=no,
 * use=reference; explicit Allow: / for User-agent: *) doesn't disallow
 * this path for a normal browser UA -- only specifically-named crawlers
 * (ClaudeBot, GPTBot, etc., in the Cloudflare-managed block) are
 * disallowed, same distinction this project has drawn throughout. It's
 * behind Cloudflare and returns 403 to a plain fetch(), but 200s through a
 * real headless browser (confirmed live) -- the same "satisfy a JS
 * challenge" case as Sofascore, not a harder block like FBref.
 *
 * Only the "big 5" competitions we already have real continental/
 * relegation-spot data for (LEAGUE_STAKES in search.ts) are mapped here --
 * deliberately small, same convention as every other static table in this
 * project. A competition not in this map just resolves to no data rather
 * than guessing at a URL.
 */
const COMPETITION_PATHS: Record<string, string> = {
  "Premier League": "co91/england-premier-league",
  LaLiga: "co97/spain-primera-division",
  "La Liga": "co97/spain-primera-division",
  "Serie A": "co111/italy-serie-a",
  Bundesliga: "co12/germany-bundesliga",
  "Ligue 1": "co71/france-ligue-1",
};

function normalize(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

interface RefereeRow {
  name: string;
  penalties: number | null;
}

async function fetchRefereeTable(page: Page, competitionPath: string): Promise<RefereeRow[]> {
  await page.goto(`https://www.worldfootball.net/competition/${competitionPath}/referees/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  return page.evaluate(() => {
    const tables = [...document.querySelectorAll("table.module-statistics")];
    for (const table of tables) {
      const headerCells = [...(table.querySelector("tr")?.querySelectorAll("th") ?? [])].map((th) => th.textContent?.trim() ?? "");
      const penaltyCol = headerCells.findIndex((h) => h === "11m");
      const nameCol = headerCells.findIndex((h) => h.toLowerCase() === "name");
      if (penaltyCol === -1 || nameCol === -1) continue;
      const rows = [...table.querySelectorAll("tr")].slice(1);
      return rows.map((tr) => {
        const cells = [...tr.querySelectorAll("td")];
        const name = cells[nameCol]?.textContent?.trim() ?? "";
        const penaltyText = cells[penaltyCol]?.textContent?.trim() ?? "";
        const penalties = penaltyText === "" ? null : Number(penaltyText);
        return { name, penalties: Number.isFinite(penalties) ? penalties : null };
      });
    }
    return [];
  });
}

/**
 * Current-season penalties-awarded count for one referee, matched by name
 * against worldfootball.net's own competition referee-stats page. Returns
 * null (not an error) whenever the competition isn't in COMPETITION_PATHS
 * or the referee doesn't appear in that table -- same graceful-degradation
 * as every other supplemental lookup in this project.
 */
export async function getRefereePenaltyCount(competition: string | null, refereeName: string | null): Promise<number | null> {
  if (!competition || !refereeName) return null;
  const path = COMPETITION_PATHS[competition];
  if (!path) return null;

  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    const rows = await fetchRefereeTable(page, path);
    const target = normalize(refereeName);
    const hit = rows.find((r) => normalize(r.name) === target) ?? rows.find((r) => normalize(r.name).includes(target) || target.includes(normalize(r.name)));
    return hit?.penalties ?? null;
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}
