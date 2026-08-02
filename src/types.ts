export interface MatchInfo {
  source: "sofascore" | "fotmob" | "soccerdesk" | "goal" | "365scores";
  sourceUrl: string;
  competition: string | null;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string | null;
  venue: string | null;
  status: string | null;
  homeScore: number | null;
  awayScore: number | null;
  // Half-time score, when the source provides it (Sofascore only) -- null
  // for Fotmob and for not-yet-played/in-progress matches.
  homeScoreHT: number | null;
  awayScoreHT: number | null;
  // Season label (e.g. "Premier League 25/26") -- Sofascore only, comes free
  // on the same fixture-list/event fetch already made. Null from every other
  // source, which don't expose a distinct season identifier at all.
  season: string | null;
  // Matchday/round number within the competition -- Sofascore only, and only
  // for competitions that actually have rounds (league play); undefined on
  // Sofascore's own payload for cups/friendlies, normalized to null here
  // rather than a missing key.
  round: number | null;
  // The source's own internal match/event id -- always present (every
  // source's data is keyed by one), just never surfaced as its own field
  // before now; sourceUrl already embeds it but not as a bare id a caller
  // can key off directly.
  matchId: string;
}

export interface TeamSearchResult {
  team: string;
  source: MatchInfo["source"];
  matches: MatchInfo[];
  error?: string;
}

export interface LineupPlayer {
  name: string;
  position: string | null;
  // Sofascore only -- null from every other source. homeLineup/awayLineup
  // only ever contain substitute:false entries (the actual starting XI);
  // this field exists so a caller can tell the difference if it ever
  // receives a mixed list (e.g. homeBench below), not because the starting-
  // XI arrays themselves are mixed.
  substitute: boolean | null;
  // Minutes actually played in that specific match -- present only once a
  // match has been played (null for a not-yet-played lineup) and only for
  // players who took the field at all; an unused substitute has no
  // statistics block on Sofascore's own payload, so this stays null for
  // them too (not 0 -- 0 would wrongly imply "played and recorded 0
  // minutes" rather than "never came on").
  minutesPlayed: number | null;
  // Same Sofascore-only, "present once played" pattern as minutesPlayed --
  // from the same per-player statistics block already fetched, confirmed
  // live to actually carry per-match goals/xG/xA/shots/tackles/fouls/
  // rating, not just passing stats.
  goals: number | null;
  assists: number | null;
  xg: number | null;
  xa: number | null;
  shots: number | null;
  shotsOnTarget: number | null;
  tackles: number | null;
  interceptions: number | null;
  fouls: number | null;
  rating: number | null;
  // "keyPass" -- confirmed live present in the same per-player statistics
  // block as the fields above (missed on the first pass through this
  // payload; the earlier dump that didn't show it was truncated).
  keyPasses: number | null;
}

export interface TeamStanding {
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goalDiff: string;
  // Size of the full standings table this position came from -- lets us
  // classify "top of table" / "relegation zone" by position without
  // guessing at a fixed number of teams.
  totalTeams: number | null;
}

export interface SetPieceGoalCounts {
  corner: number;
  penalty: number;
  freeKick: number;
}

export interface TimelineEvent {
  minute: number;
  type: string;
  detail: string | null;
  player: string | null;
  team: "home" | "away" | null;
}

export interface ManagerInfo {
  name: string;
  country: string | null;
  // From the manager's own Wikipedia page ("Managerial record by team and
  // tenure" table, the row whose "To" column reads "Present") -- a more
  // universal source than any single league's "current managers" list page
  // (which only exists, with dates, for England). Null if their Wikipedia
  // page doesn't have that table, or has no "Present" row (e.g. between
  // jobs), or no page was found at all. Computed centrally in search.ts,
  // not per-source -- see getManagerAppointmentDate.
  appointedDate: string | null;
  // From the CLUB's own "List of {Club} managers" Wikipedia page (a
  // different page/table shape than appointedDate's -- see
  // getPreviousManager) -- the manager immediately before the current one
  // in that page's chronological table. Null if no such page was found
  // under either title variant tried, or the table has fewer than 2 rows.
  previousManager: string | null;
  // Derived from appointedDate -- <=90 days old at search time counts as a
  // recent change, the same "generous, round, not competition-tuned"
  // threshold convention as CardDisciplineInfo's elevatedRisk cutoff
  // elsewhere in this file. Null (not false) whenever appointedDate itself
  // is null, so "recent" vs "unknown" stay distinguishable.
  recentAppointment: boolean | null;
}

export interface RefereeStats {
  games: number;
  yellowCards: number;
  redCards: number;
  yellowCardsPerGame: string;
  // From worldfootball.net's own competition referee-stats page (the "11m"
  // -- Elfmeter/penalty -- column), current season only, matched by name.
  // Sofascore's own referee object (games/yellowCards/redCards above) has
  // no penalty field at all -- confirmed live -- so this is the only
  // source for it. Null if the competition isn't one worldfootball.net
  // tracks in our small mapping (see worldfootball.ts), or the referee
  // name doesn't match any row.
  penaltiesAwarded: number | null;
  // From football-data.co.uk's per-season, per-league CSV (real per-match
  // card data, matched by referee surname) -- the only source found for
  // this: worldfootball.net's own referee page has no home/away split, and
  // Sofascore's referee object has neither penalties nor a venue split.
  // Uses last season's file if the current season's isn't published yet
  // (confirmed live: the file 404s outright before a season starts).
  homeAwayBias: RefereeHomeAwayBias | null;
  // From refsradar.com's referee profile page ("Fouls/g") -- confirmed
  // live, plain server-rendered text, no browser needed. The one referee
  // figure the other two supplemental sources above don't carry.
  foulsPerGame: number | null;
}

export interface RefereeHomeAwayBias {
  sampleSize: number;
  homeCardsPerGame: number;
  awayCardsPerGame: number;
}

export interface WeatherDetail {
  tempC: number | null;
  humidityPct: number | null;
  windSpeedKmph: number | null;
  precipMM: number | null;
}

export interface TeamSeasonStats {
  goalsScored: number;
  goalsConceded: number;
  cleanSheets: number;
  yellowCards: number;
  redCards: number;
  averageBallPossession: number | null;
}

