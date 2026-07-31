"use client";

import { useEffect, useRef, useState } from "react";
import { parseFormation } from "../lib/simulate";

interface Dot {
  x: number;
  y: number;
}

function formationPositions(rows: number[], side: "home" | "away"): Dot[] {
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

// Small continuous jitter so the dots read as "alive" rather than a static
// diagram -- purely cosmetic, not tied to any simulated event.
function useJitter(base: Dot[], amplitude = 1.4) {
  const [offsets, setOffsets] = useState(() => base.map(() => ({ dx: 0, dy: 0, phase: Math.random() * Math.PI * 2 })));
  const startRef = useRef(performance.now());

  useEffect(() => {
    let raf: number;
    const tick = () => {
      const t = (performance.now() - startRef.current) / 1000;
      setOffsets((prev) =>
        prev.map((o, i) => ({
          ...o,
          dx: Math.sin(t * 0.6 + o.phase + i) * amplitude,
          dy: Math.cos(t * 0.5 + o.phase + i * 1.3) * amplitude,
        })),
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.length]);

  return offsets;
}

export interface PitchProps {
  homeFormation: string | null;
  awayFormation: string | null;
  homeTeam: string;
  awayTeam: string;
  ballTarget: Dot;
  flashSide: "home" | "away" | null;
}

export default function Pitch({ homeFormation, awayFormation, homeTeam, awayTeam, ballTarget, flashSide }: PitchProps) {
  const home = parseFormation(homeFormation);
  const away = parseFormation(awayFormation);
  const homeDots = formationPositions(home.rows, "home");
  const awayDots = formationPositions(away.rows, "away");
  const homeJitter = useJitter(homeDots);
  const awayJitter = useJitter(awayDots);

  return (
    <div className="flex flex-col gap-1">
      <svg viewBox="0 0 100 64" className="w-full rounded-md border border-emerald-800 bg-emerald-700">
        {/* pitch markings */}
        <rect x="0.5" y="0.5" width="99" height="63" fill="none" stroke="white" strokeOpacity="0.6" strokeWidth="0.3" />
        <line x1="50" y1="0.5" x2="50" y2="63.5" stroke="white" strokeOpacity="0.6" strokeWidth="0.3" />
        <circle cx="50" cy="32" r="8" fill="none" stroke="white" strokeOpacity="0.6" strokeWidth="0.3" />
        <rect x="0.5" y="18" width="12" height="28" fill="none" stroke="white" strokeOpacity="0.6" strokeWidth="0.3" />
        <rect x="87.5" y="18" width="12" height="28" fill="none" stroke="white" strokeOpacity="0.6" strokeWidth="0.3" />

        {flashSide && (
          <rect
            x={flashSide === "home" ? 87.5 : 0.5}
            y="18"
            width="12"
            height="28"
            fill="yellow"
            opacity="0.35"
            className="animate-pulse"
          />
        )}

        {homeDots.map((d, i) => (
          <circle
            key={`h${i}`}
            cx={d.x + (homeJitter[i]?.dx ?? 0)}
            cy={d.y + (homeJitter[i]?.dy ?? 0)}
            r={i === 0 ? 1.6 : 1.9}
            fill={i === 0 ? "#fde68a" : "#2563eb"}
            stroke="white"
            strokeWidth="0.2"
          />
        ))}
        {awayDots.map((d, i) => (
          <circle
            key={`a${i}`}
            cx={d.x + (awayJitter[i]?.dx ?? 0)}
            cy={d.y + (awayJitter[i]?.dy ?? 0)}
            r={i === 0 ? 1.6 : 1.9}
            fill={i === 0 ? "#fde68a" : "#dc2626"}
            stroke="white"
            strokeWidth="0.2"
          />
        ))}

        <circle
          cx={ballTarget.x}
          cy={ballTarget.y}
          r="1"
          fill="white"
          stroke="#111"
          strokeWidth="0.15"
          style={{ transition: "cx 1.4s ease-in-out, cy 1.4s ease-in-out" }}
        />
      </svg>
      <div className="flex justify-between px-1 text-xs text-neutral-500">
        <span>
          {homeTeam} {home.isFallback ? "(formation not published, showing 4-4-2)" : `(${homeFormation})`}
        </span>
        <span>
          {awayTeam} {away.isFallback ? "(formation not published, showing 4-4-2)" : `(${awayFormation})`}
        </span>
      </div>
    </div>
  );
}
