import type { ReportJson } from "./types";

export type Row =
  | { kind: "bar"; label: string; home: number; away: number; homeLabel: string; awayLabel: string; unit?: string }
  | { kind: "text"; label: string; value: string; tone?: "good" | "warn" | "bad" };

export interface Section {
  title: string;
  icon: "calendar" | "trending" | "flag" | "shield" | "activity" | "users" | "bar-chart" | "clock";
  rows: Row[];
}

function fmt(n: number | null | undefined, digits = 2): string {
  return n == null ? "n/a" : Number(n.toFixed(digits)).toString();
}

// Groups the ~90-field insights object (plus form/profile data) into
// dashboard sections. Deliberately data-driven rather than one bespoke
// component per field -- with this many paired home/away metrics, a
// generic {label, home, away} row (rendered as a StatBar) or a plain
// labeled line covers the same ground without 90 one-off components.
export function buildSections(report: ReportJson): Section[] {
  const { match, insights, form, opponentForm, teamProfile, opponentProfile } = report;
  if (!match) return [];
  const homeTeam = match.homeTeam;
  const awayTeam = match.awayTeam;
  const sections: Section[] = [];

  // --- Match snapshot ---
  const snapshot: Row[] = [];
  if (match.venueName) snapshot.push({ kind: "text", label: "Venue", value: `${match.venueName}${match.venueCity ? `, ${match.venueCity}` : ""}` });
  if (match.weather) snapshot.push({ kind: "text", label: "Weather", value: match.weather });
  if (match.referee) snapshot.push({ kind: "text", label: "Referee", value: match.refereeStats ? `${match.referee} (${match.refereeStats.yellowCardsPerGame} yellow/game)` : match.referee });
  if (match.attendance) snapshot.push({ kind: "text", label: "Attendance", value: match.attendance.toLocaleString() });
  if (match.headToHeadSummary) {
    const h = match.headToHeadSummary;
    snapshot.push({ kind: "text", label: "Head-to-head", value: `${homeTeam} ${h.homeWins}W - ${h.draws}D - ${h.awayWins}W ${awayTeam}` });
  }
  if (match.homeFormation || match.awayFormation) snapshot.push({ kind: "text", label: "Formations", value: `${match.homeFormation ?? "?"} vs ${match.awayFormation ?? "?"}` });
  if (snapshot.length) sections.push({ title: "Match snapshot", icon: "calendar", rows: snapshot });

  if (insights) {
    // --- Expected performance ---
    const perf: Row[] = [];
    if (insights.homeXgEstimate && insights.awayXgEstimate) {
      perf.push({ kind: "bar", label: "Season xG for", home: insights.homeXgEstimate.xgFor, away: insights.awayXgEstimate.xgFor, homeLabel: homeTeam, awayLabel: awayTeam });
    }
    if (insights.homeShotsEstimate && insights.awayShotsEstimate) {
      perf.push({ kind: "bar", label: "Shots (last 5)", home: insights.homeShotsEstimate.shotsFor, away: insights.awayShotsEstimate.shotsFor, homeLabel: homeTeam, awayLabel: awayTeam });
    }
    if (insights.homeBigChancesEstimate && insights.awayBigChancesEstimate) {
      perf.push({ kind: "bar", label: "Big chances created", home: insights.homeBigChancesEstimate.bigChancesCreatedFor, away: insights.awayBigChancesEstimate.bigChancesCreatedFor, homeLabel: homeTeam, awayLabel: awayTeam });
    }
    if (insights.homeCornersEstimate && insights.awayCornersEstimate) {
      perf.push({ kind: "bar", label: "Corners (last 5)", home: insights.homeCornersEstimate.cornersFor, away: insights.awayCornersEstimate.cornersFor, homeLabel: homeTeam, awayLabel: awayTeam });
    }
    if (insights.homePossessionMatchup) perf.push({ kind: "text", label: `${homeTeam} vs high-possession opps`, value: `${insights.homePossessionMatchup.highOpponentPossessionPPG ?? "n/a"} ppg` });
    if (insights.awayPossessionMatchup) perf.push({ kind: "text", label: `${awayTeam} vs high-possession opps`, value: `${insights.awayPossessionMatchup.highOpponentPossessionPPG ?? "n/a"} ppg` });
    if (perf.length) sections.push({ title: "Expected performance", icon: "trending", rows: perf });

    // --- Discipline ---
    const discipline: Row[] = [];
    if (insights.homeCardDiscipline) discipline.push({ kind: "text", label: `${homeTeam} cards`, value: `${insights.homeCardDiscipline.yellowPerGame}Y / ${insights.homeCardDiscipline.redPerGame}R per game`, tone: insights.homeCardDiscipline.elevatedRisk ? "warn" : undefined });
    if (insights.awayCardDiscipline) discipline.push({ kind: "text", label: `${awayTeam} cards`, value: `${insights.awayCardDiscipline.yellowPerGame}Y / ${insights.awayCardDiscipline.redPerGame}R per game`, tone: insights.awayCardDiscipline.elevatedRisk ? "warn" : undefined });
    if (insights.homeFoulsEstimate && insights.awayFoulsEstimate) {
      discipline.push({ kind: "bar", label: "Fouls committed (last 5)", home: insights.homeFoulsEstimate.foulsCommittedFor, away: insights.awayFoulsEstimate.foulsCommittedFor, homeLabel: homeTeam, awayLabel: awayTeam });
    }
    if (insights.homeCardRisks?.length) discipline.push({ kind: "text", label: `${homeTeam} card risk`, value: insights.homeCardRisks.map((r) => r.name).join(", "), tone: "warn" });
    if (insights.awayCardRisks?.length) discipline.push({ kind: "text", label: `${awayTeam} card risk`, value: insights.awayCardRisks.map((r) => r.name).join(", "), tone: "warn" });
    if (insights.refereeCardRiskNote) discipline.push({ kind: "text", label: "Referee books", value: `${insights.refereeCardRiskNote.yellowCardsPerGame} yellow/game`, tone: insights.refereeCardRiskNote.elevatedCardReferee ? "warn" : undefined });
    if (discipline.length) sections.push({ title: "Discipline", icon: "flag", rows: discipline });

    // --- Attacking & defensive profile ---
    const profile: Row[] = [];
    if (insights.homePassingStyle) profile.push({ kind: "text", label: `${homeTeam} passing`, value: `${fmt(insights.homePassingStyle.passAccuracyPct, 1)}% accuracy, ${fmt(insights.homePassingStyle.longBallSharePct, 1)}% long balls` });
    if (insights.awayPassingStyle) profile.push({ kind: "text", label: `${awayTeam} passing`, value: `${fmt(insights.awayPassingStyle.passAccuracyPct, 1)}% accuracy, ${fmt(insights.awayPassingStyle.longBallSharePct, 1)}% long balls` });
    if (insights.homeAerialEstimate && insights.awayAerialEstimate) {
      profile.push({ kind: "bar", label: "Aerial duels won (last 5)", home: insights.homeAerialEstimate.aerialDuelsWonFor, away: insights.awayAerialEstimate.aerialDuelsWonFor, homeLabel: homeTeam, awayLabel: awayTeam });
    }
    if (insights.homeGoalkeepingEstimate) profile.push({ kind: "text", label: `${homeTeam} goalkeeping`, value: `${fmt(insights.homeGoalkeepingEstimate.savePct, 1)}% save rate` });
    if (insights.awayGoalkeepingEstimate) profile.push({ kind: "text", label: `${awayTeam} goalkeeping`, value: `${fmt(insights.awayGoalkeepingEstimate.savePct, 1)}% save rate` });
    if (insights.homeDuelVulnerabilities?.length) profile.push({ kind: "text", label: `${homeTeam} duel risk`, value: insights.homeDuelVulnerabilities.map((d) => d.name).join(", "), tone: "warn" });
    if (insights.awayDuelVulnerabilities?.length) profile.push({ kind: "text", label: `${awayTeam} duel risk`, value: insights.awayDuelVulnerabilities.map((d) => d.name).join(", "), tone: "warn" });
    if (insights.homeFullbackExposure?.length) profile.push({ kind: "text", label: `${homeTeam} exposed fullbacks`, value: insights.homeFullbackExposure.map((d) => d.name).join(", "), tone: "warn" });
    if (insights.awayFullbackExposure?.length) profile.push({ kind: "text", label: `${awayTeam} exposed fullbacks`, value: insights.awayFullbackExposure.map((d) => d.name).join(", "), tone: "warn" });
    if (insights.homeSetPieceThreat) profile.push({ kind: "text", label: `${homeTeam} set-piece threat`, value: `${insights.homeSetPieceThreat.cornersPerGame ?? "n/a"} corners/game`, tone: insights.homeSetPieceThreat.elevated ? "good" : undefined });
    if (insights.awaySetPieceThreat) profile.push({ kind: "text", label: `${awayTeam} set-piece threat`, value: `${insights.awaySetPieceThreat.cornersPerGame ?? "n/a"} corners/game`, tone: insights.awaySetPieceThreat.elevated ? "good" : undefined });
    if (profile.length) sections.push({ title: "Attacking & defensive profile", icon: "shield", rows: profile });

    // --- Standings & stakes ---
    const standings: Row[] = [];
    if (insights.homeStandingsZone) standings.push({ kind: "text", label: homeTeam, value: `#${insights.homeStandingsZone.position}/${insights.homeStandingsZone.totalTeams} (${insights.homeStandingsZone.zone})` });
    if (insights.awayStandingsZone) standings.push({ kind: "text", label: awayTeam, value: `#${insights.awayStandingsZone.position}/${insights.awayStandingsZone.totalTeams} (${insights.awayStandingsZone.zone})` });
    if (insights.homeAdvantage) standings.push({ kind: "text", label: `${homeTeam} home advantage`, value: insights.homeAdvantage.strength ?? "n/a" });
    if (insights.awayAdvantage) standings.push({ kind: "text", label: `${awayTeam} home advantage`, value: insights.awayAdvantage.strength ?? "n/a" });
    if (insights.homeOpponentRankRecord) standings.push({ kind: "text", label: `${homeTeam} vs higher-ranked`, value: `${insights.homeOpponentRankRecord.wins}W-${insights.homeOpponentRankRecord.draws}D-${insights.homeOpponentRankRecord.losses}L` });
    if (insights.awayOpponentRankRecord) standings.push({ kind: "text", label: `${awayTeam} vs higher-ranked`, value: `${insights.awayOpponentRankRecord.wins}W-${insights.awayOpponentRankRecord.draws}D-${insights.awayOpponentRankRecord.losses}L` });
    if (standings.length) sections.push({ title: "Standings & stakes", icon: "bar-chart", rows: standings });

    // --- Situational factors ---
    const situational: Row[] = [];
    if (insights.restComparison) situational.push({ kind: "text", label: "Rest", value: `${homeTeam} ${insights.restComparison.ownRestDays ?? "n/a"}d vs ${awayTeam} ${insights.restComparison.opponentRestDays ?? "n/a"}d` });
    if (insights.homeFatigueFlag) situational.push({ kind: "text", label: `${homeTeam} fatigue`, value: insights.homeFatigueFlag.flagged ? "elevated" : "normal", tone: insights.homeFatigueFlag.flagged ? "warn" : "good" });
    if (insights.awayFatigueFlag) situational.push({ kind: "text", label: `${awayTeam} fatigue`, value: insights.awayFatigueFlag.flagged ? "elevated" : "normal", tone: insights.awayFatigueFlag.flagged ? "warn" : "good" });
    if (insights.homeRotation) situational.push({ kind: "text", label: `${homeTeam} rotation`, value: `${insights.homeRotation.changedPlayers}/${insights.homeRotation.startingXISize} changed last match` });
    if (insights.awayRotation) situational.push({ kind: "text", label: `${awayTeam} rotation`, value: `${insights.awayRotation.changedPlayers}/${insights.awayRotation.startingXISize} changed last match` });
    if (insights.homeResilience) situational.push({ kind: "text", label: `${homeTeam} resilience`, value: `${insights.homeResilience.drawSharePct}% of non-wins were draws` });
    if (insights.awayResilience) situational.push({ kind: "text", label: `${awayTeam} resilience`, value: `${insights.awayResilience.drawSharePct}% of non-wins were draws` });
    if (insights.experienceComparison) situational.push({ kind: "text", label: "Experience", value: `${homeTeam.slice(0, 3)} avg age ${insights.experienceComparison.ownAverageAge ?? "n/a"} vs ${awayTeam.slice(0, 3)} ${insights.experienceComparison.opponentAverageAge ?? "n/a"}` });
    if (insights.travelInfo) {
      const t = insights.travelInfo;
      situational.push({ kind: "text", label: "Travel", value: t.awayTraveling ? `${awayTeam} traveling (~${t.awayTravelDistanceKm ?? "?"}km)` : t.homeTraveling ? `${homeTeam} traveling (~${t.homeTravelDistanceKm ?? "?"}km)` : "Both at home turf" });
    }
    if (situational.length) sections.push({ title: "Situational factors", icon: "clock", rows: situational });
  }

  // --- Form & momentum ---
  const formRows: Row[] = [];
  if (form) {
    if (form.currentStreak) formRows.push({ kind: "text", label: `${report.team} streak`, value: `${form.currentStreak.count}-game ${form.currentStreak.result === "W" ? "winning" : form.currentStreak.result === "L" ? "losing" : "drawing"}` });
    if (form.momentum) formRows.push({ kind: "text", label: `${report.team} momentum`, value: `${form.momentum.recentPPG} ppg (last 3) -- ${form.momentum.trend}`, tone: form.momentum.trend === "improving" ? "good" : form.momentum.trend === "declining" ? "bad" : undefined });
    if (form.bttsSharePct != null) formRows.push({ kind: "text", label: `${report.team} BTTS rate`, value: `${form.bttsSharePct}%` });
  }
  if (opponentForm) {
    const oppName = homeTeam === report.team ? awayTeam : homeTeam;
    if (opponentForm.currentStreak) formRows.push({ kind: "text", label: `${oppName} streak`, value: `${opponentForm.currentStreak.count}-game ${opponentForm.currentStreak.result === "W" ? "winning" : opponentForm.currentStreak.result === "L" ? "losing" : "drawing"}` });
    if (opponentForm.momentum) formRows.push({ kind: "text", label: `${oppName} momentum`, value: `${opponentForm.momentum.recentPPG} ppg (last 3) -- ${opponentForm.momentum.trend}`, tone: opponentForm.momentum.trend === "improving" ? "good" : opponentForm.momentum.trend === "declining" ? "bad" : undefined });
  }
  if (formRows.length) sections.push({ title: "Form & momentum", icon: "activity", rows: formRows });

  // --- Squad ---
  const squadRows: Row[] = [];
  const topScorers = (profile: typeof teamProfile, label: string) => {
    if (!profile?.squad) return;
    const scorers = [...profile.squad]
      .filter((s) => s.seasonStats)
      .sort((a, b) => (b.seasonStats!.goals ?? 0) - (a.seasonStats!.goals ?? 0))
      .slice(0, 3);
    if (scorers.length) squadRows.push({ kind: "text", label: `${label} top scorers`, value: scorers.map((s) => `${s.name} (${s.seasonStats!.goals}g)`).join(", ") });
    if (profile.injuries?.length) squadRows.push({ kind: "text", label: `${label} injuries`, value: profile.injuries.map((i) => i.name).join(", "), tone: "warn" });
  };
  topScorers(teamProfile, homeTeam === report.team ? homeTeam : awayTeam);
  topScorers(opponentProfile, homeTeam === report.team ? awayTeam : homeTeam);
  if (squadRows.length) sections.push({ title: "Squad", icon: "users", rows: squadRows });

  return sections;
}
