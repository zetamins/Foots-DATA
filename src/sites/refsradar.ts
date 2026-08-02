import { stripDiacritics } from "../teamNameMatch";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * refsradar.com's robots.txt (Allow: / for User-agent: *, only /api/
 * disallowed) permits the referee profile pages themselves -- the page is
 * a React Server Components payload, but it's plain server-rendered text
 * over a normal fetch(), no JS execution needed (confirmed live: the
 * "Fouls/g" figure is readable directly in the raw response body).
 */
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

function normalize(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Slug -> name: "craig-pawson-367" -> "craig pawson". The sitemap lists
// both full-name and abbreviated ("c-pawson-1178") entries for the same
// referee -- preferring the longer slug (more words) picks the full-name
// one when both exist, rather than an arbitrary pick.
function slugToName(slug: string): string {
  return slug.replace(/-\d+$/, "").replace(/-/g, " ");
}

async function findRefereeUrl(refereeName: string): Promise<string | null> {
  const sitemap = await fetchText("https://refsradar.com/sitemap.xml");
  const slugs = [...sitemap.matchAll(/referees\/([a-z0-9-]+)/g)].map((m) => m[1]);
  const target = normalize(refereeName);

  const candidates = slugs
    .map((slug) => ({ slug, name: normalize(slugToName(slug)) }))
    .filter((c) => c.name === target || c.name.includes(target) || target.includes(c.name));
  if (!candidates.length) return null;

  candidates.sort((a, b) => b.name.length - a.name.length);
  return `https://refsradar.com/referees/${candidates[0].slug}`;
}

/**
 * Fouls per game -- the one referee figure neither worldfootball.net
 * (penalties) nor football-data.co.uk (home/away card bias) carries.
 * Best-effort: null if the referee isn't in refsradar's own coverage
 * (27+ leagues, not exhaustive) or the page shape doesn't match.
 */
export async function getRefereeFoulsPerGame(refereeName: string | null): Promise<number | null> {
  if (!refereeName) return null;
  const url = await findRefereeUrl(refereeName).catch(() => null);
  if (!url) return null;

  const html = await fetchText(url).catch(() => null);
  if (!html) return null;

  // Real shape confirmed live: <span class="lab">Fouls/g</span><span
  // class="val num">22.08</span>. Not the same as raw curl output can
  // suggest -- Next.js serves an RSC-JSON payload shape to some request
  // profiles and this plain-HTML shape to others (same page, content
  // negotiated via the "vary: rsc" response header) -- this code path
  // always gets the plain-HTML one in practice.
  const idx = html.indexOf(">Fouls/g<");
  if (idx === -1) return null;
  const window = html.slice(idx, idx + 200);
  const value = window.match(/class="val num">([\d.]+)</)?.[1];
  return value ? Number(value) : null;
}
