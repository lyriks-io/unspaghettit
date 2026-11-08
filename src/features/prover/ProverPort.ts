import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { ParameterValues } from '$features/behavior-model/domain/services/ParameterValidator';
import type { ScenarioRunResult } from '$features/simulator/application/use-cases/RunScenarios';
import type { ExplorationReport } from '$features/simulator/domain/StateExplorer';
import type { VerdictCheck } from '$features/verification/domain/VerificationVerdict';
import type { VerificationThresholds } from '$features/verification/domain/VerificationThresholds';
import type { ReportLanguage } from '$shared/language';
import type { ZodRawShape, z } from 'zod';
import type { ProverKernel } from './kernel';

/**
 * The port through which the engine asks a proof module, and everything the
 * module answers, in the engine's own words. The engine holds no solver: proof
 * is a module of its own (the Enterprise edition's), loaded at start when
 * UNSPA_PROVER names it (loadProver.ts). Without one, the engine proves
 * nothing and says nothing about proofs. A change to any shape here is a
 * change of KERNEL_API (kernel.ts).
 */

/** What a proof is asked about: the project around the feature. */
export type ProofContext = {
  /** Every feature of the project, the proved one included: a path may play their actions. */
  readonly projectFeatures: readonly Feature[];
  readonly projectInvariants?: readonly Invariant[];
  /** How many steps from the start the searches look. */
  readonly maxSteps?: number;
};

/** The inputs the solver chose for each action (by action id), one set per branch it witnessed. */
export type WitnessedInputs = ReadonlyMap<string, readonly ParameterValues[]>;

/** The checks a proof gives a feature's verdict, beside the engine's own. */
export type ProofVerdictChecks = {
  /** The exploration as the solver's reach completes it: a goal or an action reached on a replayed path is not unmet or dead. */
  readonly exploration?: ExplorationReport;
  /** Where the exploration ran: the invariants check reading both searches, in place of the engine's. */
  readonly invariants?: VerdictCheck;
  /** Where the exploration did not run: the solver's own searches from the start. */
  readonly searches: readonly VerdictCheck[];
  /** Proven flaws and what was left unproven, closing the verdict. */
  readonly closing: readonly VerdictCheck[];
};

/** The proof of one feature as the verdict of `verify` reads it. */
export type VerdictProof = {
  /** The solver ran on the feature: its searches stand in the verdict. */
  readonly ran: boolean;
  readonly provenViolations: number;
  /** Questions left unsettled within the time budget. */
  readonly unsettled: number;
  readonly witnessedInputs: WitnessedInputs;
  /** Whether the bounded exploration still has something to settle, and why: said in the verdict, never guessed. */
  readonly explorationPlan: { readonly run: boolean; readonly reasons: readonly string[] };
  checks(input: {
    readonly exploration?: ExplorationReport;
    readonly thresholds: VerificationThresholds;
  }): ProofVerdictChecks;
};

/** A gap get_spec_gaps lists, the same shape as the engine's own. */
export type ProverGap = {
  readonly code: string;
  readonly severity: 'critical' | 'recommended';
  readonly entityType: 'feature' | 'surface' | 'action' | 'criterion';
  readonly entityId: string;
  readonly entityName: string;
  readonly subjectId?: string;
  readonly reason: string;
  readonly suggestedFix: string;
};

/** What a proof adds to get_spec_gaps: its gaps, and the proof itself as data. */
export type SpecGapsProof = {
  readonly gaps: readonly ProverGap[];
  readonly proof: Readonly<Record<string, unknown>>;
};

/** What a proof adds to an exploration (model_check, simulate_steps): the inputs to try first, and what it proved. */
export type ExplorationAid = {
  readonly witnessedInputs: WitnessedInputs;
  readonly readout: unknown;
  readonly solverInputs: unknown;
};

/** Which solver the module proves with, read without proving anything. */
export type ProverStatus =
  | { readonly kind: 'native'; readonly version: string }
  | { readonly kind: 'wasm' | 'none'; readonly reason: string };

/** A change applied in memory and validated like a batch; nothing is saved. */
export type TriedChange<T> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly errors: readonly unknown[] };

