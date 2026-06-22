import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import type { Action } from '../../src/features/behavior-model/domain/entities/Action';
import type { Surface } from '../../src/features/behavior-model/domain/entities/Surface';
import type {
  Scenario,
  ScenarioAssertion
} from '../../src/features/behavior-model/domain/entities/Scenario';
import type { Persona } from '../../src/features/behavior-model/domain/entities/Persona';
import {
  applyPersonaToParameters,
  applyPersonaToSnapshot
} from '../../src/features/behavior-model/domain/services/PersonaApplier';
import {
  applyScenarioToParameters,
  applyScenarioToSnapshot
} from '../../src/features/behavior-model/domain/services/ScenarioApplier';
import { mergeSnapshotWithDefaults } from '../../src/features/behavior-model/domain/services/StateSnapshot';
import { isExpression } from '../../src/features/behavior-model/domain/value-objects/Expression';
import { simulate } from '../../src/features/simulator/domain/SimulatorEngine';
import { scenarioTitleToken } from './results';

export type CodegenOptions = {
  /**
   * Module specifier the generated test uses to import the adapter. The wedge
   * keeps this configurable so users can colocate the adapter wherever fits
   * their codebase (./tests/adapter, ../src/spec/adapter, package alias, ...).
   * Default reflects the common case of an adapter alongside the test file.
   */
  readonly adapterImportPath?: string;
  /** Named export to pull from the adapter module. Defaults to `adapter`. */
  readonly adapterExportName?: string;
  /**
   * When true, every generated `it` block is also prefixed with a comment
   * line containing the simulator's predicted status. Useful at codegen time
   * for spotting drift between authored expectedStatus and simulator output
   * without gating emission. Defaults to true.
   */
  readonly annotateSimulatorPrediction?: boolean;
};

export type CodegenResult = {
  readonly code: string;
  /** One entry per scenario the generator considered. */
  readonly scenarios: readonly CodegenScenarioReport[];
};

export type CodegenScenarioReport = {
  readonly surfaceId: string;
  readonly surfaceName: string;
  readonly actionId: string;
  readonly actionName: string;
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly authoredStatus: 'success' | 'blocked';
  readonly simulatorStatus: 'success' | 'blocked';
  readonly drift: boolean;
  readonly assertionsEmitted: number;
  readonly assertionsSkipped: number;
};

const DEFAULT_OPTIONS = {
  adapterImportPath: './unspa.adapter',
  adapterExportName: 'adapter',
  annotateSimulatorPrediction: true
} satisfies Required<CodegenOptions>;

const jsonLiteral = (value: unknown): string => JSON.stringify(value);

const tsString = (value: string): string => JSON.stringify(value);