export interface MatchDetails extends MatchInfo {
  venueName: string | null;
  venueCity: string | null;
  venueCountry: string | null;
  referee: string | null;
  refereeStats: RefereeStats | null;
  attendance: number | null;
  weather: string | null;
  // Structured companion to `weather` (which stays a display string for
  // backwards compatibility) -- same wttr.in same-day-approximation caveat
  // applies (see getWttrWeather's doc comment): only populated within 2 days
  // of kickoff, from the location's local midday reading.
  weatherDetail: WeatherDetail | null;
  headToHeadSummary: { homeWins: number; awayWins: number; draws: number } | null;
  headToHeadStreaks: string[] | null;
  // Individual past meetings between these two specific clubs, found within
  // the already-fetched recent-form window (last20Overall) for whichever
  // side supplied it -- NOT an exhaustive career head-to-head (Sofascore's
  // own h2h endpoint only returns the aggregate teamDuel/managerDuel tally,
  // confirmed live: no per-meeting match list exists there at all). Capped
  // at the 3 most recent matches found this way, each with one extra
  // details() fetch to pull formations/xG for that specific match.
  recentMeetings: HeadToHeadMeeting[] | null;
  homeLineup: LineupPlayer[] | null;
  awayLineup: LineupPlayer[] | null;
  // Named substitutes for that match (used or unused) -- Sofascore only,
  // the only source whose lineup payload actually distinguishes bench from
  // starting XI (confirmed live: a per-player `substitute` boolean, and
  // `statistics.minutesPlayed` present only for whoever actually appeared).
  // Previously this project had no way to tell "on the bench" from "not in
  // the matchday squad at all" -- this is that fix.
  homeBench: LineupPlayer[] | null;
  awayBench: LineupPlayer[] | null;
  homeTeamStanding: TeamStanding | null;
  awayTeamStanding: TeamStanding | null;
  homeTeamSeasonStats: TeamSeasonStats | null;
  awayTeamSeasonStats: TeamSeasonStats | null;
  matchStats: { name: string; home: string; away: string }[] | null;
  eventTimeline: TimelineEvent[] | null;
  // Sofascore only, from its shotmap endpoint's own `situation` field on
  // goal-type shots -- confirmed live to carry "corner"/"penalty"/
  // "set-piece" (direct free-kick) alongside open-play values, a real
  // classification the incidents/timeline endpoint doesn't have. Only
  // meaningful once a match has been played -- zeroed (not null) for the
  // not-yet-played upcoming match.
  setPieceGoals: { home: SetPieceGoalCounts; away: SetPieceGoalCounts } | null;
  playerOfTheMatch: { name: string; rating: string | null } | null;
  homeFormation: string | null;
  awayFormation: string | null;
  // Each team's own registered country (not the match venue's country) --
  // Sofascore only, comes free on the same event-detail fetch already made
  // for everything else. Used to flag international travel (venueCountry
  // differs from the team's own country), not the venue's country itself.
  homeTeamCountry: string | null;
  awayTeamCountry: string | null;
  // Sofascore only, comes free on the same event-detail fetch -- no extra
  // request for the manager's name/country. See MatchInsights for each
  // manager's record against the opposing club specifically, which DOES
  // cost an extra request per manager.
  homeManager: ManagerInfo | null;
  awayManager: ManagerInfo | null;
  // See ManagerClubRecord doc comment below for exactly what this is (and
  // isn't). Sofascore only, one extra request per manager.
  homeManagerVsAwayClub: ManagerClubRecord | null;
  awayManagerVsHomeClub: ManagerClubRecord | null;
  // Full league table for this match's competition (name + position for
  // every team), not just the two teams playing -- Sofascore only, comes
  // free on the standings fetch already made for homeTeamStanding/
  // awayTeamStanding. Lets us look up any historical opponent's current
  // rank without a dedicated request per opponent.
  standingsTable: { teamName: string; position: number; points: number }[] | null;
  // SoccerDesk only, the one source that publishes this at all. Previously
  // only ever surfaced as free text inside `note`; now real fields so this
  // can be merged into presence (P/A) properly instead of just being a
  // string a person has to read.
  homeSuspendedPlayers: string[] | null;
  awaySuspendedPlayers: string[] | null;
  note?: string;
}

export interface HeadToHeadMeeting {
  date: string | null;
  competition: string | null;
  scoreline: string;
  // Which side of THAT match the team supplying recentMeetings played --
  // same "venue" convention as FormResult.
  venue: "home" | "away";
  homeFormation: string | null;
  awayFormation: string | null;
  // Parsed from that match's own matchStats ("Expected goals" entry, when
  // present) -- null whenever the source didn't publish it for that match.
  homeXg: number | null;
  awayXg: number | null;
  // Same details() fetch already made for formations/xG above -- the
  // starting XI for that specific historical meeting, not the upcoming
  // match's lineup.
  homeLineup: LineupPlayer[] | null;
  awayLineup: LineupPlayer[] | null;
}

export interface SeasonPlayerStats {
  appearances: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  // Sofascore-only extras -- null from every other source.
  rating: number | null;
  expectedGoals: number | null;
}

// Squawka only. No literal "PPDA"/"Pressures"/"Defensive Line Height"/
// "Errors Leading to Goals" stat has any real data behind it on Squawka
// (confirmed: those exact stat names return zero items even though some are
// listed as selectable filter options -- the option existing doesn't mean
// the data exists). These four are genuinely populated, season-total, per-90
// activity counts -- real defensive-workload signals, not the literal
// tactical metrics the original checklist asked for.
export interface DefensiveStats {
  tacklesMade: number | null;
  interceptions: number | null;
  ballRecoveries: number | null;
  clearances: number | null;
  // "Duels Lost" itself returns zero items on Squawka (same empty-option
  // trap as Errors/Pressures/PPDA), but "Ground Duel Success %" does have
  // real data and gets the same answer more directly: below 50% means more
  // ground duels lost than won -- an individual-error/defensive-vulnerability
  // proxy, not literal "errors leading to goals" (still unavailable anywhere).
  groundDuelSuccessPct: number | null;
  // An attacking stat, not defensive -- kept on this type anyway since it's
  // fetched in the same Squawka batch and only ever used alongside the
  // defensive numbers above (full-back exposure: high chancesCreated +
  // below-average groundDuelSuccessPct). "Accurate Crosses"/"Key Passes"/
  // "Final Third Entries" were tried first and all return zero items (the
  // same empty-option trap) -- "Chances Created" is the one creativity stat
  // that actually has real data behind it.
  chancesCreated: number | null;
}

// Rolled up from the same last20Overall enrichment as VenueSplitForm/
// SeasonAdvancedStatsEstimate -- zero extra requests. matchesInSquad counts
// every match the player was named for (starting XI or bench), whether or
// not they actually played -- the direct answer to "0 minutes but named in
// the lineup section means bench," and starts/subAppearances/unusedBench
// split out exactly how they were used each time.
export interface PlayerUsagePattern {
  matchesInSquad: number;
  starts: number;
  subAppearances: number;
  unusedBench: number;
  totalMinutes: number;
  // Summed across the same last20Overall sample, from the same per-match
  // lineup/bench fetch -- zero extra requests. appearancesWithStats counts
  // how many of those matches actually had a statistics block (used to
  // compute avgRating honestly rather than dividing by matchesInSquad,
  // which would include unused-bench matches with no stats at all).
  totalGoals: number;
  totalAssists: number;
  totalXg: number;
  totalXa: number;
  totalShots: number;
  totalShotsOnTarget: number;
  totalTackles: number;
  totalInterceptions: number;
  totalFouls: number;
  totalKeyPasses: number;
  appearancesWithStats: number;
  avgRating: number | null;
  // Pure arithmetic on the totals above (stat / (totalMinutes/90)) -- not
  // new data, just the same numbers normalized to a per-90-minutes rate,
  // the standard way these are compared across players with different
  // amounts of playing time. Null when totalMinutes is 0 (never played).
  goalsPer90: number | null;
  assistsPer90: number | null;
  xgPer90: number | null;
  xaPer90: number | null;
  keyPassesPer90: number | null;
}

