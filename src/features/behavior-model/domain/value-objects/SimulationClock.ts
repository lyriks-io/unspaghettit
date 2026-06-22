import { asStatePath, readPath, writePath, type StateSnapshot, type StatePath } from './StatePath';

/**
 * Reserved state path holding the simulation clock — a NUMBER in logical time
 * units chosen by the model (seconds, minutes, ticks; the engine doesn't care).
 * It is the single source of "now" that conditions and invariants compare
 * stored timestamps against ("session.expiresAt greater_than clock.now"), and
 * the `advance_time` effect / scenario `timeAdvance` are the only sanctioned
 * ways to move it forward.
 *
 * Time is EXPLICIT state, never wall-clock: a scenario that advances the clock
 * by N and re-runs an action is fully deterministic and replayable, which is
 * what makes "after 30 minutes the token is expired" verifiable instead of
 * flaky. The path is implicitly available on every surface (the validator
 * treats it as always-declared). The engine does NOT auto-seed it — the clock
 * materializes the first time it is advanced — but it reads as 0 until then via
 * `readNow`, so future-deadline comparisons behave as "time 0".
 */
export const CLOCK_NOW_PATH: StatePath = asStatePath('clock.now');

/** Read the current clock value, defaulting to 0 when unset/non-numeric. */
export const readNow = (snapshot: StateSnapshot): number => {
  const v = readPath(snapshot, CLOCK_NOW_PATH);
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

/**
 * Advance the clock by `by` logical units. Time never runs backward: a negative
 * or non-finite delta is clamped to 0 (a no-op), so a malformed duration can't
 * un-expire something already expired.
 */
export const advanceClock = (snapshot: StateSnapshot, by: number): StateSnapshot => {
  const delta = typeof by === 'number' && Number.isFinite(by) && by > 0 ? by : 0;
  return writePath(snapshot, CLOCK_NOW_PATH, readNow(snapshot) + delta);
};
