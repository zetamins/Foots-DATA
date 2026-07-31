export interface Dot {
  x: number;
  y: number;
}

// Goalkeeper (index 0) plus outfield rows, laid out left-to-right for the
// home side (own goal at x=4) and mirrored for away (own goal at x=96).
// Shared between the idle formation display and the live simulation, which
// applies further per-frame offsets on top of these base slots.
export function formationPositions(rows: number[], side: "home" | "away"): Dot[] {
  const positions: Dot[] = [{ x: side === "home" ? 4 : 96, y: 32 }];
  const rowCount = rows.length;
  for (let i = 0; i < rowCount; i++) {
    const t = rowCount === 1 ? 0.5 : i / (rowCount - 1);
    const x = side === "home" ? 18 + t * 28 : 82 - t * 28;
    const n = rows[i];
    for (let j = 0; j < n; j++) {
      const yT = n === 1 ? 0.5 : j / (n - 1);
      positions.push({ x, y: 6 + yT * 52 });
    }
  }
  return positions;
}

export function parseFormation(formation: string | null): { rows: number[]; isFallback: boolean } {
  if (formation) {
    const rows = formation.split("-").map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (rows.length && rows.reduce((a, b) => a + b, 0) === 10) return { rows, isFallback: false };
  }
  return { rows: [4, 4, 2], isFallback: true };
}