export type ProverProject = {
  readonly id: string;
  readonly featureIds: readonly string[];
  readonly projectInvariants: readonly Invariant[];
};

/** The engine's services a module's own tools use: reading the model, and trying a change without saving it. */
export type ProverHost = {
  readonly features: {
    /** A full id from a full or short one; throws a sentence naming what is wrong. */
    resolveId(featureId: string): Promise<string>;
    get(featureId: string): Promise<Feature | null>;
    /** The features that exist among these ids, in their order. */
    loadMany(featureIds: readonly string[]): Promise<readonly Feature[]>;
    /** An empty feature, to compare a feature the change creates with. */
    blank(featureId: string, name: string): Feature;
    /** The feature as `operations` (the apply_batch vocabulary) would leave it; `mintedIds` replays a stored model's ids. */
    tryChange(
      before: Feature,
      operations: readonly Readonly<Record<string, unknown>>[],
      mintedIds?: readonly string[]
    ): TriedChange<{ readonly after: Feature }>;
  };
  readonly projects: {
    get(projectId: string): Promise<ProverProject | null>;
    owning(featureId: string): Promise<ProverProject | null>;
    /** The project rules as `operations` (the apply_project_batch vocabulary) would leave them. */
    tryChange(
      projectId: string,
      operations: readonly Readonly<Record<string, unknown>>[]
    ): Promise<TriedChange<{ readonly projectInvariants: readonly Invariant[] }>>;
  };
};

/** What a module's tool answers: a value the engine sends as JSON, or an error sentence. */
export type ProverToolAnswer = { readonly value: unknown } | { readonly error: string };

/** A tool a module offers; the engine registers it like its own, with its own zod. */
export type ProverTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: (zod: typeof z) => ZodRawShape;
  readonly run: (input: Record<string, unknown>) => Promise<ProverToolAnswer>;
};

/** What the engine hands a module when it loads it. */
export type ProverAttachment = {
  readonly kernel: ProverKernel;
  /** The module exporting `proverKernel`, for the processes the module starts. */
  readonly kernelEntry: string;
  /** Required first in those processes: what loads the engine's TypeScript and its aliases. */
  readonly runtimeEntry: string;
  readonly engineVersion: string;
  /** A hash of the engine code a proof depends on (the model and the simulator): a proof stored under other code is never read back. */
  readonly engineFingerprint: string;
};

/** The engine's own tools a proof adds to. */
export type ProvedTool = 'get_spec_gaps' | 'verify' | 'model_check' | 'simulate_steps';

/** A proof module, as loaded from UNSPA_PROVER. */
export type Prover = {
  readonly name: string;
  readonly version: string;
  /** The KERNEL_API it was built against: the engine refuses another one. */
  readonly kernelApi: number;
  /** What it adds to the description of the engine's tools it serves (get_spec_gaps, verify, model_check, simulate_steps). */
  readonly toolNotes?: Readonly<Partial<Record<ProvedTool, string>>>;
  /** Called once, before anything else. */
  attach(engine: ProverAttachment): void;
  /** Keep proofs on disk in `dir` (null: in memory only). */
  storeProofsIn(dir: string | null): void;
  status(): ProverStatus;
  /** For `verify` and `unspa check`: the first pass answers within a page's budget, the full proof settles what it left open. */
  verdictProof(
    feature: Feature,
    context: ProofContext & { readonly depth: 'first-pass' | 'full' }
  ): Promise<VerdictProof>;
  specGaps(
    feature: Feature,
    context: ProofContext & {
      readonly complete: boolean;
      readonly language: ReportLanguage;
      /** The feature's authored scenarios, already run. */
      readonly scenarioRuns: readonly ScenarioRunResult[];
    }
  ): Promise<SpecGapsProof>;
  explorationAid(feature: Feature, context: ProofContext): Promise<ExplorationAid>;
  /** Its own tools (what-if, project rules...), registered only while it is loaded. */
  tools(host: ProverHost): readonly ProverTool[];
  /** Stop the processes it started, so a command can end. */
  shutdown(): void;
};
