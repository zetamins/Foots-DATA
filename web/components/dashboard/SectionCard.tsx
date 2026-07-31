import { Activity, BarChart3, Calendar, Clock, Flag, Shield, TrendingUp, UserCheck, Users, type LucideIcon } from "lucide-react";
import { Card, CardHeader } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { StatBar } from "../ui/StatBar";
import type { Section } from "../../lib/dashboardSections";

const ICONS: Record<Section["icon"], LucideIcon> = {
  calendar: Calendar,
  trending: TrendingUp,
  flag: Flag,
  shield: Shield,
  activity: Activity,
  users: Users,
  "user-check": UserCheck,
  "bar-chart": BarChart3,
  clock: Clock,
};

export function SectionCard({ section }: { section: Section }) {
  return (
    <Card>
      <CardHeader icon={ICONS[section.icon]} title={section.title} />
      <div className="flex flex-col gap-3">
        {section.rows.map((row, i) =>
          row.kind === "bar" ? (
            <StatBar key={i} label={row.label} home={row.home} away={row.away} homeLabel={row.homeLabel} awayLabel={row.awayLabel} unit={row.unit} />
          ) : (
            <div key={i} className="flex items-start justify-between gap-3 text-sm">
              <span className="text-neutral-500">{row.label}</span>
              {row.tone ? (
                <Badge tone={row.tone}>{row.value}</Badge>
              ) : (
                <span className="text-right font-medium text-neutral-800 dark:text-neutral-200">{row.value}</span>
              )}
            </div>
          ),
        )}
      </div>
    </Card>
  );
}
