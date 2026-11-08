import { z } from 'zod';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import { normalizeFeatureEmittedEvents } from '../../src/features/behavior-model/domain/services/FeatureEmittedEventsNormalizer';
import { introducedValidationErrors } from '../../src/features/behavior-model/domain/services/FeatureValidator';
import { loadFeaturesByIds } from '../../src/features/behavior-model/application/services/bulkRead';
import { asFeatureId } from '../../src/features/behavior-model/domain/value-objects/ids';
import { findOwningProject } from '../../src/features/projects/application/services/bulkRead';
import type { Project } from '../../src/features/projects/domain/entities/Project';
import { asProjectId } from '../../src/features/projects/domain/value-objects/ids';
import type { ProverLoad } from '../../src/features/prover/loadProver';
import type { ProverHost, ProverProject } from '../../src/features/prover/ProverPort';
import { replayingIdGenerator } from '../../src/shared/domain/IdGenerator';
import { trackTokens } from '../metrics';
import { applyOps } from './batch-ops/applyOps';
import type { Op } from './batch-ops/opHelpers';
import { applyProjectOps } from './projectBatch';
import { collectFeatureEntityIds, expandFeatureId } from './short-ids';
import { blankFeature } from './simulateSteps';
import { errorText, text, type ToolDeps } from './_shared';

const projectView = (project: Project): ProverProject => ({
  id: String(project.id),
  featureIds: project.featureIds.map(String),
  projectInvariants: project.projectInvariants ?? []
});

/** The engine's services a proof module's tools read the model and try changes through. */
export const proverHost = ({ repo, projectRepo, ids }: ToolDeps): ProverHost => ({
  features: {
    resolveId: (featureId) => expandFeatureId(repo, featureId),
    get: (featureId) => repo.get(asFeatureId(featureId)),
    loadMany: async (featureIds) =>
      (await loadFeaturesByIds(repo, featureIds.map(asFeatureId))).filter(
        (feature): feature is Feature => feature !== null
      ),
    blank: blankFeature,
    tryChange: (before, operations, mintedIds) => {
      try {
        const taken = collectFeatureEntityIds(before);
        const applied = applyOps(
          before,
          operations as unknown as readonly Op[],
          replayingIdGenerator(mintedIds ?? [], ids, (id) => taken.has(id))
        );
        const after = normalizeFeatureEmittedEvents(applied.next);
        const errors = introducedValidationErrors(normalizeFeatureEmittedEvents(before), after);
        return errors.length > 0 ? { ok: false, errors } : { ok: true, after };
      } catch (e) {
        return { ok: false, errors: [(e as Error).message] };
      }
    }
  },
  projects: {
    get: async (projectId) => {
      const project = await projectRepo.get(asProjectId(projectId));
      return project ? projectView(project) : null;
    },
    owning: async (featureId) => {
      const project = await findOwningProject(projectRepo, featureId).catch(() => null);
      return project ? projectView(project) : null;
    },
    tryChange: async (projectId, operations) => {
      const project = await projectRepo.get(asProjectId(projectId));
      if (!project) return { ok: false, errors: [`Project ${projectId} not found`] };
      const features = (await loadFeaturesByIds(repo, project.featureIds)).filter(
        (feature): feature is Feature => feature !== null
      );
      const result = applyProjectOps(project, features, operations as unknown as readonly Op[], ids);
      return result.ok
        ? { ok: true, projectInvariants: result.next.projectInvariants ?? [] }
        : { ok: false, errors: result.errors };
    }
  }
});

/**
 * The tools of the proof module, registered like the engine's own, and
 * `solver_status`. Only where a proof module was asked for (UNSPA_PROVER): an
 * engine without one offers no proof, what-if or solver tool at all.
 */
export const registerProverTools = (deps: ToolDeps, load: ProverLoad): void => {
  if (load.state === 'not-asked') return;
  const { server } = deps;

  server.registerTool(
    'solver_status',
    {
      description:
        "Which solver (Z3) this engine proves with, without proving anything: `kind` native (with its `version`), wasm (with the `reason` no native one runs) or none (with the `reason`: the installation turns the solver off, allows only the native one and none is installed, or the proof module did not load), and `prover`, the proof module's name and version. With none, every proof answers solver: unavailable.",
      inputSchema: {}
    },
    async () => {
      if (load.state === 'failed') {
        return text({ kind: 'none', reason: load.reason, prover: { name: load.module } });
      }
      const status = load.prover.status();
      return text({ ...status, prover: { name: load.prover.name, version: load.prover.version } });
    }
  );

  if (load.state !== 'loaded') return;
  for (const tool of load.prover.tools(proverHost(deps))) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema(z) },
      async (input: Record<string, unknown>) => {
        try {
          const answer = await tool.run(input);
          return 'error' in answer ? errorText(answer.error) : text(trackTokens(tool.name, answer.value));
        } catch (e) {
          return errorText(`${tool.name} failed: ${(e as Error).message}`);
        }
      }
    );
  }
};