export interface SquadMember {
  name: string;
  role: string | null;
  injury: string | null;
  age: number | null;
  marketValue: number | null;
  // Sofascore and Goal.com both provide per-player season totals. Sofascore's
  // come attached directly to its own squad (exact name match, no guessing).
  // Goal.com's are used to fill gaps -- players Sofascore's top-players
  // leaderboard doesn't cover -- enriched by best-effort surname match
  // (search.ts) since Goal.com abbreviates first names.
  seasonStats: SeasonPlayerStats | null;
  seasonStatsSource: MatchInfo["source"] | null;
  // Squawka only, matched onto the squad by name in search.ts (same
  // best-effort approach as seasonStats) -- "squawka" isn't a MatchInfo
  // source, so this stays a separate optional tag rather than reusing
  // seasonStatsSource's type.
  defensiveStats: DefensiveStats | null;
  // Sofascore only, from the last20Overall venue-classification enrichment
  // (search.ts) -- null for a player never named in any of those matches'
  // lineups (e.g. a fresh signing, or the enrichment didn't run/failed).
  recentUsage: PlayerUsagePattern | null;
}

export interface TransferRecord {
  playerName: string;
  direction: "in" | "out";
  fromClub: string | null;
  toClub: string | null;
  date: string | null;
}

export interface TeamProfile {
  source: "fotmob" | "sofascore" | "soccerdesk" | "goal" | "365scores";
  teamName: string;
  squad: SquadMember[] | null;
  averageAge: number | null;
  injuries: SquadMember[] | null;
  // Injuries ranked by squad market value -- an objective proxy for "key
  // player" rather than a subjective label, since neither site labels
  // injuries by importance.
  keyInjuries: SquadMember[] | null;
  recentTransfers: TransferRecord[] | null;
  // Injured players whose role/position reads as a midfield role, pulled
  // from the same injuries list above (name-matching on "M"/"Midfielder"/
  // "MIDFIELDER" -- the different spellings/casings across sources).
  // Empty (not null) when there are injuries but none are midfielders.
  missingMidfielders: string[] | null;
  // Same role-matching approach as missingMidfielders, applied to the other
  // three broad position groups -- name lists only, not a fabricated
  // "strength lost" score, since no source publishes per-position squad
  // depth/quality to compute one against.
  missingAttackers: string[] | null;
  missingDefenders: string[] | null;
  missingGoalkeepers: string[] | null;
}

export interface FormResult {
  opponent: string;
  competition: string | null;
  date: string | null;
  result: "W" | "D" | "L";
  scoreline: string;
  venue: "home" | "away";
  // Absolute goal difference for this result -- 1 means a narrow (one-goal)
  // margin, 0 means a draw.
  margin: number;
  // Whether this specific match was played somewhere other than the team's
  // own country despite the fixture data's home/away label -- e.g. a
  // "home" match relocated to a neutral third country for a preseason tour.
  // null until enriched (see enrichFormWithVenueClassification -- costs one
  // extra details() fetch per match, only run on the last20Overall sample,
  // not the full played history).
  neutralVenue: boolean | null;
  // Half-time score for this specific match ("1-0" format, own team's
  // score first regardless of home/away) -- from the same details() fetch
  // as neutralVenue above, so null under the same conditions (not yet
  // enriched, or that particular match's source didn't publish a HT
  // split). Distinct from FormSummary.halfSplit, which only ever exposed
  // an aggregate across the sample, never a per-match figure.
  htScoreline: string | null;
}

// venue-corrected W/D/L split from the last20Overall sample, once enriched
// -- distinct from FormSummary's homeWinRatePct/awayWinRatePct, which use
// the fixture data's home/away label as-is (uncorrected, but computed over
// the FULL played history, not just the last 20) and don't exist for a
// smaller, more expensive to compute, "true venue" breakdown.
export interface VenueSplitForm {
  homeSampleSize: number;
  homeWins: number;
  homeDraws: number;
  homeLosses: number;
  homeGoalsFor: number;
  homeGoalsAgainst: number;
  awaySampleSize: number;
  awayWins: number;
  awayDraws: number;
  awayLosses: number;
  awayGoalsFor: number;
  awayGoalsAgainst: number;
  neutralSampleSize: number;
  neutralWins: number;
  neutralDraws: number;
  neutralLosses: number;
  neutralGoalsFor: number;
  neutralGoalsAgainst: number;
}

export interface FixtureGap {
  opponent: string;
  date: string | null;
  daysSincePrevious: number | null;
}

export interface HalfSplitStats {
  sampleSize: number;
  firstHalfGoalsFor: number;
  firstHalfGoalsAgainst: number;
  secondHalfGoalsFor: number;
  secondHalfGoalsAgainst: number;
}

export interface StreakInfo {
  result: "W" | "D" | "L";
  count: number;
}

export interface MomentumInfo {
  // Points-per-game, most-recent-3 vs the 3 games before that. "Improving"/
  // "declining" requires a >=0.5 ppg swing; smaller differences are "stable"
  // rather than asserting a trend from noise.
  recentPPG: number;
  priorPPG: number;
  trend: "improving" | "declining" | "stable";
}

