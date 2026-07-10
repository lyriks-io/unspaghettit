import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FeatureRepository } from '../src/features/behavior-model/application/ports/FeatureRepository';
import { mutateFeatureUseCase } from '../src/features/behavior-model/application/use-cases/MutateFeature';
import { exportFeatureToJson } from '../src/features/behavior-model/infrastructure/io/FeatureJson';
import type { ImplementationStatusRepository } from '../src/features/implementation-status/application/ports/ImplementationStatusRepository';
import { InMemoryImplementationStatusRepository } from '../src/features/implementation-status/infrastructure/persistence/InMemoryImplementationStatusRepository';
import type { ProvenanceRepository } from '../src/features/source-provenance/application/ports/ProvenanceRepository';
import { InMemoryProvenanceRepository } from '../src/features/source-provenance/infrastructure/persistence/InMemoryProvenanceRepository';
import type { ProjectSourceRepository } from '../src/features/source-provenance/application/ports/ProjectSourceRepository';
import { InMemoryProjectSourceRepository } from '../src/features/source-provenance/infrastructure/persistence/InMemoryProjectSourceRepository';
import { getImplementationStatusUseCase } from '../src/features/implementation-status/application/use-cases/GetImplementationStatus';
import { reportImplementationStatusUseCase } from '../src/features/implementation-status/application/use-cases/ReportImplementationStatus';
import type { ProjectRepository } from '../src/features/projects/application/ports/ProjectRepository';
import { InMemoryProjectRepository } from '../src/features/projects/infrastructure/persistence/InMemoryProjectRepository';
import { systemClock, type Clock } from '../src/shared/domain/Clock';
import { cryptoIdGenerator, type IdGenerator } from '../src/shared/domain/IdGenerator';
import { registerGuideResource } from './resources/guide';
import { registerOperationsResource } from './resources/operations';
import { registerBatchTool } from './tools/batch';
import { registerBehavioralIndexTools } from './tools/behavioralIndex';
import { registerActionTools } from './tools/action';
import { registerConstantTools } from './tools/constant';
import { registerEntityTools } from './tools/entity';
import { registerEntityFieldTools } from './tools/entityField';
import { registerEffectTools } from './tools/effect';
import { registerEventTools } from './tools/event';
import { registerFeatureTools } from './tools/feature';
import { registerImplementationStatusTools } from './tools/implementationStatus';
import { registerInvariantTools } from './tools/invariant';
import { registerParameterTools } from './tools/parameter';
import { registerPersonaTools } from './tools/persona';
import { registerProjectTools } from './tools/project';
import { registerProvenanceTools } from './tools/provenance';
import { registerReachabilityGoalTools } from './tools/reachabilityGoal';
import { registerQueueTools } from './tools/queue';
import { registerReadTools } from './tools/read';
import { registerReorderTools } from './tools/reorder';
import { registerRepoContextTool } from './tools/repoContext';
import { registerResourceTools } from './tools/resource';
import { registerRuleTools } from './tools/rule';
import { registerScenarioTools } from './tools/scenario';
import { registerSpecGapsTool } from './tools/specGaps';
import { registerStateDefinitionTools } from './tools/state';
import { registerSurfaceTools } from './tools/surface';
import { registerTransitionTools } from './tools/transition';
import { registerValueSetTools } from './tools/valueSet';
import { registerVerificationTools } from './tools/verification';
import { json, type ToolDeps } from './tools/_shared';
import { metrics } from './metrics';
import type { RepoLink } from './repo-link';

/**
 * Read the package.json next to this file so the MCP server reports the
 * same version the CLI ships. Hardcoding it has bitten us before — the
 * literal stayed at 0.1.2 long after the package shipped 0.1.5, and MCP
 * clients see that in capability negotiation.
 */
const PACKAGE_VERSION: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/**
 * Information the CLI passes about the repo this MCP server was started in.
 * Lets the LLM ask `get_repo_context` once and discover which feature the
 * developer has bound this repo to (via `unspa link` / `.unspa.json`).
 */
export type RepoContext = {
  readonly cwd: string;
  readonly link: RepoLink | null;
  readonly linkPath: string | null;
  /**
   * Git root the `.unspa.json` walk stopped at without finding a link (see
   * discoverRepoLink). Optional so hand-built test contexts stay terse.
   */
  readonly repoBoundary?: string | null;
};

export type BuildServerDeps = {
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly statusRepo?: ImplementationStatusRepository;
  readonly provenanceRepo?: ProvenanceRepository;
  readonly sourceRepo?: ProjectSourceRepository;
  readonly projectRepo?: ProjectRepository;
  readonly repoContext?: RepoContext;
};

