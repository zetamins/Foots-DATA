import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { VenueDetails } from "../types";
import { stripDiacritics } from "../teamNameMatch";
import { dataReadDir, dataWriteDir } from "../dataDir";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Plain fetch works throughout -- robots.txt only disallows /lay-gfx/, no
 * AI-bot blocks. No sitemap or search endpoint exists on the site, so team
 * name -> stadium page resolution goes through the same per-country listing
 * pages a human visitor would browse: /stadiums (country code index, cached
 * once) -> /stadiums/{code} (every stadium in that country with its club(s)
 * and capacity, one page, no pagination even for England's 125 entries) ->
 * /stadiums/{code}/{slug} (the actual capacity/inauguration/renovation
 * facts). Three requests total per lookup, only the first ever repeated
 * across runs.
 */
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

interface CountryEntry {
  code: string;
  name: string;
}

async function buildCountryIndex(): Promise<CountryEntry[]> {
  const html = await fetchText("https://stadiumdb.com/stadiums");
  const entries: CountryEntry[] = [];
  for (const m of html.matchAll(/<a href="https:\/\/stadiumdb\.com\/stadiums\/([a-z]{3})"[^>]*>([^<]+)/g)) {
    entries.push({ code: m[1], name: m[2].trim() });
  }
  return entries;
}

async function loadCountryIndex(): Promise<CountryEntry[]> {
  try {
    const raw = await readFile(path.join(dataReadDir(), "stadiumdb-countries.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    const entries = await buildCountryIndex();
    const dir = dataWriteDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "stadiumdb-countries.json"), JSON.stringify(entries), "utf-8");
    return entries;
  }
}

function normalize(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Handles the handful of naming mismatches seen against other sources'
// venueCountry values ("USA" vs StadiumDB's "United States of America",
// etc) on top of plain substring matching.
const COUNTRY_ALIASES: Record<string, string> = {
  usa: "united states of america",
  "united states": "united states of america",
  "south korea": "south korea",
  "korea republic": "south korea",
  uae: "united arab emirates",
};

function resolveCountryCode(entries: CountryEntry[], countryName: string): string | null {
  const target = COUNTRY_ALIASES[normalize(countryName)] ?? normalize(countryName);
  const exact = entries.find((e) => normalize(e.name) === target);
  if (exact) return exact.code;
  const partial = entries.find((e) => normalize(e.name).includes(target) || target.includes(normalize(e.name)));
  return partial?.code ?? null;
}

interface StadiumRow {
  url: string;
  stadiumName: string;
  city: string;
  clubs: string[];
  capacity: number | null;
}

function parseCountryPage(html: string): StadiumRow[] {
  const rows: StadiumRow[] = [];
  const rowRe =
    /<a href="(https:\/\/stadiumdb\.com\/stadiums\/[a-z]{3}\/[a-z0-9_]+)" class="nu-reward">([^<]+)<\/a>\s*<\/td>\s*<td>\s*([^<]*?)\s*<\/td>\s*<td>\s*([^<]*?)\s*<\/td>\s*<td class="figure">\s*([\d\s]*?)\s*<\/td>/g;
  for (const m of html.matchAll(rowRe)) {
    const capacityDigits = m[5].replace(/\s/g, "");
    rows.push({
      url: m[1],
      stadiumName: m[2].trim(),
      city: m[3].trim(),
      // "-" means "no club plays here" (motor speedways, athletics venues,
      // etc, since StadiumDB isn't football-only) -- must be dropped before
      // matching, not just filtered for emptiness, since normalize("-") is
      // "" and "".length === 0 substring-matches everything.
      clubs: m[4].split(",").map((c) => c.trim()).filter((c) => Boolean(c) && c !== "-"),
      capacity: capacityDigits ? Number(capacityDigits) : null,
    });
  }
  return rows;
}

function findClubRow(rows: StadiumRow[], teamName: string): StadiumRow | null {
  const target = normalize(teamName);
  // Guard against degenerate substring matches: a normalized club name
  // shorter than 4 chars ("PSG", "AEK") is too easy to false-positive
  // against an unrelated multi-word team name via .includes().
  const fuzzyOk = (c: string) => c.length >= 4 && (c.includes(target) || target.includes(c));
  return (
    rows.find((r) => r.clubs.some((c) => normalize(c) === target)) ??
    rows.find((r) => r.clubs.some((c) => fuzzyOk(normalize(c)))) ??
    null
  );
}

function parseStadiumPage(html: string): { capacity: number | null; opened: number | null; renovated: string | null } {
  const table = html.match(/<table class="stadium-info">([\s\S]*?)<\/table>/)?.[1] ?? "";
  const field = (label: string) => {
    const re = new RegExp(`<th>\\s*${label}\\s*<\\/th>\\s*<td>\\s*([^<]*?)\\s*<\\/td>`, "i");
    return table.match(re)?.[1]?.trim() ?? null;
  };
  const capacityStr = field("Capacity");
  const openedStr = field("Inauguration");
  return {
    capacity: capacityStr ? Number(capacityStr.replace(/\s/g, "")) || null : null,
    opened: openedStr ? Number(openedStr.match(/\d{4}/)?.[0]) || null : null,
    renovated: field("Renovations"),
  };
}

/**
 * Resolves by CLUB name (the country listing page has a "Clubs" column),
 * not by venue name -- more reliable, since sponsor-naming differences
 * between sources ("Etihad Stadium" vs "City of Manchester Stadium",
 * "Hill Dickinson Stadium" vs "Everton Stadium") would break a venue-name
 * match far more often than a club-name match. Needs the searched team's
 * own country (from the merged match's venueCountry) to pick which
 * per-country page to search -- returns null without it, or if that
 * country isn't in StadiumDB's index, or if no row's club list matches.
 */
export async function getStadiumDbVenueDetails(teamName: string, venueCountry: string | null): Promise<VenueDetails | null> {
  if (!venueCountry) return null;
  const countries = await loadCountryIndex();
  const code = resolveCountryCode(countries, venueCountry);
  if (!code) return null;

  const countryHtml = await fetchText(`https://stadiumdb.com/stadiums/${code}`);
  const rows = parseCountryPage(countryHtml);
  const row = findClubRow(rows, teamName);
  if (!row) return null;

  const detailHtml = await fetchText(row.url);
  const { capacity, opened, renovated } = parseStadiumPage(detailHtml);

  return {
    stadiumName: row.stadiumName,
    capacity: capacity ?? row.capacity,
    opened,
    renovated,
    clubs: row.clubs,
    sourceUrl: row.url,
  };
}
