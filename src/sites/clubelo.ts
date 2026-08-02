import { stripDiacritics } from "../teamNameMatch";
import type { ClubEloRating } from "../types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * clubelo.com's robots.txt explicitly Allows both the per-club pages and
 * /API$ for User-agent: * -- no browser needed either, api.clubelo.com
 * returns plain CSV over a normal fetch() with no Cloudflare-style
 * challenge (confirmed live, unlike Sofascore/FBref). The /{date} endpoint
 * returns every club's current Elo + rank in one request, reused for both
 * teams in a search rather than fetching per-team.
 */
async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

interface EloRow {
  club: string;
  rank: number;
  elo: number;
}

function normalize(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ClubElo abbreviates a handful of well-known club names differently from
// every other source this project uses (confirmed live) -- normalize/
// substring matching alone doesn't bridge these ("man city" is not a
// substring of "manchester city" or vice versa). Deliberately small and
// hand-maintained, same pattern as geo.ts's static tables: covers names
// that actually showed up in testing, not an exhaustive alias list.
const ALIASES: Record<string, string> = {
  "manchester city": "man city",
  "manchester united": "man united",
  "paris saint germain": "paris sg",
  "internazionale": "inter",
  "real sociedad": "sociedad",
  "athletic bilbao": "ath bilbao",
  "athletic club": "ath bilbao",
  "real betis": "betis",
  "borussia dortmund": "dortmund",
  "bayer leverkusen": "leverkusen",
  "bayern munich": "bayern",
  "atletico madrid": "atletico",
  "wolverhampton wanderers": "wolves",
};

function parseCsv(text: string): EloRow[] {
  const lines = text.trim().split("\n").slice(1); // drop header row
  return lines.map((line) => {
    const [rank, club, , , elo] = line.split(",");
    return { club, rank: Number(rank), elo: Number(elo) };
  });
}

function findRating(rows: EloRow[], teamName: string, asOf: string): ClubEloRating | null {
  const target = normalize(ALIASES[normalize(teamName)] ?? teamName);
  const exact = rows.find((r) => normalize(r.club) === target);
  const hit = exact ?? rows.find((r) => normalize(r.club).includes(target) || target.includes(normalize(r.club)));
  if (!hit || Number.isNaN(hit.elo)) return null;
  return { elo: Math.round(hit.elo), rank: hit.rank, asOf };
}

/**
 * One shared fetch (today's full rankings snapshot) covers both teams --
 * ClubElo has no search-by-name endpoint, so matching happens locally
 * against the full list. Best-effort: a team clubelo doesn't track (lower
 * divisions, some non-European leagues) just resolves to null for that
 * side rather than failing the whole call.
 */
export async function getClubEloRatings(homeTeam: string, awayTeam: string): Promise<{ home: ClubEloRating | null; away: ClubEloRating | null }> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = parseCsv(await fetchCsv(`http://api.clubelo.com/${today}`));
  return { home: findRating(rows, homeTeam, today), away: findRating(rows, awayTeam, today) };
}