// Cold-start primer for any LLM that connects to this server with no other
// context. Sent once via the MCP `initialize` response. Keep tight: every
// byte is paid once per session, but it offsets per-tool description bloat.
const SERVER_INSTRUCTIONS = `Unspaghettit models software as executable behavior. The unit is a Feature: ONE coherent slice of behavior inside a Project (a flow, a screen, a capability), sized so you can hold it all in head at once. Rule of thumb: 1-15 surfaces, 30-100 actions. A Feature is NOT a whole product. "Add filter to results" is one Feature; "Spotify clone" is a Project that needs many Features. If a Feature grows past 15 surfaces, split it. Hierarchy: Domain tag > Project > Feature > Surface > Action > State/Rule/Effect. A Domain is only a project tag/grouping for filtering Projects, not its own modeling page.

Feature shape: { id, name, surfaces[], personas[], resources[], entities[], events[], featureInvariants[], reachabilityGoals[], devContext? }. A Surface is one context (screen, terminal, workflow, canvas, ...) holding stateDefinitions[], actions[], rules[], invariants[], transitions[]. An Action is a user/AI-triggerable action with parameters[], rules[], effects[], invariants[], requiredStates[], emittedEvents[]. State lives at dotted paths ("cart.itemCount"); StateDefinition declares the schema (path, type, defaultValue, sharedWith?:other surfaces that also use it).

Naming convention: names are for humans first. Use short Title Case noun phrases for surfaces ("Checkout", "MCP Server") and verb phrases for actions ("Apply Batch", "Get Repo Context", "Manage Rules"). Let parent context carry repeated words: on the "MCP Server" surface, write "Create Feature" or "Manage Surfaces", not "Create Feature via MCP" or a repeated "MCP ..." prefix. Avoid boilerplate suffixes/prefixes across siblings; put technical identifiers, tool ids, file paths, HTTP verbs, or storage names in descriptions and implementation indexes unless the user-facing concept is literally that technical object.

Descriptions are mandatory for every authored element: Project, Feature, Surface, StateDefinition, Parameter, Rule, Effect, Invariant, Transition, Persona, Resource, Entity, EntityField, Scenario, Scenario expectedAssertion, Event, and Event payload field. Action uses its mandatory intent as the description. If context is missing, ask or write a concise description before calling tools.

Rules guard behavior: { category, condition: { left: statePath, operator (equals|not_equals|greater_than|lower_than|contains|is_true|is_false|exists|does_not_exist), right? }, effect }. condition.right accepts either a raw literal OR a structured Expression so the model can compare state-to-state, state-to-parameter, and compute arithmetic. Expression AST (discriminated by \`kind\`): { kind:"literal", value } | { kind:"state", path } | { kind:"param", name } | { kind:"add"|"sub"|"mul"|"div"|"mod"|"min"|"max", left, right } | { kind:"neg", operand }. Example win condition: condition:{ left:"player.lapsCompleted", operator:"greater_than", right:{kind:"state", path:"match.lapsToWin"} } expresses player.lapsCompleted > match.lapsToWin honestly.

Effects are discriminated by type: set_state{path,value} | show_message{message,tone?} | emit_event{event} | block_action{reason} | allow_action | transition_surface{target}. set_state.value also accepts an Expression. Value:{kind:"add", left:{kind:"state", path:"player.vx"}, right:{kind:"param", name:"ax"}} writes vx+ax atomically. In apply_batch the transition_surface effect accepts targetRef so it can wire to a surface created earlier in the same batch.

Events are first-class entities in feature.events[] with { name, description, payloadSchema? }. emit_event effects and action.emittedEvents reference them by name. Register the event once via add_event so the dashboard knows the payload shape. Invariants are post-conditions; violations block the run. Reachability goals (feature.reachabilityGoals, add_reachability_goal) are the liveness complement to invariants: kind "reachable" asserts a target state is achievable at all, "always_reachable" asserts it stays reachable from every reachable state; model_check / verify evaluate them over the state space and return the shortest action path to any trap.

Value sets are named, reusable enums in feature.valueSets[] { name, values }. A state or parameter of type enum can reference one via valueSetId instead of inlining enumValues (add_value_set), so the allowed values live in one place. Inline enumValues still work; the two are mutually exclusive per field.

Scenarios sit under actions and have optional personaId plus stateOverrides[] + parameterOverrides[]. run_all_scenarios applies the persona baseline first, then the scenario overrides. Adding expectedStatus + expectedAssertions[] makes them executable specs. Optional steps[] replay preceding actions before the subject action (each a real simulate, threading state forward) so a scenario can verify a multi-action flow. Call run_all_scenarios after edits to confirm nothing drifted.

Workflow:
0. Call get_repo_context once at session start. If linked:true, the developer has bound this repo to one project via .unspa.json. The response includes linkedProjectId, linkedProjectName, and the project's features[{id,name}]. Scope all subsequent calls to that project: pick the right featureId from features[] for the task at hand (use file paths being edited, action name in the user prompt, and the surrounding context). When ambiguous, ask the user which feature they mean.
1. Discover with list_features then list_actions. get_feature returns an INDEX (ids+names+counts+devContext) by default. Drill into a single action with get_action. Only pass get_feature(verbose:true) when you genuinely need the full blob; it is ~10× larger.
2. For multi-step edits use apply_batch. N ops in one atomic load+validate+save. Add ops can capture their new id under op.ref so later ops in the same batch reference it via *Ref (e.g. surfaceRef:"shop") instead of *Id; add_state_definition.sharedWith also accepts those refs. Pass dryRun:true to validate and get maturity feedback without saving. Strongly preferred over many granular calls.
3. Validate risky proposals with apply_batch dryRun:true, dry_run_simulate (pure, no persist), run_all_scenarios (executes every scenario, including its persona baseline when set, through the simulator and checks expectedStatus + expectedAssertions), model_check (bounded exhaustive exploration of the reachable state space — finds invariant counterexamples with the action path that reaches them, dead actions, deadlocks, and unreachable/terminal surfaces, beyond the example flows scenarios cover), and score_feature (maturity report) before committing. Run find_state_references before renaming/removing a state path. To gate a whole feature/project in one call (the CI shape), use verify: it folds scenarios + maturity + reachability + optional model_check + drift + cross-feature event coherence + verified coverage into a single pass/warn/fail verdict (the in-chat form of the \`unspa check\` CLI). Use get_drift to find code that was audited against an older spec than the one now on disk. Cross-FEATURE safety properties (referencing state in different features) live as project.projectInvariants — author via add_project_invariant; verify --modelCheck enforces them. Verified coverage: after implementing, run the generated scenario spec and \`unspa coverage ingest\` to stamp actions "proven against code" (not just claimed); gate with verify minVerified / \`unspa check --min-verified\`.

Behavioral index: when a repo is linked (.unspa.json present), the implementation map lives in that file. A Record<"type:id-or-path", {status, file, line, signature, auditedAt?, gitCommit?, specVersion?, kind?, relatedFiles?, testFile?, knownGaps?}>. Call get_behavioral_index to read the current map; call get_implementation_gaps to see what is missing, partial, or implemented relative to the spec. To update the index: use your file tools to write .unspa.json directly (you write it, the MCP only reads). Exception, adopting an EXISTING codebase (code -> spec): attach the files you analyzed with attach_source_file kind:"code" (fileName = repo-relative path), record_element_span for every element, finalize_analysis, then seed_index_from_analysis writes the index entries for you from the code spans (one pass = model + provenance + coverage). After updating .unspa.json either way, call sync_from_index. It reads the index, resolves all UUIDs from the spec automatically, and posts a full report in one call. Prefer sync_from_index over the lower-level report_implementation_status_batch unless you need per-entity granularity. Staleness detection: compare entry.gitCommit vs "git log --format=%H -1 <file>" for file changes; for spec drift call get_drift (it compares each entry.specVersion vs the owning feature.updatedAt and returns the stale/unversioned/orphan buckets) instead of doing it by hand.

IDs are opaque server-minted strings. Never invent them. Get them from list_*/get_* responses or apply_batch refs. save_feature is an escape hatch for full-replace edits; prefer apply_batch. All write ops return slim acks ({ok, featureId, updatedAt, id?}); re-read with get_action only when you need the new shape.

Tagging. Projects and Features carry optional {type, value} tags for cross-cutting filtering ("Team: Growth", "Domain: Commerce", "Status: WIP"). Use add_project_tag / remove_project_tag and add_feature_tag / remove_feature_tag for the common one-tag-at-a-time flow (idempotent, dedups case-insensitively by tagKey). Use update_project / update_feature when you need to replace the whole tag set at once. Tags also flow in on create_project and create_feature. Dashboard-MCP parity rule: any tagging action the user can do in the app is callable atomically via these tools; new dashboard actions must ship with a matching MCP tool (and vice-versa).

Collaboration mode. Always offer this choice before modeling:
SCAFFOLDING: create surfaces + action skeletons quickly, leave rules/invariants/transitions empty. Right when the user wants to map the shape of a feature first and fill in logic later.
DEEP MODELING: fill in rules, invariants, effects, and transitions fully, asking the user for each piece of domain logic you cannot derive. Right when the user wants a complete, runnable spec.
Never invent domain logic. A vague description is a prompt to ask, not a license to guess. Rules encode what is allowed and what is blocked. Only the user knows that. Invariants encode what must always be true. Only the user knows that. Transitions encode where the user goes. Only the user knows that. Read the guide (unspa://guide § Modeling interview) for the per-entity questions to ask.

Implementation quality. The spec is WHAT; the host repo is HOW. Probe before writing: sample a few existing files (one piece of logic, one I/O path, one UI surface, one test) and produce code indistinguishable in quality and style from what's already there. Match the test framework, naming, layout, and level of layering even where you'd have chosen differently - consistency beats local optimization. If the repo is greenfield/empty, scale structure to the work: one file for a script, flat module for a small feature (~3 actions), folders separating logic/IO/UI for a medium feature (~5-15 actions), formal ports+adapters only when the feature is big enough that "where does this go" becomes a recurring question. Three principles always hold regardless of layering: (1) pure logic doesn't import I/O - time, IDs, network, file system are passed in, not reached for; (2) UI doesn't contain business logic - conditions and transforms belong in a function the UI calls; (3) external dependencies are substitutable - storage, time, network, randomness are injected so tests can fake them. The bar is "a senior reviewer would accept without rewriting from scratch", not perfection - the user will refactor further. Full checklist in unspa://guide § Implementation quality.`;

