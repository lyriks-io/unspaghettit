import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FeatureRepository } from '../../src/features/behavior-model/application/ports/FeatureRepository';
import {
  FeatureNotFoundError,
  FeatureValidationError,
  type mutateFeatureUseCase
} from '../../src/features/behavior-model/application/use-cases/MutateFeature';
import { EntityNotFoundInFeatureError } from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type {
  ActionId,
  SurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import type { getImplementationStatusUseCase } from '../../src/features/implementation-status/application/use-cases/GetImplementationStatus';
import type { reportImplementationStatusUseCase } from '../../src/features/implementation-status/application/use-cases/ReportImplementationStatus';
import type { ProvenanceRepository } from '../../src/features/source-provenance/application/ports/ProvenanceRepository';
import type { ProjectSourceRepository } from '../../src/features/source-provenance/application/ports/ProjectSourceRepository';
import type { ProjectRepository } from '../../src/features/projects/application/ports/ProjectRepository';
import type { Clock } from '../../src/shared/domain/Clock';
import type { IdGenerator } from '../../src/shared/domain/IdGenerator';
import { runScenariosUseCase } from '../../src/features/simulator/application/use-cases/RunScenarios';
import type { RepoContext } from '../server';
import { expandFeatureId } from './short-ids';

export type ToolDeps = {
  readonly server: McpServer;
  readonly repo: FeatureRepository;
  readonly projectRepo: ProjectRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly mutateFeature: ReturnType<typeof mutateFeatureUseCase>;
  readonly reportImplementationStatus: ReturnType<typeof reportImplementationStatusUseCase>;
  readonly getImplementationStatus: ReturnType<typeof getImplementationStatusUseCase>;
  readonly provenanceRepo: ProvenanceRepository;
  readonly sourceRepo: ProjectSourceRepository;
  /** Context the CLI passed about the host repo (link, cwd). */
  readonly repoContext?: RepoContext;
  /**
   * The running server's package version, so get_repo_context can report an
   * available update. Set by the real entrypoint; omitted in tests (which then
   * skip the update check, keeping the network out of the test path).
   */
  readonly version?: string;
};

// Compact JSON: every byte of whitespace is a token sent to / from the LLM.
// Pretty-printing is for humans; tool I/O is for the model.
export const json = (value: unknown) => JSON.stringify(value);

export const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: json(value) }]
});

export const errorText = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true
});

/**
 * Translate the typed errors raised by write use-cases into the MCP error
 * envelope. Callers pass any thrown value; everything else is reported as
 * a generic "Write failed" so the AI sees something actionable.
 */
export const writeErrorText = (e: unknown) => {
  if (e instanceof FeatureNotFoundError) return errorText(e.message);
  if (e instanceof EntityNotFoundInFeatureError) return errorText(e.message);
  if (e instanceof FeatureValidationError) {
    return errorText(`${e.message}\n - ${e.errors.join('\n - ')}`);
  }
  return errorText(`Write failed: ${(e as Error).message}`);
};

// Slim mutation ack. Every write tool returns this shape so the agent never
// has to read the full Feature back. For add_* tools, `id` is the new
// entity's id (so the agent can chain immediately). For update_* / remove_*
// tools, `id` is omitted. The caller already has the featureId, but we
// echo it for symmetry and to confirm the persisted updatedAt.
export type MutationAck = {
  readonly ok: true;
  readonly featureId: string;
  readonly updatedAt: string;
  readonly id?: string;
};

export const ack = (featureId: string, updatedAt: string, createdId?: string): MutationAck =>
  createdId !== undefined
    ? { ok: true, featureId, updatedAt, id: createdId }
    : { ok: true, featureId, updatedAt };

/**
 * Coerce a value into the JS shape implied by the declared schema type.
 *
 * Why this exists: clients that call MCP tools over JSON-RPC preserve numeric
 * and boolean types end-to-end, but the LLM tool-call envelope serializes
 * scalars as strings when the parameter is typed as untyped (`z.unknown()`).
 * Those land here as `"0"` / `"true"` and the strict validators downstream
 * (state default-value must be assignable to declared type) reject them.
 *
 * Strategy: only touch strings. Real numbers/booleans/arrays/objects pass
 * through unchanged. For `number` we accept any finite numeric string. For
 * `boolean` we accept the literals `"true"`/`"false"`. For `array`/`object`
 * we try `JSON.parse`. Anything that fails coercion is returned as the
 * original string so the validator's error message stays intact.
 *
 * The declared type comes from the surrounding context (e.g. the state
 * definition's `type` field), not from inspecting the value itself.
 */
/**
 * The six canonical scalar/collection types the core model knows, plus the
 * synonyms an LLM most often reaches for (`int`, `bool`, `str`, ...). The
 * standalone tools accept the whole list at the Zod boundary; every write path
 * runs the value through `normalizeStateType` first, so a natural `type:"int"`
 * lands as `number` instead of bouncing off the validator. This directly
 * removes the "type:int rejects zero" friction (there was no `int` type, so a
 * counter with `defaultValue:0` could never be declared).
 */
export const STATE_TYPE_INPUT_VALUES = [
  'string',
  'number',
  'boolean',
  'enum',
  'object',
  'array',
  'int',
  'integer',
  'float',
  'double',
  'long',
  'decimal',
  'bool',
  'str',
  'text',
  'list',
  'collection',
  'map',
  'dict'
] as const;

/**
 * The same list for an action PARAMETER, which additionally carries the format
 * types (date, email, geolocation, ...). Parameters used to accept the six
 * canonical types alone, so a natural `type:"int"` bounced off the Zod enum
 * even though the identical value works on a state path. One real build hit
 * exactly that and modelled its integer inputs as states with `add`
 * expressions, which is a worse model written to satisfy a validator.
 */
