"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Pitch from "./Pitch";
import { computeExpectedGoals, simulateMatch, type SimulationResult } from "../lib/simulate";
import type { ReportJson } from "../lib/types";

const MATCH_DURATION_SECONDS = 36; // 90 sim-minutes compressed into 36 real seconds

function randomBallTarget(bias: "home" | "away" | "mid") {
  const x = bias === "home" ? 15 + Math.random() * 25 : bias === "away" ? 60 + Math.random() * 25 : 35 + Math.random() * 30;
  const y = 8 + Math.random() * 48;
  return { x, y };
}

export default function Simulator() {
  const [report, setReport] = useState<ReportJson | null | undefined>(undefined);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [minute, setMinute] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scoreboard, setScoreboard] = useState({ home: 0, away: 0 });
  const [flashSide, setFlashSide] = useState<"home" | "away" | null>(null);
  const [ballTarget, setBallTarget] = useState(() => randomBallTarget("mid"));
  const [log, setLog] = useState<string[]>([]);
  const firedRef = useRef<Set<number>>(new Set());
  const rafRef = useRef<number | undefined>(undefined);
  const startRef = useRef<number>(0);
  const lastBallMoveRef = useRef(0);

  useEffect(() => {
    const raw = sessionStorage.getItem("football-report");
    setReport(raw ? (JSON.parse(raw) as ReportJson) : null);
  }, []);

  const expected = useMemo(() => (report ? computeExpectedGoals(report) : null), [report]);

  const homeTeam = report?.match?.homeTeam ?? "Home";
  const awayTeam = report?.match?.awayTeam ?? "Away";

  const runSimulation = () => {
    if (!report) return;
    const sim = simulateMatch(report);
    if (!sim) return;
    setResult(sim);
    setScoreboard({ home: 0, away: 0 });
    setMinute(0);
    setLog([]);
    firedRef.current = new Set();
    setFlashSide(null);
    setBallTarget(randomBallTarget("mid"));
    setPlaying(true);
    startRef.current = performance.now();
  };

  useEffect(() => {
    if (!playing || !result) return;

    const tick = (now: number) => {
      const elapsedSec = (now - startRef.current) / 1000;
      const currentMinute = Math.min(90, (elapsedSec / MATCH_DURATION_SECONDS) * 90);
      setMinute(currentMinute);

      for (const ev of result.events) {
        if (currentMinute >= ev.minute && !firedRef.current.has(ev.minute * 1000 + (ev.side === "home" ? 1 : 2))) {
          firedRef.current.add(ev.minute * 1000 + (ev.side === "home" ? 1 : 2));
          setScoreboard((s) => (ev.side === "home" ? { ...s, home: s.home + 1 } : { ...s, away: s.away + 1 }));
          setFlashSide(ev.side);
          setBallTarget(ev.side === "home" ? { x: 94, y: 32 } : { x: 6, y: 32 });
          setLog((l) => [...l, `${Math.round(ev.minute)}' ⚽ ${ev.side === "home" ? homeTeam : awayTeam}`]);
          setTimeout(() => setFlashSide(null), 1200);
        }
      }

      if (elapsedSec - lastBallMoveRef.current > 1.6 && !result.events.some((e) => Math.abs(e.minute - currentMinute) < 1)) {
        lastBallMoveRef.current = elapsedSec;
        const bias = Math.random() < 0.5 ? "home" : Math.random() < 0.9 ? "away" : "mid";
        setBallTarget(randomBallTarget(bias));
      }

      if (currentMinute < 90) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setPlaying(false);
        setBallTarget({ x: 50, y: 32 });
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, result]);

  if (report === undefined) {
    return <div className="p-10 text-sm text-neutral-500">Loading…</div>;
  }

  if (!report || !report.match) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-10">
        <p className="text-sm text-neutral-500">
          No report loaded. Run a search first, then click &ldquo;Simulate this match&rdquo;.
        </p>
        <Link href="/" className="text-sm font-medium text-emerald-600 underline">
          ← Back to search
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {homeTeam} vs {awayTeam}
        </h1>
        <Link href="/" className="text-sm text-neutral-500 underline">
          ← New search
        </Link>
      </div>

      {!expected && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Neither team has enough real data (season xG or recent-form goals) to simulate this match. This happens for
          teams with no finished matches on record yet this season.
        </div>
      )}

      {expected && (
        <>
          <div className="rounded-md border border-neutral-200 p-3 text-xs text-neutral-500 dark:border-neutral-800">
            Expected goals this match: <strong>{homeTeam} {expected.homeLambda}</strong> ({expected.basis.home === "xg" ? "season xG" : "last-5 goals avg"}) vs{" "}
            <strong>{awayTeam} {expected.awayLambda}</strong> ({expected.basis.away === "xg" ? "season xG" : "last-5 goals avg"}). Poisson-sampled from these
            rates — re-run to get a new draw, not the same score every time.
          </div>

          <Pitch
            homeFormation={report.match.homeFormation}
            awayFormation={report.match.awayFormation}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            ballTarget={ballTarget}
            flashSide={flashSide}
          />

          <div className="flex items-center justify-between">
            <div className="text-3xl font-bold tabular-nums">
              {scoreboard.home} – {scoreboard.away}
            </div>
            <div className="text-sm text-neutral-500">{Math.round(minute)}&apos;</div>
            <button
              onClick={runSimulation}
              disabled={playing}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {result ? "Simulate again" : "Run simulation"}
            </button>
          </div>

          {log.length > 0 && (
            <ul className="space-y-1 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
              {log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}

          {result && !playing && minute >= 90 && (
            <p className="text-sm text-neutral-500">
              Final: {homeTeam} {result.homeGoals} – {result.awayGoals} {awayTeam}
            </p>
          )}
        </>
      )}
    </div>
  );
}
