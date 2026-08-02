import type { ReportJson } from "./types";

export type Row =
  | { kind: "bar"; label: string; home: number; away: number; homeLabel: string; awayLabel: string; unit?: string }
  | { kind: "text"; label: string; value: string; tone?: "good" | "warn" | "bad" };

export interface Section {
  title: string;
  icon: "calendar" | "trending" | "flag" | "shield" | "activity" | "users" | "bar-chart" | "clock" | "user-check";
  rows: Row[];
}

function fmt(n: number | null | undefined, digits = 2): string {
  return n == null ? "n/a" : Number(n.toFixed(digits)).toString();
}

// Groups the full report (the ~90-field insights object, match details,
// form, and both team profiles) into dashboard sections. Deliberately
// data-driven rather than one bespoke component per field -- with this
// many paired home/away metrics, a generic {label, home, away} row
// (rendered as a StatBar) or a plain labeled line covers the same ground
// without ~100 one-off components. Every non-null field on the report is
// meant to surface somewhere below; if something's missing here, it's a
// gap in this mapping, not a case of "not worth showing."
export function buildSections(report: ReportJson): Section[] {
  const { match, insights, form, opponentForm, teamProfile, opponentProfile } = report;
  if (!match) return [];
  const homeTeam = match.homeTeam;
  const awayTeam = match.awayTeam;
  const ownIsHome = homeTeam === report.team;
  const oppName = ownIsHome ? awayTeam : homeTeam;
  const sections: Section[] = [];

  // --- Match snapshot ---
  const snapshot: Row[] = [];
  if (match.season || match.round != null) snapshot.push({ kind: "text", label: "Season / round", value: `${match.season ?? "n/a"}${match.round != null ? `, round ${match.round}` : ""}` });
  if (insights?.matchType) snapshot.push({ kind: "text", label: "Match type", value: insights.matchType });
  if (match.venueName) snapshot.push({ kind: "text", label: "Venue", value: `${match.venueName}${match.venueCity ? `, ${match.venueCity}` : ""}${match.venueCountry ? `, ${match.venueCountry}` : ""}` });
  if (match.weather) snapshot.push({ kind: "text", label: "Weather", value: match.weather });
  if (match.weatherDetail) {
    const w = match.weatherDetail;
    snapshot.push({ kind: "text", label: "Weather detail", value: `humidity ${w.humidityPct ?? "n/a"}%, wind ${w.windSpeedKmph ?? "n/a"} km/h, precip ${w.precipMM ?? "n/a"} mm` });
  }
  if (match.referee) {
    const penalties = match.refereeStats?.penaltiesAwarded != null ? `, ${match.refereeStats.penaltiesAwarded} penalties this season` : "";
    const fouls = match.refereeStats?.foulsPerGame != null ? `, ${match.refereeStats.foulsPerGame} fouls/game` : "";
    snapshot.push({ kind: "text", label: "Referee", value: match.refereeStats ? `${match.referee} (${match.refereeStats.yellowCardsPerGame} yellow/game, ${match.refereeStats.games} games${penalties}${fouls})` : match.referee });
  }
  if (match.refereeStats?.homeAwayBias) {
    const b = match.refereeStats.homeAwayBias;
    snapshot.push({ kind: "text", label: "Referee home/away bias", value: `home ${b.homeCardsPerGame} vs away ${b.awayCardsPerGame} cards/game (n=${b.sampleSize})`, tone: b.awayCardsPerGame > b.homeCardsPerGame ? "warn" : undefined });
  }
  if (match.attendance) snapshot.push({ kind: "text", label: "Attendance", value: match.attendance.toLocaleString() });
  if (match.headToHeadSummary) {
    const h = match.headToHeadSummary;
    snapshot.push({ kind: "text", label: "Head-to-head", value: `${homeTeam} ${h.homeWins}W - ${h.draws}D - ${h.awayWins}W ${awayTeam}` });
  }
  if (match.headToHeadStreaks?.length) snapshot.push({ kind: "text", label: "H2H streaks", value: match.headToHeadStreaks.join("; ") });
  if (match.recentMeetings?.length) {
    snapshot.push({
      kind: "text",
      label: "Recent meetings",
      value: match.recentMeetings
        .map((m) => `${m.date?.slice(0, 10) ?? "?"} ${m.scoreline}${m.homeFormation && m.awayFormation ? ` (${m.homeFormation} v ${m.awayFormation})` : ""}${m.homeXg != null && m.awayXg != null ? `, xG ${m.homeXg}-${m.awayXg}` : ""}`)
        .join(" | "),
    });
  }
  if (match.homeFormation || match.awayFormation) snapshot.push({ kind: "text", label: "Formations", value: `${match.homeFormation ?? "?"} vs ${match.awayFormation ?? "?"}` });
  const managerStr = (m: typeof match.homeManager) => {
    if (!m) return "unknown";
    const tenure = m.appointedDate ? `, appointed ${m.appointedDate.slice(0, 10)}` : "";
    const recent = m.recentAppointment ? " (recent change)" : "";
    const previous = m.previousManager ? `, previously ${m.previousManager}` : "";
    return `${m.name}${m.country ? ` (${m.country})` : ""}${tenure}${recent}${previous}`;
  };
  if (match.homeManager || match.awayManager) {
    snapshot.push({ kind: "text", label: `${homeTeam} manager`, value: managerStr(match.homeManager) });
    snapshot.push({ kind: "text", label: `${awayTeam} manager`, value: managerStr(match.awayManager) });
  }
  if (match.homeTeamStanding) snapshot.push({ kind: "text", label: `${homeTeam} standing`, value: `#${match.homeTeamStanding.position} (${match.homeTeamStanding.points}pts, ${match.homeTeamStanding.wins}W-${match.homeTeamStanding.draws}D-${match.homeTeamStanding.losses}L, ${match.homeTeamStanding.goalDiff})` });
  if (match.awayTeamStanding) snapshot.push({ kind: "text", label: `${awayTeam} standing`, value: `#${match.awayTeamStanding.position} (${match.awayTeamStanding.points}pts, ${match.awayTeamStanding.wins}W-${match.awayTeamStanding.draws}D-${match.awayTeamStanding.losses}L, ${match.awayTeamStanding.goalDiff})` });
  if (match.homeTeamSeasonStats) snapshot.push({ kind: "text", label: `${homeTeam} season`, value: `${match.homeTeamSeasonStats.goalsScored} scored, ${match.homeTeamSeasonStats.goalsConceded} conceded, ${match.homeTeamSeasonStats.cleanSheets} clean sheets` });
  if (match.awayTeamSeasonStats) snapshot.push({ kind: "text", label: `${awayTeam} season`, value: `${match.awayTeamSeasonStats.goalsScored} scored, ${match.awayTeamSeasonStats.goalsConceded} conceded, ${match.awayTeamSeasonStats.cleanSheets} clean sheets` });
  if (match.homeSuspendedPlayers?.length) snapshot.push({ kind: "text", label: `${homeTeam} suspended`, value: match.homeSuspendedPlayers.join(", "), tone: "bad" });
  if (match.awaySuspendedPlayers?.length) snapshot.push({ kind: "text", label: `${awayTeam} suspended`, value: match.awaySuspendedPlayers.join(", "), tone: "bad" });
  if (match.homeLineup?.length) snapshot.push({ kind: "text", label: `${homeTeam} lineup`, value: match.homeLineup.map((p) => p.name).join(", ") });
  if (match.awayLineup?.length) snapshot.push({ kind: "text", label: `${awayTeam} lineup`, value: match.awayLineup.map((p) => p.name).join(", ") });
  if (match.playerOfTheMatch) snapshot.push({ kind: "text", label: "Player of the match", value: match.playerOfTheMatch.name });
  if (match.matchStats?.length) snapshot.push({ kind: "text", label: "Match stats", value: match.matchStats.map((s) => `${s.name} ${s.home}-${s.away}`).join(", ") });
  if (match.eventTimeline?.length) snapshot.push({ kind: "text", label: "Timeline", value: match.eventTimeline.map((e) => `${e.minute}' ${e.type}`).join(", ") });
  if (snapshot.length) sections.push({ title: "Match snapshot", icon: "calendar", rows: snapshot });

  if (insights) {
    // --- Expected performance ---
    const perf: Row[] = [];
    if (insights.homeXgEstimate && insights.awayXgEstimate) {
      perf.push({ kind: "bar", label: "Season xG for", home: insights.homeXgEstimate.xgFor, away: insights.awayXgEstimate.xgFor, homeLabel: homeTeam, awayLabel: awayTeam });
      perf.push({ kind: "bar", label: "Season xG against", home: insights.homeXgEstimate.xgAgainst, away: insights.awayXgEstimate.xgAgainst, homeLabel: homeTeam, awayLabel: awayTeam });
    }
    if (insights.homeShotsEstimate && insights.awayShotsEstimate) {
      perf.push({ kind: "bar", label: "Shots (last 10)", home: insights.homeShotsEstimate.shotsFor, away: insights.awayShotsEstimate.shotsFor, homeLabel: homeTeam, awayLabel: awayTeam });
      perf.push({ kind: "bar", label: "Shots on target (last 10)", home: insights.homeShotsEstimate.shotsOnTargetFor, away: insights.awayShotsEstimate.shotsOnTargetFor, homeLabel: homeTeam, awayLabel: awayTeam });
    }
    if (insights.homeAdvancedStats && insights.awayAdvancedStats) {
      const h = insights.homeAdvancedStats, a = insights.awayAdvancedStats;
      perf.push({ kind: "bar", label: "Touches in box (matched sample)", home: h.touchesInBoxFor, away: a.touchesInBoxFor, homeLabel: homeTeam, awayLabel: awayTeam });
      perf.push({ kind: "bar", label: "Shots inside box (matched sample)", home: h.shotsInsideBoxFor, away: a.shotsInsideBoxFor, homeLabel: homeTeam, awayLabel: awayTeam });
      perf.push({ kind: "bar", label: "Blocked shots (matched sample)", home: h.blockedShotsFor, away: a.blockedShotsFor, homeLabel: homeTeam, awayLabel: awayTeam });
      perf.push({ kind: "bar", label: "Crosses (matched sample)", home: h.crossesFor, away: a.crossesFor, homeLabel: homeTeam, awayLabel: awayTeam });
      perf.push({ kind: "bar", label: "Dribbles (matched sample)", home: h.dribblesFor, away: a.dribblesFor, homeLabel: homeTeam, awayLabel: awayTeam });
      perf.push({ kind: "bar", label: "Tackles (matched sample)", home: h.teamTacklesFor, away: a.teamTacklesFor, homeLabel: homeTeam, awayLabel: awayTeam });
      perf.push({ kind: "bar", label: "Interceptions (matched sample)", home: h.teamInterceptionsFor, away: a.teamInterceptionsFor, homeLabel: homeTeam, awayLabel: awayTeam });
      perf.push({ kind: "bar", label: "Clearances (matched sample)", home: h.teamClearancesFor, away: a.teamClearancesFor, homeLabel: homeTeam, awayLabel: awayTeam });
      perf.push({ kind: "bar", label: "xA (matched sample)", home: h.xaFor, away: a.xaFor, homeLabel: homeTeam, awayLabel: awayTeam });
      perf.push({ kind: "text", label: `${homeTeam} set-piece goals (corner/pen/FK)`, value: `${h.cornerGoalsFor}/${h.penaltyGoalsFor}/${h.freeKickGoalsFor}` });
      perf.push({ kind: "text", label: `${awayTeam} set-piece goals (corner/pen/FK)`, value: `${a.cornerGoalsFor}/${a.penaltyGoalsFor}/${a.freeKickGoalsFor}` });
      perf.push({ kind: "bar", label: "Distance covered km (matched sample)", home: h.distanceCoveredKmFor, away: a.distanceCoveredKmFor, homeLabel: homeTeam, awayLabel: awayTeam });
      perf.push({ kind: "text", label: `${homeTeam} errors -> shot/goal`, value: `${h.errorsLeadToShotFor} / ${h.errorsLeadToGoalFor}`, tone: h.errorsLeadToGoalFor > 0 ? "bad" : undefined });
      perf.push({ kind: "text", label: `${awayTeam} errors -> shot/goal`, value: `${a.errorsLeadToShotFor} / ${a.errorsLeadToGoalFor}`, tone: a.errorsLeadToGoalFor > 0 ? "bad" : undefined });
      perf.push({ kind: "text", label: `${homeTeam} offsides / dispossessed`, value: `${h.offsidesFor} / ${h.dispossessedFor}` });
      perf.push({ kind: "text", label: `${awayTeam} offsides / dispossessed`, value: `${a.offsidesFor} / ${a.dispossessedFor}` });
    }
    if (insights.homeBigChancesEstimate && insights.awayBigChancesEstimate) {
      perf.push({ kind: "bar", label: "Big chances created", home: insights.homeBigChancesEstimate.bigChancesCreatedFor, away: insights.awayBigChancesEstimate.bigChancesCreatedFor, homeLabel: homeTeam, awayLabel: awayTeam });
      perf.push({ kind: "bar", label: "Big chances missed", home: insights.homeBigChancesEstimate.bigChancesMissedFor, away: insights.awayBigChancesEstimate.bigChancesMissedFor, homeLabel: homeTeam, awayLabel: awayTeam });
    }
    if (insights.homeCornersEstimate && insights.awayCornersEstimate) {
      perf.push({ kind: "bar", label: "Corners (last 10)", home: insights.homeCornersEstimate.cornersFor, away: insights.awayCornersEstimate.cornersFor, homeLabel: homeTeam, awayLabel: awayTeam });
    }
    if (insights.homePossessionMatchup) {
      const p = insights.homePossessionMatchup;
      perf.push({ kind: "text", label: `${homeTeam} vs high-possession opps`, value: `${p.highOpponentPossessionPPG ?? "n/a"} ppg (n=${p.highOpponentPossessionSampleSize}) vs ${p.otherPPG ?? "n/a"} ppg otherwise` });
    }
    if (insights.awayPossessionMatchup) {
      const p = insights.awayPossessionMatchup;
      perf.push({ kind: "text", label: `${awayTeam} vs high-possession opps`, value: `${p.highOpponentPossessionPPG ?? "n/a"} ppg (n=${p.highOpponentPossessionSampleSize}) vs ${p.otherPPG ?? "n/a"} ppg otherwise` });
    }
    if (perf.length) sections.push({ title: "Expected performance", icon: "trending", rows: perf });

    // --- Discipline ---
    const discipline: Row[] = [];
    if (insights.homeCardDiscipline) discipline.push({ kind: "text", label: `${homeTeam} cards`, value: `${insights.homeCardDiscipline.yellowPerGame}Y / ${insights.homeCardDiscipline.redPerGame}R per game`, tone: insights.homeCardDiscipline.elevatedRisk ? "warn" : undefined });
    if (insights.awayCardDiscipline) discipline.push({ kind: "text", label: `${awayTeam} cards`, value: `${insights.awayCardDiscipline.yellowPerGame}Y / ${insights.awayCardDiscipline.redPerGame}R per game`, tone: insights.awayCardDiscipline.elevatedRisk ? "warn" : undefined });
    if (insights.homeCardDisciplineVenueSplit) {
      const s = insights.homeCardDisciplineVenueSplit;
      discipline.push({ kind: "text", label: `${homeTeam} cards by venue`, value: `at home ${s.atHomeYellowPerGame ?? "n/a"}Y (n=${s.atHomeSampleSize}) / away ${s.awayYellowPerGame ?? "n/a"}Y (n=${s.awaySampleSize})` });
    }
    if (insights.awayCardDisciplineVenueSplit) {
      const s = insights.awayCardDisciplineVenueSplit;
      discipline.push({ kind: "text", label: `${awayTeam} cards by venue`, value: `at home ${s.atHomeYellowPerGame ?? "n/a"}Y (n=${s.atHomeSampleSize}) / away ${s.awayYellowPerGame ?? "n/a"}Y (n=${s.awaySampleSize})` });
    }
    if (insights.homeFoulsEstimate && insights.awayFoulsEstimate) {
      discipline.push({ kind: "bar", label: "Fouls committed (last 10)", home: insights.homeFoulsEstimate.foulsCommittedFor, away: insights.awayFoulsEstimate.foulsCommittedFor, homeLabel: homeTeam, awayLabel: awayTeam });
    }
    if (insights.homeCardRisks?.length) discipline.push({ kind: "text", label: `${homeTeam} card risk`, value: insights.homeCardRisks.map((r) => `${r.name} (${r.yellowCards}Y${r.redCards ? `/${r.redCards}R` : ""})`).join(", "), tone: "warn" });
    if (insights.awayCardRisks?.length) discipline.push({ kind: "text", label: `${awayTeam} card risk`, value: insights.awayCardRisks.map((r) => `${r.name} (${r.yellowCards}Y${r.redCards ? `/${r.redCards}R` : ""})`).join(", "), tone: "warn" });
    if (insights.refereeCardRiskNote) {
      const r = insights.refereeCardRiskNote;
      discipline.push({ kind: "text", label: `Referee ${r.refereeName}`, value: `${r.yellowCardsPerGame} yellow/game -- flags ${r.flaggedPlayers.map((p) => p.name).join(", ")}`, tone: r.elevatedCardReferee ? "warn" : undefined });
    }
    if (discipline.length) sections.push({ title: "Discipline", icon: "flag", rows: discipline });

    // --- Attacking & defensive profile ---
    const profile: Row[] = [];
    if (insights.homePassingStyle) profile.push({ kind: "text", label: `${homeTeam} passing`, value: `${fmt(insights.homePassingStyle.passAccuracyPct, 1)}% accuracy, ${fmt(insights.homePassingStyle.longBallSharePct, 1)}% long balls` });
    if (insights.awayPassingStyle) profile.push({ kind: "text", label: `${awayTeam} passing`, value: `${fmt(insights.awayPassingStyle.passAccuracyPct, 1)}% accuracy, ${fmt(insights.awayPassingStyle.longBallSharePct, 1)}% long balls` });
    if (insights.homeAerialEstimate && insights.awayAerialEstimate) {
      profile.push({ kind: "bar", label: "Aerial duels won (last 10)", home: insights.homeAerialEstimate.aerialDuelsWonFor, away: insights.awayAerialEstimate.aerialDuelsWonFor, homeLabel: homeTeam, awayLabel: awayTeam });
    }
    if (insights.homeGoalkeepingEstimate) profile.push({ kind: "text", label: `${homeTeam} goalkeeping`, value: `${insights.homeGoalkeepingEstimate.savesFor} saves / ${insights.homeGoalkeepingEstimate.shotsOnTargetFaced} faced (${fmt(insights.homeGoalkeepingEstimate.savePct, 1)}%), ${insights.homeGoalkeepingEstimate.goalsConceded} conceded` });
    if (insights.awayGoalkeepingEstimate) profile.push({ kind: "text", label: `${awayTeam} goalkeeping`, value: `${insights.awayGoalkeepingEstimate.savesFor} saves / ${insights.awayGoalkeepingEstimate.shotsOnTargetFaced} faced (${fmt(insights.awayGoalkeepingEstimate.savePct, 1)}%), ${insights.awayGoalkeepingEstimate.goalsConceded} conceded` });
    if (insights.homeDefensiveErrorsEstimate) profile.push({ kind: "text", label: `${homeTeam} defensive errors`, value: `${insights.homeDefensiveErrorsEstimate.defensiveErrorsFor} for / ${insights.homeDefensiveErrorsEstimate.defensiveErrorsAgainst} against`, tone: "warn" });
    if (insights.awayDefensiveErrorsEstimate) profile.push({ kind: "text", label: `${awayTeam} defensive errors`, value: `${insights.awayDefensiveErrorsEstimate.defensiveErrorsFor} for / ${insights.awayDefensiveErrorsEstimate.defensiveErrorsAgainst} against`, tone: "warn" });
    if (insights.homeDuelVulnerabilities?.length) profile.push({ kind: "text", label: `${homeTeam} duel risk`, value: insights.homeDuelVulnerabilities.map((d) => `${d.name} (${d.groundDuelSuccessPct.toFixed(1)}%)`).join(", "), tone: "warn" });
    if (insights.awayDuelVulnerabilities?.length) profile.push({ kind: "text", label: `${awayTeam} duel risk`, value: insights.awayDuelVulnerabilities.map((d) => `${d.name} (${d.groundDuelSuccessPct.toFixed(1)}%)`).join(", "), tone: "warn" });
    if (insights.homeFullbackExposure?.length) profile.push({ kind: "text", label: `${homeTeam} exposed fullbacks`, value: insights.homeFullbackExposure.map((d) => d.name).join(", "), tone: "warn" });
    if (insights.awayFullbackExposure?.length) profile.push({ kind: "text", label: `${awayTeam} exposed fullbacks`, value: insights.awayFullbackExposure.map((d) => d.name).join(", "), tone: "warn" });
    if (insights.homeSetPieceThreat) profile.push({ kind: "text", label: `${homeTeam} set-piece threat`, value: `${insights.homeSetPieceThreat.cornersPerGame ?? "n/a"} corners/game vs opp's ${insights.homeSetPieceThreat.opponentAerialWinPct ?? "n/a"}% aerial win`, tone: insights.homeSetPieceThreat.elevated ? "good" : undefined });
    if (insights.awaySetPieceThreat) profile.push({ kind: "text", label: `${awayTeam} set-piece threat`, value: `${insights.awaySetPieceThreat.cornersPerGame ?? "n/a"} corners/game vs opp's ${insights.awaySetPieceThreat.opponentAerialWinPct ?? "n/a"}% aerial win`, tone: insights.awaySetPieceThreat.elevated ? "good" : undefined });
    if (insights.homeDirectPlayExposure) profile.push({ kind: "text", label: `${homeTeam} direct-play exposure`, value: `${insights.homeDirectPlayExposure.longBallSharePct ?? "n/a"}% long balls vs opp's ${insights.homeDirectPlayExposure.opponentAerialWinPct ?? "n/a"}% aerial win`, tone: insights.homeDirectPlayExposure.elevated ? "warn" : undefined });
    if (insights.awayDirectPlayExposure) profile.push({ kind: "text", label: `${awayTeam} direct-play exposure`, value: `${insights.awayDirectPlayExposure.longBallSharePct ?? "n/a"}% long balls vs opp's ${insights.awayDirectPlayExposure.opponentAerialWinPct ?? "n/a"}% aerial win`, tone: insights.awayDirectPlayExposure.elevated ? "warn" : undefined });
    if (profile.length) sections.push({ title: "Attacking & defensive profile", icon: "shield", rows: profile });

    // --- Standings & stakes ---
    const standings: Row[] = [];
    if (insights.homeEloRating && insights.awayEloRating) {
      standings.push({ kind: "bar", label: "Elo rating (clubelo.com)", home: insights.homeEloRating.elo, away: insights.awayEloRating.elo, homeLabel: `${homeTeam} (#${insights.homeEloRating.rank} world)`, awayLabel: `${awayTeam} (#${insights.awayEloRating.rank} world)` });
    }
    if (insights.homeClubStrength && insights.awayClubStrength) {
      standings.push({ kind: "bar", label: "Overall strength (statsultra.com)", home: insights.homeClubStrength.overall, away: insights.awayClubStrength.overall, homeLabel: homeTeam, awayLabel: awayTeam });
      standings.push({ kind: "bar", label: "Attack rating", home: insights.homeClubStrength.attack, away: insights.awayClubStrength.attack, homeLabel: homeTeam, awayLabel: awayTeam });
      standings.push({ kind: "bar", label: "Defense rating", home: insights.homeClubStrength.defense, away: insights.awayClubStrength.defense, homeLabel: homeTeam, awayLabel: awayTeam });
    }
    if (insights.homeStandingsZone) {
      const z = insights.homeStandingsZone;
      standings.push({ kind: "text", label: homeTeam, value: `#${z.position}/${z.totalTeams} (${z.zone})${z.pointsFromBoundary != null ? `, ${z.pointsFromBoundary}pts from boundary${z.inTheMix ? " -- in the mix" : ""}` : ""}` });
    }
    if (insights.awayStandingsZone) {
      const z = insights.awayStandingsZone;
      standings.push({ kind: "text", label: awayTeam, value: `#${z.position}/${z.totalTeams} (${z.zone})${z.pointsFromBoundary != null ? `, ${z.pointsFromBoundary}pts from boundary${z.inTheMix ? " -- in the mix" : ""}` : ""}` });
    }
    if (insights.homeStandingsImpact) {
      const s = insights.homeStandingsImpact;
      standings.push({ kind: "text", label: `${homeTeam} new standing if`, value: s.scenarios.map((sc) => `${sc.outcome}: #${sc.newPosition ?? "?"}`).join(", ") });
    }
    if (insights.awayStandingsImpact) {
      const s = insights.awayStandingsImpact;
      standings.push({ kind: "text", label: `${awayTeam} new standing if`, value: s.scenarios.map((sc) => `${sc.outcome}: #${sc.newPosition ?? "?"}`).join(", ") });
    }
    if (insights.homeAdvantage) standings.push({ kind: "text", label: `${homeTeam} home advantage`, value: `${insights.homeAdvantage.strength ?? "n/a"} (home ${insights.homeAdvantage.homeWinRatePct}% / away ${insights.homeAdvantage.awayWinRatePct}%)` });
    if (insights.awayAdvantage) standings.push({ kind: "text", label: `${awayTeam} home advantage`, value: `${insights.awayAdvantage.strength ?? "n/a"} (home ${insights.awayAdvantage.homeWinRatePct}% / away ${insights.awayAdvantage.awayWinRatePct}%)` });
    if (insights.homeOpponentRankRecord) standings.push({ kind: "text", label: `${homeTeam} vs higher-ranked`, value: `${insights.homeOpponentRankRecord.wins}W-${insights.homeOpponentRankRecord.draws}D-${insights.homeOpponentRankRecord.losses}L` });
    if (insights.awayOpponentRankRecord) standings.push({ kind: "text", label: `${awayTeam} vs higher-ranked`, value: `${insights.awayOpponentRankRecord.wins}W-${insights.awayOpponentRankRecord.draws}D-${insights.awayOpponentRankRecord.losses}L` });
    if (standings.length) sections.push({ title: "Standings & stakes", icon: "bar-chart", rows: standings });

    // --- Situational factors ---
    const situational: Row[] = [];
    if (insights.restComparison) situational.push({ kind: "text", label: "Rest", value: `${homeTeam} ${insights.restComparison.ownRestDays ?? "n/a"}d vs ${awayTeam} ${insights.restComparison.opponentRestDays ?? "n/a"}d` });
    if (insights.homeRestPerformance) situational.push({ kind: "text", label: `${homeTeam} performance by rest`, value: `short ${insights.homeRestPerformance.shortRestPPG ?? "n/a"} ppg (n=${insights.homeRestPerformance.shortRestSampleSize}) vs long ${insights.homeRestPerformance.longRestPPG ?? "n/a"} ppg (n=${insights.homeRestPerformance.longRestSampleSize})` });
    if (insights.awayRestPerformance) situational.push({ kind: "text", label: `${awayTeam} performance by rest`, value: `short ${insights.awayRestPerformance.shortRestPPG ?? "n/a"} ppg (n=${insights.awayRestPerformance.shortRestSampleSize}) vs long ${insights.awayRestPerformance.longRestPPG ?? "n/a"} ppg (n=${insights.awayRestPerformance.longRestSampleSize})` });
    if (insights.homeFatigueFlag) situational.push({ kind: "text", label: `${homeTeam} fatigue`, value: insights.homeFatigueFlag.flagged ? "elevated" : "normal", tone: insights.homeFatigueFlag.flagged ? "warn" : "good" });
    if (insights.awayFatigueFlag) situational.push({ kind: "text", label: `${awayTeam} fatigue`, value: insights.awayFatigueFlag.flagged ? "elevated" : "normal", tone: insights.awayFatigueFlag.flagged ? "warn" : "good" });
    if (insights.homeRotation) {
      const r = insights.homeRotation;
      situational.push({ kind: "text", label: `${homeTeam} rotation`, value: `${r.changedPlayers}/${r.startingXISize} changed${r.formationChanged != null ? `, shape ${r.formationChanged ? "changed" : "unchanged"}` : ""}${r.precedingResult ? ` (after a ${r.precedingResult === "W" ? "win" : r.precedingResult === "L" ? "loss" : "draw"})` : ""}` });
    }
    if (insights.awayRotation) {
      const r = insights.awayRotation;
      situational.push({ kind: "text", label: `${awayTeam} rotation`, value: `${r.changedPlayers}/${r.startingXISize} changed${r.formationChanged != null ? `, shape ${r.formationChanged ? "changed" : "unchanged"}` : ""}${r.precedingResult ? ` (after a ${r.precedingResult === "W" ? "win" : r.precedingResult === "L" ? "loss" : "draw"})` : ""}` });
    }
    if (insights.homeStreakStability) situational.push({ kind: "text", label: `${homeTeam} streak stability`, value: `${insights.homeStreakStability.streakCount}-game ${insights.homeStreakStability.streakResult}${insights.homeStreakStability.stable != null ? (insights.homeStreakStability.stable ? " -- stable" : " -- unstable") : ""}` });
    if (insights.awayStreakStability) situational.push({ kind: "text", label: `${awayTeam} streak stability`, value: `${insights.awayStreakStability.streakCount}-game ${insights.awayStreakStability.streakResult}${insights.awayStreakStability.stable != null ? (insights.awayStreakStability.stable ? " -- stable" : " -- unstable") : ""}` });
    if (insights.homeLosingStreakContext) situational.push({ kind: "text", label: `${homeTeam} losing-streak xG`, value: `${insights.homeLosingStreakContext.streakCount} games, xG delta ${insights.homeLosingStreakContext.xgDelta ?? "n/a"}${insights.homeLosingStreakContext.potentialTurnaround ? " -- potential turnaround" : ""}`, tone: insights.homeLosingStreakContext.potentialTurnaround ? "good" : undefined });
    if (insights.awayLosingStreakContext) situational.push({ kind: "text", label: `${awayTeam} losing-streak xG`, value: `${insights.awayLosingStreakContext.streakCount} games, xG delta ${insights.awayLosingStreakContext.xgDelta ?? "n/a"}${insights.awayLosingStreakContext.potentialTurnaround ? " -- potential turnaround" : ""}`, tone: insights.awayLosingStreakContext.potentialTurnaround ? "good" : undefined });
    if (insights.homeResilience) situational.push({ kind: "text", label: `${homeTeam} resilience`, value: `${insights.homeResilience.drawSharePct}% of non-wins were draws` });
    if (insights.awayResilience) situational.push({ kind: "text", label: `${awayTeam} resilience`, value: `${insights.awayResilience.drawSharePct}% of non-wins were draws` });
    if (insights.experienceComparison) situational.push({ kind: "text", label: "Experience", value: `${homeTeam} avg age ${insights.experienceComparison.ownAverageAge ?? "n/a"} vs ${awayTeam} ${insights.experienceComparison.opponentAverageAge ?? "n/a"}` });
    if (insights.experienceH2H) situational.push({ kind: "text", label: "Experience/H2H alignment", value: insights.experienceH2H.aligned == null ? "n/a" : insights.experienceH2H.aligned ? "more experienced squad also holds the H2H edge" : "not aligned" });
    if (insights.travelInfo) {
      const t = insights.travelInfo;
      const tzSuffix = (h: number | null) => (h != null && h > 0 ? `, ${h}h tz diff` : "");
      const timeSuffix = (h: number | null) => (h != null ? `, ~${h}h travel` : "");
      situational.push({
        kind: "text",
        label: "Travel",
        value: t.awayTraveling
          ? `${awayTeam} traveling (~${t.awayTravelDistanceKm ?? "?"}km${timeSuffix(t.awayTravelTimeHours)}${tzSuffix(t.awayTimezoneDiffHours)})`
          : t.homeTraveling
            ? `${homeTeam} traveling (~${t.homeTravelDistanceKm ?? "?"}km${timeSuffix(t.homeTravelTimeHours)}${tzSuffix(t.homeTimezoneDiffHours)})`
            : "Both at home turf",
      });
    }
    if (situational.length) sections.push({ title: "Situational factors", icon: "clock", rows: situational });

    // --- Availability ---
    const availability: Row[] = [];
    const presenceRow = (entries: typeof insights.homePresence, label: string) => {
      if (!entries) return;
      const absent = entries.filter((e) => e.status === "A");
      availability.push({
        kind: "text",
        label,
        value: absent.length ? `${entries.length - absent.length} present, ${absent.length} absent: ${absent.map((a) => a.name).join(", ")}` : `${entries.length} present, none absent`,
        tone: absent.length ? "warn" : "good",
      });
    };
    presenceRow(insights.homePresence, `${homeTeam} availability`);
    presenceRow(insights.awayPresence, `${awayTeam} availability`);
    const benchRow = (b: typeof insights.homeBenchInfo, label: string) => {
      if (!b) return;
      const fmt = (v: number | null) => (v != null ? `€${(v / 1_000_000).toFixed(0)}m` : "n/a");
      availability.push({ kind: "text", label, value: `${b.benchSize} named, ${fmt(b.benchTotalMarketValue)} combined value vs starting XI's ${fmt(b.startingTotalMarketValue)}` });
    };
    benchRow(insights.homeBenchInfo, `${homeTeam} bench`);
    benchRow(insights.awayBenchInfo, `${awayTeam} bench`);
    if (availability.length) sections.push({ title: "Availability", icon: "user-check", rows: availability });
  }

  // --- Form & momentum ---
  const formRows: Row[] = [];
  const addFormRows = (f: typeof form, label: string) => {
    if (!f) return;
    if (f.currentStreak) formRows.push({ kind: "text", label: `${label} streak`, value: `${f.currentStreak.count}-game ${f.currentStreak.result === "W" ? "winning" : f.currentStreak.result === "L" ? "losing" : "drawing"}` });
    if (f.momentum) formRows.push({ kind: "text", label: `${label} momentum`, value: `${f.momentum.recentPPG} ppg (last 3) vs ${f.momentum.priorPPG} ppg (prior 3) -- ${f.momentum.trend}`, tone: f.momentum.trend === "improving" ? "good" : f.momentum.trend === "declining" ? "bad" : undefined });
    if (f.homeWinRatePct != null || f.awayWinRatePct != null) formRows.push({ kind: "text", label: `${label} win rate`, value: `home ${f.homeWinRatePct ?? "n/a"}% / away ${f.awayWinRatePct ?? "n/a"}%` });
    if (f.narrowWinSharePct != null) formRows.push({ kind: "text", label: `${label} narrow wins`, value: `${f.narrowWinSharePct}% of last 10 wins` });
    if (f.scoringDrawSharePct != null) formRows.push({ kind: "text", label: `${label} scoring draws`, value: `${f.scoringDrawSharePct}% of last 10 draws` });
    if (f.bttsSharePct != null) formRows.push({ kind: "text", label: `${label} BTTS rate`, value: `${f.bttsSharePct}%` });
    if (f.cleanSheetStreak != null && f.cleanSheetStreak >= 2) formRows.push({ kind: "text", label: `${label} clean sheets`, value: `${f.cleanSheetStreak}-game streak`, tone: "good" });
    if (f.scorelessStreak != null && f.scorelessStreak >= 2) formRows.push({ kind: "text", label: `${label} scoreless`, value: `${f.scorelessStreak}-game streak`, tone: "bad" });
    if (f.over25SharePct != null) formRows.push({ kind: "text", label: `${label} over/under (last 10)`, value: `O1.5 ${f.over15SharePct}% / O2.5 ${f.over25SharePct}% / O3.5 ${f.over35SharePct}%` });
    if (f.cleanSheetSharePct != null) formRows.push({ kind: "text", label: `${label} CS% / FTS% (last 10)`, value: `${f.cleanSheetSharePct}% / ${f.failedToScoreSharePct}%` });
    if (f.halfSplit) formRows.push({ kind: "text", label: `${label} half split`, value: `1H ${f.halfSplit.firstHalfGoalsFor}-${f.halfSplit.firstHalfGoalsAgainst}, 2H ${f.halfSplit.secondHalfGoalsFor}-${f.halfSplit.secondHalfGoalsAgainst}` });
    if (f.gapsBetweenLastThree.length) formRows.push({ kind: "text", label: `${label} fixture gaps`, value: `${f.gapsBetweenLastThree.join(", ")} days` });
    formRows.push({ kind: "text", label: `${label} fixture congestion`, value: `${f.matchesLast7Days} in last 7d, ${f.matchesLast14Days} in last 14d`, tone: f.matchesLast7Days >= 3 ? "warn" : undefined });
    if (f.recentCompetitions.length > 1) formRows.push({ kind: "text", label: `${label} competitions`, value: f.recentCompetitions.join(", ") });
    if (f.formByCompetition.length > 1) formRows.push({ kind: "text", label: `${label} form by competition`, value: f.formByCompetition.map((c) => `${c.competition} ${c.wins}W-${c.draws}D-${c.losses}L, ${c.goalsFor}-${c.goalsAgainst}`).join(" | ") });
    if (f.winRatePct != null) formRows.push({ kind: "text", label: `${label} rates (last 10)`, value: `W${f.winRatePct}%/D${f.drawRatePct}%/L${f.lossRatePct}%, ${f.pointsPerGame} ppg, ${f.goalsForPerGame}-${f.goalsAgainstPerGame} goals/game` });
    if (f.venueSplitForm) {
      const v = f.venueSplitForm;
      formRows.push({
        kind: "text",
        label: `${label} true venue split`,
        value: `home ${v.homeWins}W-${v.homeDraws}D-${v.homeLosses}L, ${v.homeGoalsFor}-${v.homeGoalsAgainst} (n=${v.homeSampleSize}) / away ${v.awayWins}W-${v.awayDraws}D-${v.awayLosses}L, ${v.awayGoalsFor}-${v.awayGoalsAgainst} (n=${v.awaySampleSize}) / neutral ${v.neutralWins}W-${v.neutralDraws}D-${v.neutralLosses}L, ${v.neutralGoalsFor}-${v.neutralGoalsAgainst} (n=${v.neutralSampleSize})`,
      });
    }
  };
  addFormRows(form, report.team);
  addFormRows(opponentForm, oppName);
  if (formRows.length) sections.push({ title: "Form & momentum", icon: "activity", rows: formRows });

  // --- Squad ---
  const squadRows: Row[] = [];
  const squadInfo = (profile: typeof teamProfile, label: string) => {
    if (!profile) return;
    if (profile.squad) {
      const withStats = profile.squad.filter((s) => s.seasonStats);
      const scorers = [...withStats].sort((a, b) => (b.seasonStats!.goals ?? 0) - (a.seasonStats!.goals ?? 0)).slice(0, 3);
      const assisters = [...withStats].sort((a, b) => (b.seasonStats!.assists ?? 0) - (a.seasonStats!.assists ?? 0)).slice(0, 3);
      if (scorers.length) squadRows.push({ kind: "text", label: `${label} top scorers`, value: scorers.map((s) => `${s.name} (${s.seasonStats!.goals}g)`).join(", ") });
      if (assisters.length) squadRows.push({ kind: "text", label: `${label} top assists`, value: assisters.map((s) => `${s.name} (${s.seasonStats!.assists}a)`).join(", ") });
    }
    if (profile.averageAge != null) squadRows.push({ kind: "text", label: `${label} average age`, value: `${profile.averageAge}` });
    if (profile.keyInjuries?.length) squadRows.push({ kind: "text", label: `${label} key injuries`, value: profile.keyInjuries.map((i) => i.name).join(", "), tone: "warn" });
    else if (profile.injuries?.length) squadRows.push({ kind: "text", label: `${label} injuries`, value: profile.injuries.map((i) => i.name).join(", "), tone: "warn" });
    if (profile.missingMidfielders?.length) squadRows.push({ kind: "text", label: `${label} missing midfielders`, value: profile.missingMidfielders.join(", "), tone: "warn" });
    if (profile.missingAttackers?.length) squadRows.push({ kind: "text", label: `${label} missing attackers`, value: profile.missingAttackers.join(", "), tone: "warn" });
    if (profile.missingDefenders?.length) squadRows.push({ kind: "text", label: `${label} missing defenders`, value: profile.missingDefenders.join(", "), tone: "warn" });
    if (profile.missingGoalkeepers?.length) squadRows.push({ kind: "text", label: `${label} missing goalkeepers`, value: profile.missingGoalkeepers.join(", "), tone: "warn" });
    if (profile.squad) {
      const benchRegulars = profile.squad
        .filter((m) => m.recentUsage && m.recentUsage.subAppearances + m.recentUsage.unusedBench >= 2 && m.recentUsage.subAppearances + m.recentUsage.unusedBench > m.recentUsage.starts)
        .sort((a, b) => (b.recentUsage!.matchesInSquad ?? 0) - (a.recentUsage!.matchesInSquad ?? 0))
        .slice(0, 5);
      if (benchRegulars.length) {
        squadRows.push({
          kind: "text",
          label: `${label} bench regulars (last 20)`,
          value: benchRegulars.map((m) => `${m.name} (${m.recentUsage!.starts} starts, ${m.recentUsage!.subAppearances} sub apps, ${m.recentUsage!.unusedBench} unused)`).join(", "),
        });
      }
      const recentFormLeaders = profile.squad
        .filter((m) => m.recentUsage && m.recentUsage.totalGoals + m.recentUsage.totalAssists > 0)
        .sort((a, b) => (b.recentUsage!.totalGoals + b.recentUsage!.totalAssists) - (a.recentUsage!.totalGoals + a.recentUsage!.totalAssists))
        .slice(0, 3);
      if (recentFormLeaders.length) {
        squadRows.push({
          kind: "text",
          label: `${label} recent form (last 20)`,
          value: recentFormLeaders
            .map((m) => `${m.name} (${m.recentUsage!.totalGoals}g/${m.recentUsage!.totalAssists}a, ${m.recentUsage!.totalXg.toFixed(2)}xG${m.recentUsage!.totalKeyPasses > 0 ? `, ${m.recentUsage!.totalKeyPasses} KP` : ""}${m.recentUsage!.goalsPer90 != null ? `, ${m.recentUsage!.goalsPer90}/90` : ""}${m.recentUsage!.avgRating != null ? `, ${m.recentUsage!.avgRating} rating` : ""})`)
            .join(", "),
        });
      }
    }
    if (profile.recentTransfers?.length) {
      const shown = profile.recentTransfers.slice(0, 5);
      squadRows.push({ kind: "text", label: `${label} transfers`, value: shown.map((t) => `${t.playerName} (${t.direction}${t.date ? `, ${t.date.slice(0, 10)}` : ""})`).join("; ") });
    }
  };
  squadInfo(teamProfile, ownIsHome ? homeTeam : awayTeam);
  squadInfo(opponentProfile, oppName);
  if (insights?.homeSquadStrength || insights?.awaySquadStrength) {
    const fmt = (v: number | null) => (v != null ? `€${(v / 1_000_000).toFixed(0)}m` : "n/a");
    const strengthRow = (s: typeof insights.homeSquadStrength, label: string) => {
      if (!s) return;
      squadRows.push({
        kind: "text",
        label: `${label} squad value`,
        value: `${fmt(s.totalValue)} total (${fmt(s.availableValue)} available) -- attack ${fmt(s.attackValue)}, midfield ${fmt(s.midfieldValue)}, defense ${fmt(s.defenseValue)}, GK ${fmt(s.goalkeeperValue)}`,
      });
    };
    strengthRow(insights.homeSquadStrength, homeTeam);
    strengthRow(insights.awaySquadStrength, awayTeam);
  }
  if (squadRows.length) sections.push({ title: "Squad", icon: "users", rows: squadRows });

  return sections;
}
