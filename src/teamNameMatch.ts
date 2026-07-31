// Two concrete, repeatedly-observed cross-source team-name mismatch shapes
// found during testing (e.g. "Girona FC" / "Almería" as Sofascore names
// searched against Fotmob, Goal.com, SoccerDesk):
//
// 1. Diacritics: source APIs/indexes are inconsistent about accented
//    characters ("Almería" vs "Almeria"). The old normalize() in each site
//    file only stripped non a-z0-9 characters, which turns "í" into a
//    space rather than "i" -- silently corrupting the name instead of
//    matching it.
// 2. Generic club-entity suffixes: Sofascore's official names often carry
//    a trailing "FC"/"CF"/etc. that other sources' slugs/search indexes
//    drop entirely ("Girona FC" vs slug "girona").
//
// Both are explicit, mechanical, documented transformations -- not guessed
// aliases -- so they generalize to any team with the same shape of mismatch
// rather than only the two that happened to be caught in testing.

const COMBINING_DIACRITICS = /[\u0300-\u036f]/g;

export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(COMBINING_DIACRITICS, "");
}

// Generic entity-type tokens that commonly appear in a club's official name
// but not in the short name other sources index/search by. Deliberately
// conservative -- only tokens seen to be purely decorative across major
// European leagues, never a club's actual identifying word.
const GENERIC_CLUB_TOKENS = new Set(["fc", "cf", "afc", "sc", "ac", "cd", "ud", "sd", "rc", "ec", "ff"]);

export function stripGenericClubTokens(s: string): string {
  const words = s.split(/\s+/).filter((w) => w && !GENERIC_CLUB_TOKENS.has(w.toLowerCase()));
  return words.join(" ").trim();
}

// Ordered, deduped variants worth trying against a live search API (or a
// local index) when the exact team name fails to resolve: original, then
// diacritics stripped, then generic club-suffix stripped from that. Each
// stage only added if it actually differs from what's already queued.
export function nameQueryVariants(teamName: string): string[] {
  const variants = [teamName];
  const noDiacritics = stripDiacritics(teamName);
  if (noDiacritics !== teamName) variants.push(noDiacritics);
  const noSuffix = stripGenericClubTokens(noDiacritics);
  if (noSuffix && !variants.includes(noSuffix)) variants.push(noSuffix);
  return variants;
}
