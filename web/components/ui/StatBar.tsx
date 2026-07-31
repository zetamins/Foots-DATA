// A horizontal home-vs-away comparison bar -- two numeric values rendered
// as proportional segments from a shared center, with the raw numbers
// labeled. Used throughout the insights grid so paired stats (xG, shots,
// aerial duels, fouls, etc.) read visually instead of as bare numbers.
export function StatBar({ label, home, away, homeLabel, awayLabel, unit = "" }: { label: string; home: number; away: number; homeLabel: string; awayLabel: string; unit?: string }) {
  const total = home + away;
  const homePct = total > 0 ? (home / total) * 100 : 50;
  const awayPct = 100 - homePct;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          {home}
          {unit}
        </span>
        <span>{label}</span>
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          {away}
          {unit}
        </span>
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
        <div className="h-full bg-blue-500" style={{ width: `${homePct}%` }} />
        <div className="h-full bg-red-500" style={{ width: `${awayPct}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-neutral-400">
        <span>{homeLabel}</span>
        <span>{awayLabel}</span>
      </div>
    </div>
  );
}
