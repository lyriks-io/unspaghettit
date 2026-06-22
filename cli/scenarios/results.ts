/**
 * The bridge that turns a real `vitest run` into verified spec coverage.
 *
 * The generated scenario spec prefixes each `it(...)` title with a machine
 * token — `[unspa:<surfaceId>:<actionId>:<scenarioId>]` — so a standard Vitest
 * JSON report (`vitest run --reporter=json --outputFile=...`) can be parsed
 * back into "which scenarios the IMPLEMENTATION actually passed", with no
 * custom reporter or config. `unspa coverage ingest` reads that report and
 * stamps `verifiedAt` on the matching `.unspa.json` entries — promoting an
 * entity from "claimed implemented" to "proven against the spec".
 *
 * Pure + framework-agnostic: the token format lives here once, used by the
 * codegen (to emit) and the ingester (to parse), so the two can't drift.
 */

/** Build the title token the codegen prepends to each generated `it(...)`. */
export const scenarioTitleToken = (
  surfaceId: string,
  actionId: string,
  scenarioId: string
): string => `[unspa:${surfaceId}:${actionId}:${scenarioId}]`;

const TOKEN = /\[unspa:([^:\]]+):([^:\]]+):([^:\]]+)\]/;

export type ScenarioResult = {
  readonly surfaceId: string;
  readonly actionId: string;
  readonly scenarioId: string;
  readonly passed: boolean;
};

/**
 * Parse a Vitest JSON report (Jest-compatible shape) into per-scenario
 * pass/fail. Ignores tests with no unspa token (the user's own tests in the
 * same run). Tolerant of partial shapes — a malformed report yields [].
 */
export const parseScenarioResults = (raw: unknown): ScenarioResult[] => {
  const root = raw as {
    testResults?: ReadonlyArray<{
      assertionResults?: ReadonlyArray<{
        title?: string;
        fullName?: string;
        status?: string;
      }>;
    }>;
  };
  const out: ScenarioResult[] = [];
  for (const file of root?.testResults ?? []) {
    for (const a of file?.assertionResults ?? []) {
      const match = TOKEN.exec(a.title ?? a.fullName ?? '');
      if (!match) continue;
      const [, surfaceId, actionId, scenarioId] = match;
      if (!surfaceId || !actionId || !scenarioId) continue;
      out.push({ surfaceId, actionId, scenarioId, passed: a.status === 'passed' });
    }
  }
  return out;
};

export type ActionVerification = {
  readonly actionId: string;
  readonly total: number;
  readonly passed: number;
  /** True when the action has at least one scenario result and every one passed. */
  readonly verified: boolean;
};

/** Roll per-scenario results up to per-action: an action is verified iff all its scenarios passed. */
export const summarizeByAction = (
  results: readonly ScenarioResult[]
): readonly ActionVerification[] => {
  const byAction = new Map<string, { total: number; passed: number }>();
  for (const r of results) {
    const acc = byAction.get(r.actionId) ?? { total: 0, passed: 0 };
    acc.total += 1;
    if (r.passed) acc.passed += 1;
    byAction.set(r.actionId, acc);
  }
  return [...byAction.entries()].map(([actionId, { total, passed }]) => ({
    actionId,
    total,
    passed,
    verified: total > 0 && passed === total
  }));
};
