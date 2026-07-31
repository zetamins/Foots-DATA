"use client";

import type { Dot } from "../lib/pitch";
import { parseFormation } from "../lib/pitch";

export interface PitchProps {
  homeFormation: string | null;
  awayFormation: string | null;
  homeTeam: string;
  awayTeam: string;
  homePositions: Dot[];
  awayPositions: Dot[];
  ballPos: Dot;
  flashSide: "home" | "away" | null;
}

export default function Pitch({ homeFormation, awayFormation, homeTeam, awayTeam, homePositions, awayPositions, ballPos, flashSide }: PitchProps) {
  const home = parseFormation(homeFormation);
  const away = parseFormation(awayFormation);

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

        {homePositions.map((d, i) => (
          <circle
            key={`h${i}`}
            cx={d.x}
            cy={d.y}
            r={i === 0 ? 1.6 : 1.9}
            fill={i === 0 ? "#fde68a" : "#2563eb"}
            stroke="white"
            strokeWidth="0.2"
            /* no CSS transition here -- positions are already smoothly interpolated every animation frame by matchEngine.ts's stepEngine, so a CSS transition on top would just re-lag behind whatever it was already easing toward */
          />
        ))}
        {awayPositions.map((d, i) => (
          <circle
            key={`a${i}`}
            cx={d.x}
            cy={d.y}
            r={i === 0 ? 1.6 : 1.9}
            fill={i === 0 ? "#fde68a" : "#dc2626"}
            stroke="white"
            strokeWidth="0.2"
            /* no CSS transition here -- positions are already smoothly interpolated every animation frame by matchEngine.ts's stepEngine, so a CSS transition on top would just re-lag behind whatever it was already easing toward */
          />
        ))}

        <circle
          cx={ballPos.x}
          cy={ballPos.y}
          r="1"
          fill="white"
          stroke="#111"
          strokeWidth="0.15"
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
