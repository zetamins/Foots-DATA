"use client";

import { useState } from "react";
import { Download, FileJson, Search } from "lucide-react";
import { useSearchStream } from "../lib/useSearchStream";
import { buildSections } from "../lib/dashboardSections";
import { MatchHeader } from "./dashboard/MatchHeader";
import { FormChart } from "./dashboard/FormChart";
import { SectionCard } from "./dashboard/SectionCard";
import { Card } from "./ui/Card";

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function Dashboard() {
  const [team, setTeam] = useState("");
  const { status, progress, report, markdown, error, run } = useSearchStream();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = team.trim();
    if (!trimmed || status === "loading") return;
    run(trimmed);
  };

  const base = report ? slugify(report.team) : "report";
  const sections = report ? buildSections(report) : [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Football Report</h1>
        <p className="text-sm text-neutral-500">
          Search a team. Sofascore, Fotmob, SoccerDesk, Goal.com, and 365Scores are scraped live and merged into one
          analysis dashboard.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          placeholder='Team name, e.g. "Arsenal"'
          className="flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={status === "loading" || !team.trim()}
          className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          <Search className="h-4 w-4" />
          {status === "loading" ? "Searching…" : "Search"}
        </button>
      </form>

      {status === "loading" && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900">
          <p className="mb-1 font-medium text-neutral-500">
            Live scraping in progress — a full search runs sequentially across 5 sources and can take a few minutes.
          </p>
          <ul className="space-y-0.5 font-mono text-neutral-600 dark:text-neutral-400">
            {progress.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {status === "error" && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {status === "done" && report && report.match && (
        <div className="flex flex-col gap-4">
          <MatchHeader report={report} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormChart report={report} />
            {sections.map((section, i) => (
              <SectionCard key={i} section={section} />
            ))}
          </div>

          <Card className="flex items-center justify-between text-xs text-neutral-500">
            <span>
              Sources: {report.sources.map((s) => `${s.source} (${s.fixturesScraped})`).join(", ")}
            </span>
          </Card>

          <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-neutral-200 bg-white/90 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
            <button
              onClick={() => download(`${base}.json`, JSON.stringify(report, null, 2), "application/json")}
              className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
            >
              <FileJson className="h-4 w-4" /> Download JSON
            </button>
            <button
              onClick={() => download(`${base}.md`, markdown, "text/markdown")}
              className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
            >
              <Download className="h-4 w-4" /> Download Markdown
            </button>
          </div>
        </div>
      )}

      {status === "done" && report && !report.match && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          No upcoming match found for &ldquo;{report.team}&rdquo; from any source.
        </div>
      )}
    </div>
  );
}