const escapeBlockComment = (text: string): string =>
  text.replace(/\*\//g, '*\\/');

type ResolvedScenario = {
  readonly surface: Surface;
  readonly action: Action;
  readonly scenario: Scenario;
  readonly persona: Persona | null;
  readonly initialState: Record<string, unknown>;
  readonly parameters: Record<string, unknown>;
};

const resolveScenario = (
  feature: Feature,
  surface: Surface,
  action: Action,
  scenario: Scenario
): ResolvedScenario => {
  const persona: Persona | null =
    scenario.personaId !== undefined
      ? feature.personas.find((p) => p.id === scenario.personaId) ?? null
      : null;
  if (scenario.personaId !== undefined && persona === null) {
    throw new Error(
      `Scenario ${String(scenario.id)} on action ${String(action.id)} references unknown personaId "${String(scenario.personaId)}"`
    );
  }
  const personaSnapshot = persona ? applyPersonaToSnapshot(persona, {}) : {};
  const personaParams = persona ? applyPersonaToParameters(persona, action, {}) : {};
  const authoredSnapshot = applyScenarioToSnapshot(scenario, personaSnapshot);
  // Materialize the same fully-defaulted snapshot the simulator runs against,
  // so the embedded `initialState` matches what the simulator saw and the
  // user-written adapter doesn't have to mirror spec defaults itself. The
  // simulator also fills defaults internally; we do it here so the value is
  // visible inside the generated test as a plain JSON literal.
  const initialState = mergeSnapshotWithDefaults(authoredSnapshot, surface.stateDefinitions);
  const scenarioParams = applyScenarioToParameters(scenario, action, {});
  const parameters = { ...personaParams, ...scenarioParams };
  return {
    surface,
    action,
    scenario,
    persona,
    initialState: initialState as Record<string, unknown>,
    parameters: parameters as Record<string, unknown>
  };
};

const expectAssertion = (assertion: ScenarioAssertion): string | null => {
  // The wedge doesn't yet resolve right-hand Expressions against runtime
  // state — that would require shipping the expression evaluator into the
  // generated test. Skip with a comment so the human knows what's missing.
  if (assertion.value !== undefined && isExpression(assertion.value)) {
    return `  // [skipped] assertion at ${tsString(String(assertion.path))} uses an Expression on the right-hand side. The wedge only emits literal-comparison assertions; rewrite as a literal or wait for the expression-aware codegen.`;
  }
  const pathExpr = `getStatePath(result.finalState, ${tsString(String(assertion.path))})`;
  const literal = jsonLiteral(assertion.value);
  switch (assertion.operator) {
    case 'equals':
      return `  expect(${pathExpr}).toEqual(${literal});`;
    case 'not_equals':
      return `  expect(${pathExpr}).not.toEqual(${literal});`;
    case 'greater_than':
      return `  expect(${pathExpr}).toBeGreaterThan(${literal});`;
    case 'lower_than':
      return `  expect(${pathExpr}).toBeLessThan(${literal});`;
    case 'contains':
      // Spec semantics: arrays contain element, strings contain substring.
      // Vitest's toContain handles both shapes.
      return `  expect(${pathExpr}).toContain(${literal});`;
    case 'is_true':
      return `  expect(${pathExpr}).toBe(true);`;
    case 'is_false':
      return `  expect(${pathExpr}).toBe(false);`;
    case 'exists':
      return `  expect(${pathExpr}).not.toBeUndefined();`;
    case 'does_not_exist':
      return `  expect(${pathExpr}).toBeUndefined();`;
  }
};

const renderScenarioBlock = (
  feature: Feature,
  resolved: ResolvedScenario,
  simulatorStatus: 'success' | 'blocked',
  annotate: boolean
): { readonly code: string; readonly report: CodegenScenarioReport } => {
  const { surface, action, scenario, persona, initialState, parameters } = resolved;
  const authoredStatus = scenario.expectedStatus ?? 'success';
  const drift = authoredStatus !== simulatorStatus;

  const driftBanner = annotate
    ? `      // Simulator says: ${simulatorStatus}. Scenario says: ${authoredStatus}.${drift ? ' (DRIFT — investigate.)' : ''}\n`
    : '';

  // Assertions only run on success — authoring "x equals 3 after success" is
  // meaningless when the action got blocked. Mirrors runScenariosUseCase.
  // When the scenario is authored as blocked, every expectedAssertion the
  // human wrote is dropped at codegen time (and counted as skipped) so the
  // emitted test doesn't silently pass against unchanged state.
  const assertionLines: string[] = [];
  let skipped = 0;
  const authored = scenario.expectedAssertions ?? [];
  if (authoredStatus === 'success') {
    for (const a of authored) {
      const line = expectAssertion(a);
      if (line === null) {
        skipped += 1;
        continue;
      }
      if (line.startsWith('  // [skipped]')) {
        skipped += 1;
        assertionLines.push(`    ${line.trim()}`);
        continue;
      }
      assertionLines.push(`    ${line.trim()}`);
    }
  } else {
    // Blocked scenario: every authored assertion is skipped on purpose.
    skipped = authored.length;
    if (authored.length > 0) {
      assertionLines.push(
        `    // ${authored.length} expectedAssertion${authored.length === 1 ? '' : 's'} authored on this scenario were dropped — the action is expected to be blocked, so post-effect state assertions would be meaningless.`
      );
    }
  }

  const transitionLines: string[] = [];
  if (scenario.expectedTransition !== undefined && authoredStatus === 'success') {
    if (scenario.expectedTransition === null) {
      transitionLines.push(`    // expectedTransition was authored as null (no transition).`);
      transitionLines.push(`    // The wedge does not model transitions yet; add a check on result if your adapter exposes one.`);
    } else {
      transitionLines.push(
        `    // expectedTransition: ${tsString(String(scenario.expectedTransition))}. Adapter must expose post-action surface routing for this to be checked; not yet wired.`
      );
    }
  }

  const titleToken = scenarioTitleToken(
    String(surface.id),
    String(action.id),
    String(scenario.id)
  );
  const code = [
    `  it(${tsString(`${titleToken} ${scenario.name}`)}, async () => {`,
    driftBanner.trimEnd(),
    `    const initialState = ${jsonLiteral(initialState)};`,
    `    const parameters = ${jsonLiteral(parameters)};`,
    ``,
    `    const result = await adapter.invoke({`,
    `      featureId: ${tsString(String(feature.id))},`,
    `      featureName: ${tsString(feature.name)},`,
    `      surfaceId: ${tsString(String(surface.id))},`,
    `      surfaceName: ${tsString(surface.name)},`,
    `      actionId: ${tsString(String(action.id))},`,
    `      actionName: ${tsString(action.name)},`,
    `      scenarioId: ${tsString(String(scenario.id))},`,
    `      scenarioName: ${tsString(scenario.name)},`,
    `      personaId: ${persona ? tsString(String(persona.id)) : 'null'},`,
    `      personaName: ${persona ? tsString(persona.name) : 'null'},`,
    `      initialState,`,
    `      parameters`,
    `    });`,
    ``,
    `    expect(result.status).toBe(${tsString(authoredStatus)});`,
    ...assertionLines,
    ...transitionLines,
    `  });`
  ]
    .filter((line) => line !== '')
    .join('\n');

  const emitted = (scenario.expectedAssertions ?? []).length - skipped;
  return {
    code: code.replace(/\n{3,}/g, '\n\n'),
    report: {
      surfaceId: String(surface.id),
      surfaceName: surface.name,
      actionId: String(action.id),
      actionName: action.name,
      scenarioId: String(scenario.id),
      scenarioName: scenario.name,
      authoredStatus,
      simulatorStatus,
      drift,
      assertionsEmitted: emitted,
      assertionsSkipped: skipped
    }
  };
};

const STATE_PATH_HELPER = `
// Dotted state-path lookup. Mirrors the spec's path semantics: a missing
// segment returns undefined rather than throwing, so "exists / does_not_exist"
// assertions work the same way the simulator evaluates them. Plain JS so the
// generated file can be evaluated in a JS-only sandbox (some test harnesses
// strip TS before running scenarios).
const getStatePath = (root, path) => {
  let current = root;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return current;
};
`.trimStart();

/**
 * Pure: produces the Vitest test file string for a feature, plus a per-scenario
 * report the CLI surfaces to the user.
 *
 * The generator runs the deterministic simulator for every scenario at codegen
 * time. The simulator's predicted status is recorded in the report (and, when
 * `annotateSimulatorPrediction` is on, embedded as a comment in the emitted
 * test) so drift between authored expectedStatus and simulator output stays
 * visible. Emission is NOT gated on agreement — the generator's job is to
 * produce tests the user can run; surfacing drift is the user's call.
 */
export const generateScenarioSpec = (
  feature: Feature,
  options: CodegenOptions = {}
): CodegenResult => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const reports: CodegenScenarioReport[] = [];
  const surfaceBlocks: string[] = [];

  for (const surface of feature.surfaces) {
    const actionBlocks: string[] = [];
    for (const action of surface.actions) {
      const scenarios = action.scenarios ?? [];
      if (scenarios.length === 0) continue;
      const scenarioBlocks: string[] = [];
      for (const scenario of scenarios) {
        const resolved = resolveScenario(feature, surface, action, scenario);
        const simResult = simulate({
          surface,
          action,
          snapshot: resolved.initialState,
          parameters: resolved.parameters,
          featureInvariants: feature.featureInvariants,
          feature
        });
        const simulatorStatus: 'success' | 'blocked' =
          simResult.status === 'blocked' ? 'blocked' : 'success';
        const { code, report } = renderScenarioBlock(
          feature,
          resolved,
          simulatorStatus,
          opts.annotateSimulatorPrediction
        );
        scenarioBlocks.push(code);
        reports.push(report);
      }
      if (scenarioBlocks.length > 0) {
        actionBlocks.push(
          `  describe(${tsString(action.name)}, () => {\n${scenarioBlocks.join('\n\n')}\n  });`
        );
      }
    }
    if (actionBlocks.length > 0) {
      surfaceBlocks.push(
        `describe(${tsString(`Surface: ${surface.name}`)}, () => {\n${actionBlocks.join('\n\n')}\n});`
      );
    }
  }

  const header = [
    `/**`,
    ` * AUTO-GENERATED by \`unspa scenarios export ${escapeBlockComment(String(feature.id))}\`.`,
    ` * Do not edit by hand — re-run the command after editing the spec.`,
    ` *`,
    ` * Feature: ${escapeBlockComment(feature.name)} (${escapeBlockComment(String(feature.id))})`,
    ` * Scenarios: ${reports.length}`,
    ` *`,
    ` * EXPERIMENTAL (preview feature). The adapter contract (UnspaAdapter,`,
    ` * AdapterInvocation, AdapterResult) may change between minor versions`,
    ` * until the wedge graduates. Pin your unspaghettit dependency if your`,
    ` * CI depends on these tests.`,
    ` *`,
    ` * Adapter shape:`,
    ` *   import type { UnspaAdapter } from 'unspaghettit/cli/scenarios';`,
    ` *   export const adapter: UnspaAdapter = { invoke: async (input) => ... };`,
    ` */`,
    `import { describe, it, expect } from 'vitest';`,
    `import { ${opts.adapterExportName} } from ${tsString(opts.adapterImportPath)};`,
    ``,
    STATE_PATH_HELPER.trimEnd()
  ].join('\n');

  const body =
    surfaceBlocks.length > 0
      ? surfaceBlocks.join('\n\n')
      : `// No scenarios authored on this feature yet. Add expectedAssertions on at least one Action's scenarios and re-run.`;

  return {
    code: `${header}\n\n${body}\n`,
    scenarios: reports
  };
};