export const PARAMETER_TYPE_INPUT_VALUES = [
  'string',
  'number',
  'boolean',
  'enum',
  'object',
  'array',
  'date',
  'time',
  'timestamp',
  'url',
  'email',
  'geolocation',
  'int',
  'integer',
  'float',
  'double',
  'long',
  'decimal',
  'bool',
  'str',
  'text',
  'list',
  'collection',
  'map',
  'dict'
] as const;

const STATE_TYPE_ALIASES: Readonly<Record<string, string>> = {
  int: 'number',
  integer: 'number',
  float: 'number',
  double: 'number',
  long: 'number',
  decimal: 'number',
  bool: 'boolean',
  str: 'string',
  text: 'string',
  // The collection effects are NAMED *_to_list, so `type:"list"` is the
  // synonym every LLM reaches for first. Before this alias existed, the bogus
  // type slipped through the batch path and every downstream error blamed the
  // value instead of the type ("expected list, got object"), which read as
  // "the engine cannot simulate lists". It can; the type is `array`.
  list: 'array',
  collection: 'array',
  map: 'object',
  dict: 'object'
};

/**
 * Map a state/param type alias onto its canonical form. Canonical types and
 * anything unrecognized pass through unchanged, so the downstream validator
 * still reports a genuinely bogus type.
 */
export const normalizeStateType = (type: unknown): unknown =>
  typeof type === 'string' && type in STATE_TYPE_ALIASES ? STATE_TYPE_ALIASES[type] : type;

export const coerceScalarByType = (value: unknown, type: string | undefined): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  if (!type) return value;
  switch (type) {
    case 'number':
    case 'integer': {
      if (value.trim() === '') return value;
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    case 'boolean':
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    case 'array':
    case 'object':
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return value;
      }
    default:
      return value;
  }
};

const runScenarios = runScenariosUseCase();

/**
 * After a rule/invariant mutation lands, run the scenarios that cover the
 * affected scope. Surfaces any scenario whose expectedStatus diverges from
 * its actual outcome under the new spec so the LLM gets immediate feedback
 * that a gate it just tightened broke an existing executable spec.
 *
 * Returns null when no scenarios cover the scope (nothing to report; ack
 * stays slim). Otherwise returns a compact summary: tallies + the names of
 * the failing scenarios. Full details are still available via
 * `run_all_scenarios` if the agent wants them.
 */
const scenarioImpact = (
  result: Awaited<ReturnType<ToolDeps['mutateFeature']>>,
  scope: { readonly surfaceId?: SurfaceId; readonly actionId?: ActionId }
): {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly breaking: readonly {
    readonly id: string;
    readonly name: string;
    readonly summary: string;
  }[];
} | null => {
  const out = runScenarios({
    feature: result,
    ...(scope.surfaceId ? { surfaceId: scope.surfaceId } : {}),
    ...(scope.actionId ? { actionId: scope.actionId } : {})
  });
  if (out.total === 0) return null;
  return {
    total: out.total,
    passed: out.passed,
    failed: out.failed,
    breaking: out.results
      .filter((r) => !r.pass)
      .map((r) => ({
        id: String(r.scenarioId),
        name: r.scenarioName,
        summary: r.summary
      }))
  };
};

/**
 * Helper used by every granular write tool. Runs `mutateFeature` and
 * converts the typed errors into the MCP error envelope. Returns a slim
 * ack instead of the full Feature so each write is O(1) in token cost
 * regardless of how big the model has grown.
 *
 * `opts.scenarioScope` opts the mutation into a scenario-impact check.
 * Pass for rule/invariant mutations (which are the operations that most
 * commonly flip a previously-passing scenario into a failure). When set,
 * the ack includes `scenarioImpact: {passed, failed, breaking}` if any
 * scenarios cover the scope. Slim summary only.
 */
export const runMutation = async (
  deps: ToolDeps,
  input: Parameters<ToolDeps['mutateFeature']>[0],
  opts?: {
    readonly createdId?: string;
    readonly scenarioScope?: { readonly surfaceId?: SurfaceId; readonly actionId?: ActionId };
  }
) => {
  try {
    // Short-id support at the featureId boundary: every write tool funnels
    // through here, so one expansion call covers them all. Inner ids
    // (actionId, surfaceId, …) still require per-tool expansion; full UUIDs
    // hit the fast path so this is free when the prototype flag is off.
    const expandedFeatureId = await expandFeatureId(deps.repo, String(input.featureId));
    const expandedInput = {
      ...input,
      featureId: expandedFeatureId as typeof input.featureId
    };
    const result = await deps.mutateFeature(expandedInput);
    const baseAck = ack(result.id, result.updatedAt, opts?.createdId);
    if (!opts?.scenarioScope) return text(baseAck);
    // The write is already persisted at this point. A scenario-impact check
    // that throws (pre-existing broken scenario data in the covered scope)
    // must not turn a LANDED write into a "Write failed:" response: that
    // taught agents that update_* is broken and pushed them into remove+add
    // loops while their writes were silently stacking up on disk.
    try {
      const impact = scenarioImpact(result, opts.scenarioScope);
      return text(impact === null ? baseAck : { ...baseAck, scenarioImpact: impact });
    } catch (impactError) {
      return text({
        ...baseAck,
        scenarioImpactError: `The write was SAVED, but the post-write scenario check could not run: ${(impactError as Error).message}. Run run_all_scenarios for details.`
      });
    }
  } catch (e) {
    return writeErrorText(e);
  }
};
