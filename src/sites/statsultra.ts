import { stripDiacritics } from "../teamNameMatch";
import type { ClubStrengthRating } from "../types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * statsultra.com's robots.txt (Content-Signal: use=reference, explicit
 * Allow: / for User-agent: *) only disallows specifically-named crawlers
 * (ClaudeBot, GPTBot, etc.), same distinction this project has drawn
 * throughout -- and unlike worldfootball.net, plain fetch() works with no
 * Cloudflare challenge at all, confirmed live. The whole ratings table (480
 * clubs across 30 leagues, recalculated daily from FootyStats' own data)
 * renders server-side in one page, so one fetch covers every team a search
 * could name -- same "one shared request, match locally" shape as
 * clubelo.ts.
 */
async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

function normalize(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

interface StrengthRow {
  name: string;
  overall: number;
  attack: number;
  defense: number;
}

function parseRows(html: string): StrengthRow[] {
  const rows: StrengthRow[] = [];
  for (const rowHtml of html.split('<tr id="').slice(1)) {
    const name = rowHtml.match(/<span class="full-name">([^<]+)<\/span>/)?.[1];
    const overall = rowHtml.match(/<span class="strength-num">([\d.]+)<\/span>/)?.[1];
    const attack = rowHtml.match(/<span class="profile-num off">([\d.]+)<\/span>/)?.[1];
    const defense = rowHtml.match(/<span class="profile-num def">([\d.]+)<\/span>/)?.[1];
    if (name && overall && attack && defense) {
      rows.push({ name, overall: Number(overall), attack: Number(attack), defense: Number(defense) });
    }
  }
  return rows;
}

function findRating(rows: StrengthRow[], teamName: string): ClubStrengthRating | null {
  const target = normalize(teamName);
  const exact = rows.find((r) => normalize(r.name) === target);
  const hit = exact ?? rows.find((r) => normalize(r.name).includes(target) || target.includes(normalize(r.name)));
  if (!hit) return null;
  return { overall: hit.overall, attack: hit.attack, defense: hit.defense };
}

/**
 * One shared fetch covers both teams -- no per-team search endpoint exists,
 * matching happens locally against the full 480-club table. Best-effort:
 * a team outside statsultra's 30-league coverage just resolves to null for
 * that side.
 */
export async function getClubStrengthRatings(homeTeam: string, awayTeam: string): Promise<{ home: ClubStrengthRating | null; away: ClubStrengthRating | null }> {
  const html = await fetchHtml("https://statsultra.com/club-strength/");
  const rows = parseRows(html);
  return { home: findRating(rows, homeTeam), away: findRating(rows, awayTeam) };
}
