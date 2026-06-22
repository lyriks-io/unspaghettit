import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';

/**
 * Scaffolds the user-authored adapter that `unspa scenarios export` calls. The
 * export command generates the Vitest spec from a feature's scenarios; the only
 * thing the human still had to write by hand was this adapter. This generates
 * its skeleton — one `case` per scenario-bearing action, pre-seeded with the
 * implementation location recorded in `.unspa.json` (when known) — so the loop
 * from spec to a passing/failing code-vs-spec test is "fill the TODOs", not
 * "write the bridge from scratch".
 */

export type IndexHint = {
  readonly file?: string;
  readonly line?: number;
  readonly signature?: string;
};

export type AdapterScaffoldOptions = {
  /** Named export for the adapter. Defaults to `adapter` (matches the export command's default). */
  readonly adapterExportName?: string;
  /** Behavioral index (`.unspa.json` `index`) for implementation-location hints, keyed `action:<id>`. */
  readonly index?: Readonly<Record<string, IndexHint>>;
};

export type AdapterScaffoldResult = {
  readonly code: string;
  /** Number of actions that got a case (those carrying at least one scenario). */
  readonly actionCount: number;
};

const BANNER = `/**
 * GENERATED ADAPTER STUB — \`unspa scenarios adapter\`.
 *
 * EXPERIMENTAL: the adapter contract (UnspaAdapter / AdapterInvocation /
 * AdapterResult) may change between minor versions.
 *
 * Fill each case: drive your real implementation from input.initialState +
 * input.parameters and return its actual outcome { status, finalState }. Then
 * run \`unspa scenarios export <featureId>\` and \`vitest\` — the generated tests
 * assert your implementation against the same oracle the simulator uses, so
 * spec↔code drift fails loudly.
 */`;

const hintComment = (hint: IndexHint | undefined): string => {
  if (!hint?.file) return '      // impl: (not recorded in .unspa.json yet)';
  const loc = `${hint.file}${hint.line ? `:${hint.line}` : ''}`;
  return `      // impl: ${loc}${hint.signature ? ` — ${hint.signature}` : ''}`;
};

export const generateAdapterStub = (
  feature: Feature,
  options: AdapterScaffoldOptions = {}
): AdapterScaffoldResult => {
  const exportName = options.adapterExportName ?? 'adapter';
  const index = options.index ?? {};

  const cases: string[] = [];
  for (const surface of feature.surfaces) {
    for (const action of surface.actions) {
      // The export command only emits tests for scenario-bearing actions, so
      // those are exactly the cases the adapter needs.
      if ((action.scenarios ?? []).length === 0) continue;
      cases.push(
        [
          `      // ${surface.name} › ${action.name}`,
          hintComment(index[`action:${action.id}`]),
          `      case ${JSON.stringify(String(action.id))}: {`,
          `        // TODO: call your implementation; return only the paths the scenario asserts.`,
          `        throw new Error('Adapter not implemented: ${action.name.replace(/'/g, "\\'")} (' + input.actionId + ')');`,
          `      }`
        ].join('\n')
      );
    }
  }

  const body =
    cases.length > 0 ? cases.join('\n\n') : '      // (no scenario-bearing actions yet)';

  const code = `${BANNER}
import type {
  AdapterInvocation,
  AdapterResult,
  UnspaAdapter
} from 'unspaghettit/cli/scenarios';

export const ${exportName}: UnspaAdapter = {
  async invoke(input: AdapterInvocation): Promise<AdapterResult> {
    switch (input.actionId) {
${body}
      default:
        throw new Error('No adapter case for action ' + input.actionName + ' (' + input.actionId + ')');
    }
  }
};
`;

  return { code, actionCount: cases.length };
};
