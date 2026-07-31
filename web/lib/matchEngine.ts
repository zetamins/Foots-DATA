import type { Dot } from "./pitch";

// A lightweight possession/passing model, not a physics engine: the ball
// moves between actual (currently-shifted) player positions on the
// possessing team rather than jumping to arbitrary points, each team's
// shape pushes forward when attacking and drops back when defending, and
// the 1-2 nearest opposing players drift toward the ball to read as
// marking/pressing. None of this feeds back into the score -- the score is
// still purely the Poisson draw from simulate.ts; this only has to *look*
// like a match while that draw plays out.

const ADVANCE_SHIFT = 16; // how far the attacking team's shape pushes forward
const RETREAT_SHIFT = 6; // how far the defending team drops back
const PRESS_RADIUS = 22;
const PRESS_STRENGTH = 5;
const MIN_PHASE_MS = 3000;
const MAX_PHASE_MS = 6500;
const MIN_PASS_MS = 700;
const MAX_PASS_MS = 1400;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function lerpDot(a: Dot, b: Dot, t: number): Dot {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}
function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export interface EngineState {
  possession: "home" | "away";
  phaseStart: number;
  phaseDuration: number;
  carrierIndex: number;
  ballFrom: Dot;
  ballTo: Dot;
  passStart: number;
  passDuration: number;
  // Non-null while a sampled goal event is playing out: normal phase/pass
  // logic is fully suspended until the caller explicitly calls
  // resetAfterGoal (once its own goal-flash timer elapses).
  shotSide: "home" | "away" | null;
}

export function createEngineState(now: number, possession: "home" | "away" = Math.random() < 0.5 ? "home" : "away"): EngineState {
  return {
    possession,
    phaseStart: now,
    phaseDuration: randRange(MIN_PHASE_MS, MAX_PHASE_MS),
    carrierIndex: 5,
    ballFrom: { x: 50, y: 32 },
    ballTo: { x: 50, y: 32 },
    passStart: now,
    passDuration: randRange(MIN_PASS_MS, MAX_PASS_MS),
    shotSide: null,
  };
}

// Called the instant a sampled goal event's minute is reached -- overrides
// normal passing flow so the ball drives toward the scoring side's target
// goal for a beat before the flash fires, instead of just teleporting.
export function triggerGoal(state: EngineState, now: number, side: "home" | "away", currentBall: Dot): void {
  state.possession = side;
  state.shotSide = side;
  state.ballFrom = currentBall;
  state.ballTo = side === "home" ? { x: 92, y: 32 } : { x: 8, y: 32 };
  state.passStart = now;
  state.passDuration = 900;
}

// Called once the goal-flash beat is done -- restarts the phase clock with
// the conceding side kicking off, matching how a real restart works.
export function resetAfterGoal(state: EngineState, now: number, scoringSide: "home" | "away"): void {
  state.possession = scoringSide === "home" ? "away" : "home";
  state.phaseStart = now;
  state.phaseDuration = randRange(MIN_PHASE_MS, MAX_PHASE_MS);
  state.carrierIndex = 5;
  state.passStart = now;
  state.passDuration = randRange(MIN_PASS_MS, MAX_PASS_MS);
  state.shotSide = null;
  state.ballFrom = { x: 50, y: 32 };
  state.ballTo = { x: 50, y: 32 };
}

function shiftedPositions(base: Dot[], side: "home" | "away", shiftAmount: number): Dot[] {
  const dir = side === "home" ? 1 : -1;
  return base.map((d) => ({ x: d.x + dir * shiftAmount, y: d.y }));
}

function pickCarrierIndex(outfieldCount: number, progress: number, current: number): number {
  const target = 1 + Math.round(progress * (outfieldCount - 1));
  const jitter = Math.round(randRange(-1.5, 1.5));
  const next = Math.max(1, Math.min(outfieldCount, target + jitter));
  return next === current && outfieldCount > 1 ? (next % outfieldCount) + 1 : next;
}

export interface FrameResult {
  homePositions: Dot[];
  awayPositions: Dot[];
  ballPos: Dot;
}

// Advances the engine by however much time has passed and returns the
// positions to render this frame. `homeBase`/`awayBase` are each team's
// static formation slots (index 0 = goalkeeper); this never mutates them.
export function stepEngine(state: EngineState, now: number, homeBase: Dot[], awayBase: Dot[]): FrameResult {
  if (state.shotSide == null) {
    if (now - state.phaseStart > state.phaseDuration) {
      const flip = Math.random() < 0.45;
      state.possession = flip ? (state.possession === "home" ? "away" : "home") : state.possession;
      state.phaseStart = now;
      state.phaseDuration = randRange(MIN_PHASE_MS, MAX_PHASE_MS);
    }
  }

  const progress = easeInOut(clamp01((now - state.phaseStart) / state.phaseDuration));
  const homeShift = state.possession === "home" ? progress * ADVANCE_SHIFT : -progress * RETREAT_SHIFT;
  const awayShift = state.possession === "away" ? progress * ADVANCE_SHIFT : -progress * RETREAT_SHIFT;
  const homePositions = shiftedPositions(homeBase, "home", homeShift);
  const awayPositions = shiftedPositions(awayBase, "away", awayShift);

  if (state.shotSide == null && now - state.passStart > state.passDuration) {
    // Current ball position (under the OLD from/to/timing) becomes the new
    // starting point, so the ball never jumps -- it always continues from
    // wherever it visually is.
    const finishedT = clamp01((now - state.passStart) / state.passDuration);
    state.ballFrom = lerpDot(state.ballFrom, state.ballTo, finishedT);

    const possessingBase = state.possession === "home" ? homePositions : awayPositions;
    state.carrierIndex = pickCarrierIndex(possessingBase.length - 1, progress, state.carrierIndex);
    state.ballTo = possessingBase[state.carrierIndex] ?? state.ballFrom;
    state.passStart = now;
    state.passDuration = randRange(MIN_PASS_MS, MAX_PASS_MS);
  }

  const passT = clamp01((now - state.passStart) / state.passDuration);
  const ballPos = lerpDot(state.ballFrom, state.ballTo, passT);

  // The team WITHOUT the ball has its 1-2 nearest outfield players drift
  // toward it -- reads as marking/pressing rather than static positioning.
  const press = (mine: Dot[]) => {
    const withDist = mine
      .map((d, i) => ({ i, d, dist: Math.hypot(d.x - ballPos.x, d.y - ballPos.y) }))
      .filter((p) => p.i > 0) // never pull the goalkeeper out of position this way
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 2);
    for (const { i, d, dist } of withDist) {
      if (dist > PRESS_RADIUS) continue;
      const pull = PRESS_STRENGTH * (1 - dist / PRESS_RADIUS);
      const dx = ballPos.x - d.x;
      const dy = ballPos.y - d.y;
      const len = Math.hypot(dx, dy) || 1;
      mine[i] = { x: d.x + (dx / len) * pull, y: d.y + (dy / len) * pull };
    }
  };
  if (state.possession === "home") press(awayPositions);
  else press(homePositions);

  return { homePositions, awayPositions, ballPos };
}