// W/D/L split for one competition, drawn from the same played-match sample
// already fetched (matches.next/last, page 0 -- roughly a team's last/next
// ~15-20 fixtures, not a full season) -- not a fresh fetch.
export interface CompetitionFormRecord {
  competition: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

export interface FormSummary {
  last5Overall: FormResult[];
  // Same as last5Overall but 10 deep -- exposed so callers can filter by
  // competition (e.g. "only same-league results") for things last5Overall's
  // fixed window is too small a sample for.
  last10Overall: FormResult[];
  // 20 deep -- the window the venue-classification/advanced-stats/per-
  // player-usage enrichment actually runs against (search.ts), from the
  // same already-fetched raw fixture pool (no new base requests), just a
  // deeper per-match detail pass. Falls back to whatever's actually
  // available if the raw pool has fewer than 20 played matches on record.
  last20Overall: FormResult[];
  last5Home: FormResult[];
  last5Away: FormResult[];
  next5WithGaps: FixtureGap[];
  gapsBetweenLastThree: number[];
  // Only populated where the source records half-time scores (Sofascore's
  // fixture list does, at no extra request cost) -- null if no played match
  // in the sample has both homeScoreHT/awayScoreHT set.
  halfSplit: HalfSplitStats | null;
  // Distinct competitions among recently played matches -- a simple signal
  // for "juggling multiple competitions," not a fatigue judgment itself.
  recentCompetitions: string[];
  // Longest current run of the same result, most recent match first (e.g. 3
  // wins in a row). Null if the most recent two results already differ.
  currentStreak: StreakInfo | null;
  // Win rate from ALL played matches on record (not just last 5) split by
  // venue -- the actual "home advantage" signal; last5Home/last5Away above
  // are just a recent-form snapshot, too small a sample for this.
  homeWinRatePct: number | null;
  awayWinRatePct: number | null;
  momentum: MomentumInfo | null;
  // Share of wins (last 10 played) that were genuinely tight and
  // low-scoring: a 1-goal margin AND 3 total goals or fewer (1-0, 2-1).
  // A 1-goal margin alone would also count high-scoring games like 4-3,
  // which isn't the same thing as a "narrow" win. Null if no wins in the
  // sample.
  narrowWinSharePct: number | null;
  // Among draws (last 10 played), the share that weren't 0-0 -- "found the
  // net despite not winning," a companion to ResilienceInfo (which only
  // looks at W/D/L, not whether a draw was scoreless). Null if no draws in
  // the sample.
  scoringDrawSharePct: number | null;
  // Share of the last 10 played matches where BOTH sides scored (BTTS) --
  // independent of W/D/L, computed from the scoreline string directly.
  // Null if there's no played-match sample at all.
  bttsSharePct: number | null;
  // Longest run of consecutive most-recent played matches with zero goals
  // conceded / zero goals scored, same "run from the most recent match"
  // shape as currentStreak but tracking a different condition. 0 is a real,
  // meaningful value (most recent match already conceded/scored) -- only
  // null when there's no played-match sample at all.
  cleanSheetStreak: number | null;
  scorelessStreak: number | null;
  // Over/Under thresholds -- share of the last 10 played matches whose total
  // goals (both sides, from the scoreline string) exceeded each line. Same
  // "last 10 played, null if no sample" shape as bttsSharePct.
  over15SharePct: number | null;
  over25SharePct: number | null;
  over35SharePct: number | null;
  // Share of the last 10 played matches with a clean sheet / without scoring
  // -- the % companion to cleanSheetStreak/scorelessStreak above, which only
  // track the CURRENT run rather than the overall rate across the sample.
  cleanSheetSharePct: number | null;
  failedToScoreSharePct: number | null;
  // W/D/L broken out per competition, from the same played-match sample as
  // last10Overall/last5Overall -- lets callers see "how have they done in
  // the league specifically" vs "in cup competitions" without a new fetch.
  formByCompetition: CompetitionFormRecord[];
  // Played-match count in the trailing 7/14 days as of now -- a fixture-
  // congestion signal distinct from gapsBetweenLastThree (which measures
  // spacing between specific matches, not a rolling count).
  matchesLast7Days: number;
  matchesLast14Days: number;
  // Set only after enrichFormWithVenueClassification runs (search.ts) --
  // null otherwise, e.g. if the enrichment fetch loop failed entirely.
  venueSplitForm: VenueSplitForm | null;
  // Explicit rates over the last10Overall sample -- the win/draw/loss
  // counts and goal totals already existed via last10Overall itself; these
  // are just that same data pre-divided, not a new fetch.
  winRatePct: number | null;
  drawRatePct: number | null;
  lossRatePct: number | null;
  pointsPerGame: number | null;
  goalsForPerGame: number | null;
  goalsAgainstPerGame: number | null;
}

export interface CardDisciplineInfo {
  yellowPerGame: number;
  redPerGame: number;
  // Threshold: >2.5 yellow/game or >0.2 red/game. A typical top-division
  // team runs ~1.8-2.2 yellows/game, so 2.5 is a deliberately conservative
  // "notably above average" cutoff, not a league-specific benchmark.
  elevatedRisk: boolean;
}

export interface StandingsZoneInfo {
  position: number;
  totalTeams: number;
  // Uses the real continental/relegation spot count for known competitions
  // (search.ts's LEAGUE_STAKES table) -- top-4/bottom-3 only when the
  // competition isn't in that table, which is now the fallback, not the
  // rule.
  zone: "top-of-table" | "midtable" | "relegation-zone";
  // Points separating this team from the nearer zone boundary (promotion
  // edge if above midtable-but-close, safety edge if below) -- null if we
  // don't have every team's points (standingsTable is Sofascore-only).
  // <=6 points from a boundary counts as "in the mix" for that zone; wider
  // gaps are a settled position, not really "fighting for" anything.
  pointsFromBoundary: number | null;
  inTheMix: boolean | null;
}

export interface RestComparison {
  ownRestDays: number | null;
  opponentRestDays: number | null;
  moreRested: "own" | "opponent" | "even" | null;
}

export interface ExperienceComparison {
  ownAverageAge: number | null;
  opponentAverageAge: number | null;
  // "more experienced" requires a >=1.5 year average-age gap; smaller gaps
  // are called even rather than asserting one squad is meaningfully older.
  moreExperienced: "own" | "opponent" | "even" | null;
}

export interface SeasonXGEstimate {
  sampleSize: number;
  xgFor: number;
  xgAgainst: number;
  actualGoalsFor: number;
  actualGoalsAgainst: number;
  source: string;
}

// Same shape/scope as SeasonXGEstimate (last 5 finished Fotmob matches),
// computed from the same match-detail fetch already made for the xG
// estimate -- "Total shots"/"Shots on target" are additional stats already
// present in that same payload, so this costs zero extra requests.
export interface SeasonShotsEstimate {
  sampleSize: number;
  shotsFor: number;
  shotsAgainst: number;
  shotsOnTargetFor: number;
  shotsOnTargetAgainst: number;
  source: string;
}

// Same shape/scope as SeasonShotsEstimate, but from Goal.com's "Corner
// total" stat, computed from the same match-detail fetch already made for
// PossessionMatchupInfo -- zero extra requests.
export interface SeasonCornersEstimate {
  sampleSize: number;
  cornersFor: number;
  cornersAgainst: number;
  source: string;
}

// Same shape/scope as SeasonShotsEstimate -- derived from the same last-5-
// finished-Fotmob-matches fetch, zero extra requests. Fotmob's "Aerial
// duels won" stat is a raw count (not a % of all duels), summed across the
// sample.
export interface SeasonAerialEstimate {
  sampleSize: number;
  aerialDuelsWonFor: number;
  aerialDuelsWonAgainst: number;
  source: string;
}

// Same shape/scope as SeasonShotsEstimate. A chance-quality signal distinct
// from raw shot volume -- a team can out-shoot an opponent while creating
// fewer genuinely clear-cut chances.
export interface SeasonBigChancesEstimate {
  sampleSize: number;
  bigChancesCreatedFor: number;
  bigChancesCreatedAgainst: number;
  bigChancesMissedFor: number;
  bigChancesMissedAgainst: number;
  source: string;
}

// Unlike the other Season*Estimate types, this is a single team's own
// build-up-style profile, not a for/against contrast -- "how the opponent
// passes" is just that opponent's own passing style, already covered when
// their side is computed independently. Same last-5-finished-Fotmob-matches
// scope, zero extra requests: all three underlying stats ("Passes",
// "Accurate passes", "Accurate long balls") come from the same match-detail
// fetch already made for the shots/xG estimates. longBallSharePct is a
// rough "how direct is their play" signal (share of accurate passes that
// were long balls), not a tactical classification.
export interface SeasonPassingStyleEstimate {
  sampleSize: number;
  totalPassesFor: number;
  accuratePassesFor: number;
  passAccuracyPct: number | null;
  accurateLongBallsFor: number;
  longBallSharePct: number | null;
  source: string;
}

// Same shape/scope as SeasonShotsEstimate -- Fotmob's "Fouls committed",
// from the same last-5-finished-match fetch, zero extra requests. Pairs
// naturally with RefereeCardRiskNote: a team that fouls a lot in front of
// a card-happy referee is a stronger signal than either fact alone.
export interface SeasonFoulsEstimate {
  sampleSize: number;
  foulsCommittedFor: number;
  foulsCommittedAgainst: number;
  source: string;
}

// Same shape/scope as SeasonShotsEstimate, from the same last-5-finished-
// Fotmob-matches loop -- Fotmob's "Keeper saves" (plain integer). savePct
// approximates saves / shots-on-target-faced, reusing the shots-on-target-
// against figure already parsed for SeasonShotsEstimate in the same match
// rather than a separate stat, so this is only counted for matches where
// both stats are present together.
export interface SeasonGoalkeepingEstimate {
  sampleSize: number;
  savesFor: number;
  shotsOnTargetFaced: number;
  savePct: number | null;
  goalsConceded: number;
  source: string;
}

// Same shape/scope as SeasonFoulsEstimate, but from Goal.com's "Defensive
// error" stat instead of Fotmob -- derived from the same last-5-finished-
// Goal.com-matches loop already made for PossessionMatchupInfo/
// SeasonCornersEstimate, zero extra requests. Unlike the empty-option trap
// class of stats documented elsewhere (Squawka's "Errors Leading to
// Goals", which returns zero items on EVERY query), this one is
// confirmed live to carry real, non-zero data when present -- Goal.com
// just doesn't publish it for every match (2 of 8 Arsenal matches checked
// had it, the rest had no "Defensive error" entry at all rather than a
// zero one), so sampleSize here typically runs smaller than the other
// Goal.com-derived estimates from the same loop.
export interface SeasonDefensiveErrorsEstimate {
  sampleSize: number;
  defensiveErrorsFor: number;
  defensiveErrorsAgainst: number;
  source: string;
}

// Same shape/scope pattern as SeasonShotsEstimate, but zero EXTRA requests --
// these come from the same per-match statistics endpoint already fetched for
// enrichFormWithVenueClassification/computeRecentMeetings (last20Overall
// sample, both teams), just extracting more of what's already in that
// payload. "Errors lead to a shot"/"Errors lead to a goal" are Sofascore's
// own literal stat names (confirmed live), a more specific signal than
// Goal.com's generic "Defensive error" (SeasonDefensiveErrorsEstimate) --
// kept as a separate field rather than merged with it. Sample size can be
// smaller than last20Overall's full 20 -- some historical matches don't
// have every stat populated (early-season friendlies especially), same
// graceful-degradation as every other Season*Estimate in this file.
export interface SeasonAdvancedStatsEstimate {
  sampleSize: number;
  touchesInBoxFor: number;
  touchesInBoxAgainst: number;
  crossesFor: number;
  crossesAgainst: number;
  dribblesFor: number;
  dribblesAgainst: number;
  throughBallsFor: number;
  throughBallsAgainst: number;
  finalThirdEntriesFor: number;
  finalThirdEntriesAgainst: number;
  recoveriesFor: number;
  recoveriesAgainst: number;
  errorsLeadToShotFor: number;
  errorsLeadToShotAgainst: number;
  errorsLeadToGoalFor: number;
  errorsLeadToGoalAgainst: number;
  // Same zero-extra-request pattern as the fields above -- Sofascore's own
  // per-match statistics endpoint carries roughly 40 named stats; these
  // were added in a second pass after realizing only 8 had been mined the
  // first time through.
  shotsInsideBoxFor: number;
  shotsInsideBoxAgainst: number;
  shotsOutsideBoxFor: number;
  shotsOutsideBoxAgainst: number;
  shotsOffTargetFor: number;
  shotsOffTargetAgainst: number;
  blockedShotsFor: number;
  blockedShotsAgainst: number;
  offsidesFor: number;
  offsidesAgainst: number;
  bigChancesScoredFor: number;
  bigChancesScoredAgainst: number;
  dispossessedFor: number;
  dispossessedAgainst: number;
  // Team-level, distinct from DefensiveStats (Squawka, per-player).
  teamTacklesFor: number;
  teamTacklesAgainst: number;
  teamInterceptionsFor: number;
  teamInterceptionsAgainst: number;
  // "Goals prevented" (Sofascore's own post-shot xG minus actual goals
  // conceded, a real advanced goalkeeping metric) plus the box-score
  // fields SeasonGoalkeepingEstimate (Fotmob) doesn't carry.
  goalsPreventedFor: number;
  goalsPreventedAgainst: number;
  bigSavesFor: number;
  bigSavesAgainst: number;
  highClaimsFor: number;
  highClaimsAgainst: number;
  // Actual measured physical output, not a predicted/subjective "intensity"
  // label -- real GPS-derived match data Sofascore publishes per team.
  distanceCoveredKmFor: number;
  distanceCoveredKmAgainst: number;
  sprintsFor: number;
  sprintsAgainst: number;
  teamClearancesFor: number;
  teamClearancesAgainst: number;
  freeKicksFor: number;
  freeKicksAgainst: number;
  // Team total, summed across the same lineup+bench per-player statistics
  // (LineupPlayer.xa) already read for PlayerUsagePattern -- zero extra
  // requests, just a different rollup of the same numbers.
  xaFor: number;
  xaAgainst: number;
  // From Sofascore's shotmap endpoint (situation field on goal-type shots)
  // -- a genuinely different fetch than everything else in this type
  // (matchStats), added specifically for this. See MatchDetails.
  // setPieceGoals's doc comment for what "corner"/"penalty"/"set-piece"
  // actually mean.
  cornerGoalsFor: number;
  cornerGoalsAgainst: number;
  penaltyGoalsFor: number;
  penaltyGoalsAgainst: number;
  freeKickGoalsFor: number;
  freeKickGoalsAgainst: number;
  source: string;
}

// Cross-references a team's own corners-won rate (SeasonCornersEstimate)
// against the SPECIFIC opponent's own aerial-duel record
// (SeasonAerialEstimate) -- both already computed independently from each
// side's own last-N matches, zero new requests, same pattern as
// RefereeCardRiskNote. "Elevated" requires BOTH >=5 corners/game
// (deliberately round, not competition-tuned, consistent with other
// thresholds in this file) AND the opponent losing more of their own
// aerial duels than they win.
export interface SetPieceThreatFlag {
  cornersPerGame: number | null;
  opponentAerialWinPct: number | null;
  elevated: boolean;
}

// Same cross-reference shape as SetPieceThreatFlag, but pairing a team's
// own long-ball share (SeasonPassingStyleEstimate) against the same
// opponent aerial-win-rate signal. "Elevated" requires BOTH >=15% of
// accurate passes being long balls (deliberately round) AND the opponent's
// own aerial win rate being below 50% (losing more than winning).
export interface DirectPlayExposureFlag {
  longBallSharePct: number | null;
  opponentAerialWinPct: number | null;
  elevated: boolean;
}

// Splits a single team's OWN card discipline by whether THEY were playing
// at home or away in that match -- not to be confused with which side of
// the upcoming fixture they're on (that's what the home*/away* field-name
// prefix on MatchInsights means everywhere else; this type's own
// atHome/away fields are the venue split within it). Built from the same
// last-5-finished-Fotmob-matches fetch already made for the xG/shots
// estimates (Fotmob's matchStats also carries Yellow cards/Red cards) --
// zero extra requests. Either side can have sampleSize 0 (e.g. all 5 of a
// team's last finished matches happened to be away), in which case that
// side's per-game rates are null rather than a misleading 0.
export interface CardDisciplineVenueSplit {
  atHomeSampleSize: number;
  atHomeYellowPerGame: number | null;
  atHomeRedPerGame: number | null;
  awaySampleSize: number;
  awayYellowPerGame: number | null;
  awayRedPerGame: number | null;
  source: string;
}

export interface VenueDetails {
  stadiumName: string;
  capacity: number | null;
  opened: number | null;
  renovated: string | null;
  clubs: string[];
  sourceUrl: string;
}

// Sofascore only -- each team's own registered country vs the match venue's
// country (also Sofascore-only). Flags international travel. Distance is
// COUNTRY-level (capital-to-capital great-circle), not venue-to-venue --
// every free geocoding service checked (Nominatim, Photon, geocode.maps.co)
// explicitly disallows its search endpoint in robots.txt, so no live
// geocoding is used; the coordinates come from a small static table shipped
// in code instead. Treat the km figure as a rough order of magnitude, not a
// precise venue-to-venue number.
export interface TravelInfo {
  venueCountry: string | null;
  homeTeamCountry: string | null;
  awayTeamCountry: string | null;
  homeTraveling: boolean | null;
  awayTraveling: boolean | null;
  homeTravelDistanceKm: number | null;
  awayTravelDistanceKm: number | null;
  // Standard-time zone difference in hours between each team's own country
  // and the venue's -- see countryTimezoneDiffHours's doc comment (geo.ts)
  // for the DST caveat. 0 for a team playing in its own country's zone.
  homeTimezoneDiffHours: number | null;
  awayTimezoneDiffHours: number | null;
  // Estimated door-to-door hours, derived from the distance figure above --
  // see travelTimeHours's doc comment (geo.ts) for the ground-vs-air
  // threshold and the assumptions behind it.
  homeTravelTimeHours: number | null;
  awayTravelTimeHours: number | null;
}

// Record against opponents CURRENTLY ranked higher in the same competition
// as the upcoming match -- "currently" is the real caveat: it's each
// opponent's rank as of today, not their rank on the day that result
// happened, since none of our sources publish point-in-time historical
// standings. Only counts results within the same competition as the
// upcoming match, since cross-competition rank isn't comparable (a mid-table
// Champions League team can be a domestic league leader).
export interface OpponentRankRecord {
  sampleSize: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface PresenceEntry {
  name: string;
  status: "P" | "A";
  starting: boolean;
  // True when named among the substitutes (used or unused) -- Sofascore
  // only (see MatchDetails.homeBench/awayBench), null when bench data isn't
  // available for this match/source. A present-but-not-starting-and-not-
  // onBench player is present in the squad with no confirmed matchday
  // status yet (lineup not published) rather than definitely excluded.
  onBench: boolean | null;
  // Injury reason if absent -- null if present, or absent for a non-injury
  // reason we don't have (e.g. simply not selected).
  reason: string | null;
}

// Rotation between the last two played matches (not vs the upcoming
// match's lineup, which usually isn't published until close to kickoff) --
// a team's general rotation tendency, not "how much will they rotate for
// THIS game specifically."
export interface RotationInfo {
  changedPlayers: number;
  startingXISize: number;
  lastMatchDate: string | null;
  previousMatchDate: string | null;
  // Shape diff between the same two matches, from data already fetched for
  // the player-identity diff above (no new requests). Defender count comes
  // from the formation string's leading number ("4-3-3" -> 4) rather than
  // counting each player's own position field, since position-code formats
  // are inconsistent across sources (single letters, numeric ids, full
  // words) while the formation string itself is already a normalized
  // "D-M-F" breakdown.
  lastFormation: string | null;
  previousFormation: string | null;
  formationChanged: boolean | null;
  lastDefenderCount: number | null;
  previousDefenderCount: number | null;
  // The team's own result in the OLDER of the two matches being diffed --
  // i.e. what happened right before the changes shown here were made. Lets
  // "did they change things after a loss" be read directly off the same
  // already-fetched pair, instead of needing a separate historical-pattern
  // computation (which would mean fetching many more past matches' lineups
  // just to build a "average rotation after a loss vs after a win" sample).
  precedingResult: "W" | "D" | "L" | null;
}

// "Still earns a point when struggling" -- among a team's recent results
// that WEREN'T wins, what share were draws rather than losses. A team with
// a high draw share here tends to grind out a point rather than collapse
// into a loss; doesn't say anything about the wins themselves.
// Now buildable because Sofascore's lineup payload actually distinguishes
// bench from starting XI (see LineupPlayer.substitute) -- previously this
// project had no way to tell "on the bench" from "not selected at all"
// (computePresence's old doc comment), which made a bench-strength figure
// unfounded. Market value is the same objective proxy used for keyInjuries
// (neither source labels players by importance directly).
export interface BenchInfo {
  benchSize: number;
  benchTotalMarketValue: number | null;
  startingTotalMarketValue: number | null;
}

// Market value summed by broad position group -- the same role-matching
// helpers already used for missingAttackers/missingDefenders/etc, applied
// to the whole squad instead of just the injury list. Not a fabricated
// "strength score": market value is the same objective proxy this project
// already uses for keyInjuries and BenchInfo, just broken out by role here.
// availableValue is totalValue minus anyone currently injured or
// suspended -- the direct "injury-adjusted" figure.
export interface SquadStrengthInfo {
  totalValue: number | null;
  attackValue: number | null;
  midfieldValue: number | null;
  defenseValue: number | null;
  goalkeeperValue: number | null;
  availableValue: number | null;
}

// From clubelo.com -- a real, externally-computed, established rating
// methodology (not a formula invented for this project). asOf marks the
// snapshot date this came from since Elo drifts match-to-match; null if
// clubelo.com doesn't track this club at all (lower divisions, some
// non-European leagues) rather than a fetch failure.
export interface ClubEloRating {
  elo: number;
  rank: number;
  asOf: string;
}

// From statsultra.com -- a real, externally-computed power index (sourced
// from FootyStats, recalculated daily), not a formula invented for this
// project. The genuine answer to "attack/defense rating split", which
// clubelo.com's single overall Elo number doesn't have. Same 0-100-ish
// scale for all three fields, not directly comparable to Elo's own scale.
export interface ClubStrengthRating {
  overall: number;
  attack: number;
  defense: number;
}

export interface ResilienceInfo {
  nonWinSampleSize: number;
  drawSharePct: number;
}

// Per-player card-accumulation risk, from season totals already fetched
// (SeasonPlayerStats). accumulationRisk at >=4 season yellows is a generic
// early-warning threshold -- many leagues suspend at 5 accumulated yellows,
// so 4 is "one booking away," not tied to any specific competition's exact
// trigger (which varies and we don't have). priorDismissal flags anyone
// with >=1 red card already this season, a separate and stronger signal.
export interface PlayerCardRisk {
  name: string;
  yellowCards: number;
  redCards: number;
  appearances: number;
  accumulationRisk: boolean;
  priorDismissal: boolean;
}

// Cross-references the match referee's own season card-issuance rate
// (RefereeStats, already fetched) against players from BOTH teams already
// flagged as card risks (PlayerCardRisk, already fetched) -- pure synthesis
// of two things already computed separately, no new requests. Same >2.5
// yellow/game threshold as CardDisciplineInfo, applied to the referee's own
// rate instead of a team's. Null whenever there's nothing to cross-
// reference (no referee stats published yet, or no flagged players on
// either side).
export interface RefereeCardRiskNote {
  refereeName: string;
  yellowCardsPerGame: number;
  elevatedCardReferee: boolean;
  flaggedPlayers: { name: string; side: "home" | "away"; priorDismissal: boolean }[];
}

// Defenders (by role) whose Squawka groundDuelSuccessPct is below 50% --
// losing more ground duels than winning, an individual-error/defensive-
// vulnerability proxy. Squawka only, so this is empty whenever
// defensiveStats wasn't populated (competition not in Squawka's coverage).
export interface DuelVulnerability {
  name: string;
  groundDuelSuccessPct: number;
}

// Defenders with above-their-own-team-median chances created AND below-55%
// ground duel success -- a genuinely attacking defender (by their own
// squad's standard) who's also below-average defensively. This is the
// direct answer to "teams that rely on attacking full-backs can be exposed
// defensively," using their own teammates as the baseline rather than a
// fixed league-wide number, since a "high" chances-created figure means
// different things at different clubs. Can't reliably tell CB from LB/RB
// across sources (role fields are inconsistent), so this covers all
// defenders, not fullbacks specifically.
export interface FullbackExposureInfo {
  name: string;
  chancesCreated: number;
  groundDuelSuccessPct: number;
}

// "New standing" -- what rank this team would hold if the upcoming match
// ends in a win/draw/loss, simulated by applying the standard 3/1/0 points
// for that outcome to both teams' current points and re-ranking against the
// full standings table (Sofascore only, same source as everything else
// standings-related). Ties are broken by keeping the original relative
// order, since the table doesn't carry goal difference -- a real
// approximation for teams level on points after the simulated result.
export interface StandingsScenario {
  outcome: "win" | "draw" | "loss";
  newPoints: number;
  newPosition: number | null;
}

export interface StandingsImpactInfo {
  currentPosition: number;
  currentPoints: number;
  scenarios: StandingsScenario[];
}

// A manager's record specifically against the club they're facing in the
// upcoming match -- NOT a true two-person head-to-head (which would need
// tracking exactly which matches had both current managers already in
// charge on both sides, across their whole careers, something no source
// exposes directly). This is the honest, tractable version: this manager's
// own results against this particular opponent club, from their last 30
// matches in charge of any team (one page of Sofascore's manager event
// history -- deliberately not paginated further, keeping this the same
// "recent form" scope as everything else rather than a full-career search).
export interface ManagerClubRecord {
  managerName: string;
  opponentClub: string;
  sampleSize: number;
  wins: number;
  draws: number;
  losses: number;
}

// PPG split by whether the OPPONENT had high possession (>=55%) in that
// match, from the last 5 played matches with a Goal.com possession stat
// available (Goal.com only -- the one source with reliable per-match
// possession; same 5-match-lookback cost pattern as SeasonXGEstimate).
// Computed for both teams -- costs 5 extra Goal.com requests per side (10
// total), on top of everything else this tool already fetches.
export interface PossessionMatchupInfo {
  highOpponentPossessionPPG: number | null;
  highOpponentPossessionSampleSize: number;
  otherPPG: number | null;
  otherSampleSize: number;
}

// Combines the current streak with rotation (last-two-match XI changes):
// flagged "stable" when on a winning streak (>=2 games) with few personnel
// changes (<=2 of the XI) between the last two matches. Doesn't claim the
// stability CAUSES the streak, just that they're co-occurring.
export interface StreakStabilityInfo {
  streakResult: "W" | "D" | "L";
  streakCount: number;
  changedPlayers: number | null;
  stable: boolean | null;
}

// Combines a losing streak (>=2 games) with the season xG estimate: if
// actual goals scored are notably below expected goals (xgDelta <= -1) while
// losing, that's an objective "underperforming their own chances" signal --
// the data-backed version of "may unexpectedly turn it around," not a
// prediction. Computed for both teams, each against their own xG estimate.
export interface LosingStreakContextInfo {
  streakCount: number;
  xgDelta: number | null;
  potentialTurnaround: boolean | null;
}

// Gap between a team's own home and away win rates (all played matches on
// record, not just the recent-form sample). >=20pp gap = "strong", 5-20pp =
// "slight", -5 to 5pp = "negligible", <=-5pp = "reverse" (the team actually
// does WORSE at home than away) -- thresholds chosen the same way as the
// other elevated/notable cutoffs in this file: a deliberately generous band
// before calling something meaningful, not a league-tuned benchmark.
export interface HomeAdvantageInfo {
  homeWinRatePct: number | null;
  awayWinRatePct: number | null;
  gapPct: number | null;
  strength: "strong" | "slight" | "negligible" | "reverse" | null;
}

// Points-per-game split by rest before that match -- "short" is <=3 days
// (the same threshold used elsewhere for "tight schedule"), "long" is
// everything else. Computed across ALL played matches on record, not just
// the recent-form sample, since this needs enough matches in each bucket to
// mean anything.
export interface RestPerformanceInfo {
  shortRestPPG: number | null;
  shortRestSampleSize: number;
  longRestPPG: number | null;
  longRestSampleSize: number;
}

// Combines the existing experience gap and head-to-head record into one
// statement: does the more experienced squad also hold the head-to-head
// edge. Correlation only -- doesn't claim experience CAUSES the h2h record,
// just reports whether they happen to line up.
export interface ExperienceH2HNote {
  moreExperienced: "own" | "opponent" | "even" | null;
  h2hLeader: "own" | "opponent" | "even" | null;
  aligned: boolean | null;
}

// Flags "juggling multiple competitions with a tight schedule" -- requires
// BOTH more than one distinct competition in the recent-form sample AND an
// average gap under 5 days between the last three matches. Either signal
// alone (just multi-competition, or just a short gap) isn't flagged; both
// together is the actual fatigue-risk combination being checked for.
export interface FatigueFlag {
  multiCompetition: boolean;
  competitions: string[];
  avgGapDays: number | null;
  flagged: boolean;
}

// Classified from the competition name text alone ("friendly"/"pre-season"
// substring match, case-insensitive) -- not a separate data field any source
// publishes as a boolean. "competitive" is the default whenever a
// competition name exists and isn't flagged friendly; null only when there's
// no competition name at all to classify.
export type MatchType = "friendly" | "competitive";

export interface MatchInsights {
  matchType: MatchType | null;
  restComparison: RestComparison | null;
  experienceComparison: ExperienceComparison | null;
  homeStandingsZone: StandingsZoneInfo | null;
  awayStandingsZone: StandingsZoneInfo | null;
  homeCardDiscipline: CardDisciplineInfo | null;
  awayCardDiscipline: CardDisciplineInfo | null;
  homeCardDisciplineVenueSplit: CardDisciplineVenueSplit | null;
  awayCardDisciplineVenueSplit: CardDisciplineVenueSplit | null;
  homeXgEstimate: SeasonXGEstimate | null;
  awayXgEstimate: SeasonXGEstimate | null;
  homeShotsEstimate: SeasonShotsEstimate | null;
  awayShotsEstimate: SeasonShotsEstimate | null;
  homeAerialEstimate: SeasonAerialEstimate | null;
  awayAerialEstimate: SeasonAerialEstimate | null;
  homeBigChancesEstimate: SeasonBigChancesEstimate | null;
  awayBigChancesEstimate: SeasonBigChancesEstimate | null;
  homePassingStyle: SeasonPassingStyleEstimate | null;
  awayPassingStyle: SeasonPassingStyleEstimate | null;
  homeFoulsEstimate: SeasonFoulsEstimate | null;
  awayFoulsEstimate: SeasonFoulsEstimate | null;
  homeGoalkeepingEstimate: SeasonGoalkeepingEstimate | null;
  awayGoalkeepingEstimate: SeasonGoalkeepingEstimate | null;
  homeSetPieceThreat: SetPieceThreatFlag | null;
  awaySetPieceThreat: SetPieceThreatFlag | null;
  homeDirectPlayExposure: DirectPlayExposureFlag | null;
  awayDirectPlayExposure: DirectPlayExposureFlag | null;
  travelInfo: TravelInfo | null;
  homeOpponentRankRecord: OpponentRankRecord | null;
  awayOpponentRankRecord: OpponentRankRecord | null;
  homePresence: PresenceEntry[] | null;
  awayPresence: PresenceEntry[] | null;
  homeRotation: RotationInfo | null;
  awayRotation: RotationInfo | null;
  homeResilience: ResilienceInfo | null;
  awayResilience: ResilienceInfo | null;
  homeRestPerformance: RestPerformanceInfo | null;
  awayRestPerformance: RestPerformanceInfo | null;
  experienceH2H: ExperienceH2HNote | null;
  homeFatigueFlag: FatigueFlag | null;
  awayFatigueFlag: FatigueFlag | null;
  homeAdvantage: HomeAdvantageInfo | null;
  awayAdvantage: HomeAdvantageInfo | null;
  homeStreakStability: StreakStabilityInfo | null;
  awayStreakStability: StreakStabilityInfo | null;
  homeLosingStreakContext: LosingStreakContextInfo | null;
  awayLosingStreakContext: LosingStreakContextInfo | null;
  homeCardRisks: PlayerCardRisk[] | null;
  awayCardRisks: PlayerCardRisk[] | null;
  refereeCardRiskNote: RefereeCardRiskNote | null;
  homeDuelVulnerabilities: DuelVulnerability[] | null;
  awayDuelVulnerabilities: DuelVulnerability[] | null;
  homePossessionMatchup: PossessionMatchupInfo | null;
  awayPossessionMatchup: PossessionMatchupInfo | null;
  homeCornersEstimate: SeasonCornersEstimate | null;
  awayCornersEstimate: SeasonCornersEstimate | null;
  homeDefensiveErrorsEstimate: SeasonDefensiveErrorsEstimate | null;
  awayDefensiveErrorsEstimate: SeasonDefensiveErrorsEstimate | null;
  homeFullbackExposure: FullbackExposureInfo[] | null;
  awayFullbackExposure: FullbackExposureInfo[] | null;
  homeStandingsImpact: StandingsImpactInfo | null;
  awayStandingsImpact: StandingsImpactInfo | null;
  homeAdvancedStats: SeasonAdvancedStatsEstimate | null;
  awayAdvancedStats: SeasonAdvancedStatsEstimate | null;
  homeBenchInfo: BenchInfo | null;
  awayBenchInfo: BenchInfo | null;
  homeEloRating: ClubEloRating | null;
  awayEloRating: ClubEloRating | null;
  homeSquadStrength: SquadStrengthInfo | null;
  awaySquadStrength: SquadStrengthInfo | null;
  homeClubStrength: ClubStrengthRating | null;
  awayClubStrength: ClubStrengthRating | null;
  opponentContextError: string | null;
}
