import type { RefereeHomeAwayBias } from "../types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * football-data.co.uk's robots.txt is fully open ("Disallow:" with nothing
 * after it, for User-agent: *) -- plain fetch works, no browser needed.
 * Per-season, per-league CSVs with real per-match data (scores, cards,
 * referee name, shots, etc). Same "big 5" scope as worldfootball.ts/
 * LEAGUE_STAKES -- deliberately small, hand-maintained mapping to this
 * site's own two-letter+digit codes.
 */
const COMPETITION_CODES: Record<string, string> = {
  "Premier League": "E0",
  LaLiga: "SP1",
  "La Liga": "SP1",
  "Serie A": "I1",
  Bundesliga: "D1",
  "Ligue 1": "F1",
};

function seasonCode(offset: number): string {
  const now = new Date();
  // The football calendar year starts around July/August -- before that,
  // "this season" is (lastYear, thisYear); after, it's (thisYear, nextYear).
  const startYear = (now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1) - offset;
  const yy = (y: number) => String(y % 100).padStart(2, "0");
  return `${yy(startYear)}${yy(startYear + 1)}`;
}

async function fetchCsv(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  return res.text();
}

interface MatchRow {
  referee: string;
  homeYellow: number;
  awayYellow: number;
  homeRed: number;
  awayRed: number;
}

// Minimal CSV split -- these files have no quoted commas in the columns
// this parser reads (Referee/HY/AY/HR/AR are all plain tokens), so a naive
// split is safe here even though the file has 100+ columns overall (odds
// data this project doesn't touch).
function parseRows(csv: string): MatchRow[] {
  const lines = csv.trim().split("\n");
  const header = lines[0].split(",");
  const col = (name: string) => header.indexOf(name);
  const idx = { referee: col("Referee"), hy: col("HY"), ay: col("AY"), hr: col("HR"), ar: col("AR") };
  if (Object.values(idx).some((i) => i === -1)) return [];

  const rows: MatchRow[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(",");
    const referee = cells[idx.referee]?.trim();
    if (!referee) continue;
    rows.push({
      referee,
      homeYellow: Number(cells[idx.hy]) || 0,
      awayYellow: Number(cells[idx.ay]) || 0,
      homeRed: Number(cells[idx.hr]) || 0,
      awayRed: Number(cells[idx.ar]) || 0,
    });
  }
  return rows;
}

// football-data.co.uk uses "Initial Surname" ("C Pawson"), unlike
// Sofascore's full first name ("Craig Pawson") -- matching on surname
// alone (last whitespace-separated token) is the reliable common ground,
// same reasoning as search.ts's surname() helper for Goal.com's abbreviated
// names.
function surname(name: string): string {
  const parts = name.trim().toLowerCase().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

/**
 * Tries this season's file first, then last season's -- early in a new
 * season (or before it starts) the current file may be empty or not yet
 * published (confirmed live: the file 404s outright until the season is
 * underway), so falling back to the most recently completed season keeps
 * this from going empty for months at a time. Counts yellow+red combined
 * as "cards" -- same generic definition as CardDisciplineInfo elsewhere in
 * this project.
 */
export async function getRefereeHomeAwayBias(competition: string | null, refereeName: string | null): Promise<RefereeHomeAwayBias | null> {
  if (!competition || !refereeName) return null;
  const code = COMPETITION_CODES[competition];
  if (!code) return null;

  let csv: string | null = null;
  for (const offset of [0, 1]) {
    csv = await fetchCsv(`https://www.football-data.co.uk/mmz4281/${seasonCode(offset)}/${code}.csv`).catch(() => null);
    if (csv) break;
  }
  if (!csv) return null;

  const rows = parseRows(csv);
  const target = surname(refereeName);
  const matches = rows.filter((r) => surname(r.referee) === target);
  if (!matches.length) return null;

  const homeCards = matches.reduce((s, r) => s + r.homeYellow + r.homeRed, 0);
  const awayCards = matches.reduce((s, r) => s + r.awayYellow + r.awayRed, 0);
  return {
    sampleSize: matches.length,
    homeCardsPerGame: Number((homeCards / matches.length).toFixed(2)),
    awayCardsPerGame: Number((awayCards / matches.length).toFixed(2)),
  };
}
