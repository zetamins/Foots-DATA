import { CalendarClock, MapPin } from "lucide-react";
import { Card } from "../ui/Card";
import type { ReportJson } from "../../lib/types";

function formatWhen(kickoffUtc: string | null): string {
  if (!kickoffUtc) return "TBD";
  return new Date(kickoffUtc).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function MatchHeader({ report }: { report: ReportJson }) {
  const m = report.match!;
  return (
    <Card className="bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-neutral-900">
      <div className="flex flex-col items-center gap-1 py-2 text-center">
        <span className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">{m.competition ?? "Match"}</span>
        <div className="flex items-center gap-4 text-xl font-bold text-neutral-900 dark:text-neutral-100 sm:text-2xl">
          <span>{m.homeTeam}</span>
          <span className="text-sm font-normal text-neutral-400">vs</span>
          <span>{m.awayTeam}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-neutral-500">
          <span className="flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5" /> {formatWhen(m.kickoffUtc)}
          </span>
          {m.venueName && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {m.venueName}
              {m.venueCity ? `, ${m.venueCity}` : ""}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
