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
}

export interface RefereeStats {
  games: number;
  yellowCards: number;
  redCards: number;
  yellowCardsPerGame: string;
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
  headToHeadSummary: { homeWins: number; awayWins: number; draws: number } | null;
  headToHeadStreaks: string[] | null;
  homeLineup: LineupPlayer[] | null;
  awayLineup: LineupPlayer[] | null;
  homeTeamStanding: TeamStanding | null;
  awayTeamStanding: TeamStanding | null;
  homeTeamSeasonStats: TeamSeasonStats | null;
  awayTeamSeasonStats: TeamSeasonStats | null;
  matchStats: { name: string; home: string; away: string }[] | null;
  eventTimeline: TimelineEvent[] | null;
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

export interface FormSummary {
  last5Overall: FormResult[];
  // Same as last5Overall but 10 deep -- exposed so callers can filter by
  // competition (e.g. "only same-league results") for things last5Overall's
  // fixed window is too small a sample for.
  last10Overall: FormResult[];
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

export interface MatchInsights {
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
  opponentContextError: string | null;
}
