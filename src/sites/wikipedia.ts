const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Wikipedia's robots.txt disallows /w/ (the MediaWiki action API used for
 * search/query) and /api/ for generic user-agents -- only a few narrow
 * paths are explicitly allowed there (action=mobileview, load.php,
 * api/rest_v1/?doc, which is documentation only). Plain article pages
 * under /wiki/ are NOT disallowed (only /wiki/Special:... and other
 * meta/admin namespaces are), so this fetches the rendered article page
 * directly by constructing the URL from the manager's name, rather than
 * using the search API to resolve it first. A manager whose Wikipedia
 * title doesn't exactly match the name string we have (rare disambiguation
 * cases) just resolves to null rather than guessing further.
 */
async function fetchArticleHtml(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  return res.text();
}

// Footnote reference markers (<sup class="reference">...</sup>) carry a
// data-mw JSON attribute with the citation's raw wikitext inside it,
// including literal unescaped `>` characters (from `&lt;ref>` -- only the
// opening angle bracket gets HTML-entity-escaped) -- a naive <[^>]+> strip
// terminates early on those and leaks citation text into the cell.
// Truncating at the first <sup before stripping avoids that entirely: the
// actual cell content (a date, or "Present") always comes before any
// footnote marker in these tables.
function stripTags(html: string): string {
  return html
    .split(/<sup\b/i)[0]
    .replace(/<[^>]+>/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .trim();
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// Parses "22 December 2019" as UTC midnight directly (Date.UTC), rather
// than `new Date(s)` -- which parses as LOCAL midnight before .toISOString()
// converts back to UTC, silently shifting the date by a day depending on
// the running machine's timezone. Confirmed live: this project runs in an
// environment where that shift actually happened.
function parseWikiDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month === -1) return null;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[1]))).toISOString();
}

/**
 * Every notable football manager's Wikipedia page carries a standardized
 * "Managerial record by team and tenure" table (Team/From/To/Record
 * columns), regardless of league or country -- more universal than any
 * single league's own "current managers" list page (which only exists,
 * with real appointment dates, for England's top four divisions). The row
 * whose "To" cell reads "Present" is their current job, and its "From"
 * cell is the appointment date -- but not every current job is marked
 * "Present": a manager on a fixed-term contract (confirmed live: Pep
 * Guardiola's Man City row shows an actual end date, "30 June 2026", not
 * "Present", even while he's still in the job) just gets a specific date
 * there instead. Falling back to the LAST real team row in the table
 * (chronological order) when no "Present" row exists covers that case --
 * this can occasionally be stale if Wikipedia hasn't updated a departure
 * yet, the same kind of "as current as the source's own data" caveat this
 * project already carries for standings-based signals elsewhere.
 */
export async function getManagerAppointmentDate(managerName: string): Promise<string | null> {
  const html = await fetchArticleHtml(managerName);
  if (!html) return null;

  // Most pages use a "Managerial statistics" subheading; some (e.g. Pep
  // Guardiola's) put the same table directly under a plain "Managerial"
  // section instead -- confirmed live, both lead straight into the same
  // table shape.
  const headingIdx = html.indexOf('id="Managerial_statistics"') !== -1 ? html.indexOf('id="Managerial_statistics"') : html.indexOf('id="Managerial"');
  if (headingIdx === -1) return null;
  const tableStart = html.indexOf("<table", headingIdx);
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableStart === -1 || tableEnd === -1) return null;
  const tableHtml = html.slice(tableStart, tableEnd);

  const rawRows = tableHtml.split(/<tr[ >]/i).slice(1);
  const teamRows = rawRows
    .map((row) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1])))
    // The final row is a career-totals summary (no team name, just numbers) -- excluded by requiring a non-numeric first cell.
    .filter((cells) => cells.length >= 3 && cells[0] && !/^[\d,]+$/.test(cells[0]));
  if (!teamRows.length) return null;

  const presentRow = teamRows.find((cells) => /present/i.test(cells[2]));
  const from = presentRow ? presentRow[1] : teamRows[teamRows.length - 1][1];
  return parseWikiDate(from);
}

// Every cell in a row, <th> or <td> alike, in document order -- clubs'
// list pages aren't consistent about which one holds the manager name
// (confirmed live: Arsenal's uses <th scope="row"> for it, Manchester
// City's uses a plain first <td>), so cells are read generically here and
// matched against the header row's own column order instead of a
// hardcoded position.
function rowCells(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => {
    const link = m[1].match(/<a[^>]*title="([^"]+)"[^>]*>/i)?.[1];
    return link ?? stripTags(m[1]);
  });
}

/**
 * Clubs' own "List of {Club} managers" Wikipedia pages -- chronologically
 * ordered, current manager last (confirmed live: Arsenal's table ends with
 * Arteta, "To" = Present). Tries the "F.C." title variant first (the more
 * common English-club naming), then a plain variant, since club-list page
 * titles aren't as predictable as an individual manager's own page name.
 * Returns the manager immediately before whichever row is current -- best-
 * effort, same "may lag a real-world change until Wikipedia updates"
 * caveat as getManagerAppointmentDate.
 */
export async function getPreviousManager(clubName: string): Promise<string | null> {
  const candidates = [`List of ${clubName} F.C. managers`, `List of ${clubName} managers`];
  let html: string | null = null;
  for (const title of candidates) {
    html = await fetchArticleHtml(title);
    if (html) break;
  }
  if (!html) return null;

  // Not necessarily the first <table> on the page -- some clubs' articles
  // (confirmed live: Liverpool's) have an earlier plain formatting/legend
  // table ("Key to record: Pld = Matches played...") before the real data
  // table. Scanning every table for one whose own header row actually has
  // "Manager" and "To" columns finds the right one regardless of position.
  let nameCol = -1, toCol = -1, rows: string[][] = [];
  let searchFrom = 0;
  while (true) {
    const tableStart = html.indexOf("<table", searchFrom);
    if (tableStart === -1) break;
    const tableEnd = html.indexOf("</table>", tableStart);
    if (tableEnd === -1) break;
    const rawRows = html.slice(tableStart, tableEnd).split(/<tr[ >]/i).slice(1);
    searchFrom = tableEnd + 8;
    if (!rawRows.length) continue;

    const headerCells = rowCells(rawRows[0]).map((c) => c.toLowerCase());
    const candidateName = headerCells.findIndex((c) => c === "manager");
    const candidateTo = headerCells.findIndex((c) => c === "to");
    if (candidateName === -1 || candidateTo === -1) continue;

    nameCol = candidateName;
    toCol = candidateTo;
    rows = rawRows.slice(1).map((row) => rowCells(row)).filter((cells) => cells.length > Math.max(candidateName, candidateTo) && cells[candidateName]);
    break;
  }
  if (nameCol === -1 || rows.length < 2) return null;

  const presentIdx = rows.findIndex((cells) => /present/i.test(cells[toCol]));
  const currentIdx = presentIdx !== -1 ? presentIdx : rows.length - 1;
  return currentIdx > 0 ? rows[currentIdx - 1][nameCol] : null;
}
