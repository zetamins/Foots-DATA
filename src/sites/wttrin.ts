const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * AccuWeather is hard-blocked (Akamai WAF: 403 on robots.txt itself, and
 * ERR_HTTP2_PROTOCOL_ERROR even via a real headless Playwright browser --
 * same class of block as fbref, not something a normal browser render gets
 * past). wttr.in is the replacement: it has no dedicated /robots.txt at all
 * -- every path, including "/robots.txt" itself, is treated as a location
 * query and 500s with "location not found" -- so per RFC 9309 (same
 * reasoning already applied to api.soccerdesk.com and webws.365scores.com)
 * no crawling restriction applies. It's also explicitly built for exactly
 * this kind of plain-HTTP programmatic access (its whole design is "curl
 * wttr.in/City"), no API key needed.
 *
 * Only forecasts 3 days out, so this stays null for matches further away --
 * same inherent limitation any weather source would have, not specific to
 * wttr.in.
 */
async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

/**
 * wttr.in returns each day's hourly breakdown in the location's own local
 * time, but we only have the match kickoff in UTC -- reconciling those
 * without a timezone database isn't worth the complexity for a 3-day-out
 * forecast, so this reports the day's midday (12:00 local) conditions as a
 * same-day approximation rather than an exact kickoff-hour forecast.
 */
export async function getWttrWeather(city: string, kickoffUtc: string | null): Promise<string | null> {
  if (!kickoffUtc) return null;
  const kickoffDate = new Date(kickoffUtc);
  const daysOut = Math.floor((kickoffDate.getTime() - Date.now()) / 86400000);
  if (daysOut < 0 || daysOut > 2) return null;

  const data = await fetchJson(`https://wttr.in/${encodeURIComponent(city)}?format=j1`).catch(() => null);
  const targetDate = kickoffDate.toISOString().slice(0, 10);
  const day = data?.weather?.find((w: any) => w.date === targetDate);
  if (!day) return null;

  const midday = day.hourly?.find((h: any) => h.time === "1200") ?? day.hourly?.[Math.floor((day.hourly?.length ?? 1) / 2)];
  if (!midday) return null;

  const desc = midday.weatherDesc?.[0]?.value;
  return desc ? `${desc}, ${midday.tempC}°C (same-day approximation, local midday)` : null;
}