export const buildServer = (repo: FeatureRepository, deps: BuildServerDeps = {}): McpServer => {
  const clock = deps.clock ?? systemClock;
  const ids = deps.ids ?? cryptoIdGenerator;
  const statusRepo = deps.statusRepo ?? new InMemoryImplementationStatusRepository();
  const provenanceRepo = deps.provenanceRepo ?? new InMemoryProvenanceRepository();
  const sourceRepo = deps.sourceRepo ?? new InMemoryProjectSourceRepository();
  const projectRepo = deps.projectRepo ?? new InMemoryProjectRepository();
  const mutateFeature = mutateFeatureUseCase({ repository: repo, clock });
  const reportImplementationStatus = reportImplementationStatusUseCase({
    features: repo,
    statuses: statusRepo,
    clock
  });
  const getImplementationStatus = getImplementationStatusUseCase({ statuses: statusRepo });

  const server = new McpServer(
    { name: 'unspa', version: PACKAGE_VERSION },
    { instructions: SERVER_INSTRUCTIONS }
  );

  const toolDeps: ToolDeps = {
    server,
    repo,
    projectRepo,
    clock,
    ids,
    mutateFeature,
    reportImplementationStatus,
    getImplementationStatus,
    provenanceRepo,
    sourceRepo,
    repoContext: deps.repoContext
  };

  registerGuideResource(server);
  registerOperationsResource(server);
  registerRepoContextTool(toolDeps);
  registerBehavioralIndexTools(toolDeps);
  registerReadTools(toolDeps);
  registerFeatureTools(toolDeps);
  registerSurfaceTools(toolDeps);
  registerActionTools(toolDeps);
  registerStateDefinitionTools(toolDeps);
  registerParameterTools(toolDeps);
  registerRuleTools(toolDeps);
  registerEffectTools(toolDeps);
  registerEventTools(toolDeps);
  registerInvariantTools(toolDeps);
  registerReachabilityGoalTools(toolDeps);
  registerTransitionTools(toolDeps);
  registerPersonaTools(toolDeps);
  registerValueSetTools(toolDeps);
  registerConstantTools(toolDeps);
  registerResourceTools(toolDeps);
  registerEntityTools(toolDeps);
  registerEntityFieldTools(toolDeps);
  registerScenarioTools(toolDeps);
  registerReorderTools(toolDeps);
  registerBatchTool(toolDeps);
  registerImplementationStatusTools(toolDeps);
  registerProvenanceTools(toolDeps);
  registerProjectTools(toolDeps);
  registerQueueTools(toolDeps);
  registerSpecGapsTool(toolDeps);
  registerVerificationTools(toolDeps);

  server.registerResource(
    'feature',
    'unspa://features',
    {
      title: 'Features index',
      description: 'List of all Unspaghettit features as a compact JSON index.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const summaries = await repo.list();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: json(summaries)
          }
        ]
      };
    }
  );

  server.registerResource(
    'metrics',
    'unspa://metrics',
    {
      title: 'Token cost ledger',
      description:
        'Per-tool token usage observed since this MCP server started. Used to validate the "MCP beats blob-in-prompt" thesis.',
      mimeType: 'application/json'
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: json({ totals: metrics.totals(), recent: metrics.recent(50) })
        }
      ]
    })
  );

  return server;
};

export const exportFeatureJson = exportFeatureToJson;
