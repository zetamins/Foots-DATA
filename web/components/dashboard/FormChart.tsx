"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardHeader } from "../ui/Card";
import { Activity } from "lucide-react";
import type { ReportJson } from "../../lib/types";

function counts(results: { result: "W" | "D" | "L" }[] | undefined) {
  return {
    W: results?.filter((r) => r.result === "W").length ?? 0,
    D: results?.filter((r) => r.result === "D").length ?? 0,
    L: results?.filter((r) => r.result === "L").length ?? 0,
  };
}

export function FormChart({ report }: { report: ReportJson }) {
  const homeIsSearched = report.match?.homeTeam === report.team;
  const homeForm = homeIsSearched ? report.form : report.opponentForm;
  const awayForm = homeIsSearched ? report.opponentForm : report.form;
  if (!homeForm && !awayForm) return null;

  const homeCounts = counts(homeForm?.last10Overall);
  const awayCounts = counts(awayForm?.last10Overall);

  const data = [
    { name: report.match!.homeTeam, Wins: homeCounts.W, Draws: homeCounts.D, Losses: homeCounts.L },
    { name: report.match!.awayTeam, Wins: awayCounts.W, Draws: awayCounts.D, Losses: awayCounts.L },
  ];

  return (
    <Card>
      <CardHeader icon={Activity} title="Last 10 results" />
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-neutral-200 dark:stroke-neutral-800" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Wins" fill="#10b981" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Draws" fill="#a3a3a3" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Losses" fill="#ef4444" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
