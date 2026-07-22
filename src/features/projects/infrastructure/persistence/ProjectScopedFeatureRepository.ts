import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type {
  FeatureRepository,
  FeatureSummary
} from '$features/behavior-model/application/ports/FeatureRepository';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { ProjectRepository } from '../../application/ports/ProjectRepository';
import type { Project } from '../../domain/entities/Project';
import { resolveLibraryRefs, stripLibraryRefs } from '../../domain/services/projectLibrary';

/**
 * The seam that makes project-scoped references invisible to everything
 * downstream: it RESOLVES `feature.entityRefs` / `.resourceRefs` /
 * `.personaRefs` against the owning project's canonical library on the way out,
 * and STRIPS them back to refs on the way in.
 *
 * Wrapping the repository (rather than teaching each consumer about references)
 * is what keeps the change small and total at the same time. `verify`,
 * `model_check`, `run_all_scenarios`, `score_feature`, the digests, the graph
 * projections, and the dashboard all read `feature.entities` and keep doing
 * exactly that — they just see a feature whose referenced definitions are
 * already there.
 *
 * Failure mode by design: a project that can't be loaded, or a ref that
 * resolves to nothing, degrades ONE feature (its refs stay unresolved and the
 * validator reports them with a prescriptive message). It never fails a list
 * query, because a whole-batch failure is exactly the silent-eviction class of
 * bug this release is closing.
 */
export class ProjectScopedFeatureRepository implements FeatureRepository {
  /**
   * Feature id → owning project id, memoized for a short window.
   *
   * The window exists for bursts: `list_features` followed by a `get` per
   * feature would otherwise rescan every project file each time. It is
   * deliberately small, and a MISS forces a rebuild (`invalidate` on save /
   * delete plus the miss path means a feature newly added to a project resolves
   * on the very next read, without the decorator having to observe project
   * writes it doesn't own).
   */
  static readonly MEMBERSHIP_TTL_MS = 2000;
  #membership: Map<string, string> | null = null;
  #membershipAt = 0;

  constructor(
    private readonly inner: FeatureRepository,
    private readonly projects: ProjectRepository,
    private readonly now: () => number = Date.now
  ) {}

  /** Forget the cached feature→project map (project membership may have changed). */
  invalidate(): void {
    this.#membership = null;
  }

  async #membershipMap(force: boolean): Promise<ReadonlyMap<string, string>> {
    const fresh =
      this.#membership !== null &&
      this.now() - this.#membershipAt < ProjectScopedFeatureRepository.MEMBERSHIP_TTL_MS;
    if (fresh && !force) return this.#membership!;
    const map = new Map<string, string>();
    try {
      for (const summary of await this.projects.list()) {
        const project = await this.projects.get(summary.id);
        if (!project) continue;
        for (const featureId of project.featureIds) map.set(String(featureId), String(project.id));
      }
    } catch {
      // A broken project file must not take the feature list down with it.
      // Unresolved refs surface per-feature instead.
    }
    this.#membership = map;
    this.#membershipAt = this.now();
    return map;
  }

  async #projectFor(featureId: string): Promise<Project | null> {
    let projectId = (await this.#membershipMap(false)).get(featureId);
    // A miss may just mean the map predates an `add_feature_to_project`, which
    // goes through the project repository and never reaches this decorator.
    if (!projectId) projectId = (await this.#membershipMap(true)).get(featureId);
    if (!projectId) return null;
    try {
      return await this.projects.get(projectId as Project['id']);
    } catch {
      return null;
    }
  }

  list(): Promise<readonly FeatureSummary[]> {
    // Summaries carry counts and tags only — nothing the library contributes —
    // so there is no reason to pay for project loads here.
    return this.inner.list();
  }

  async get(id: FeatureId): Promise<Feature | null> {
    const feature = await this.inner.get(id);
    if (!feature) return null;
    const project = await this.#projectFor(String(id));
    return resolveLibraryRefs(feature, project);
  }

  async save(feature: Feature): Promise<void> {
    const project = await this.#projectFor(String(feature.id));
    const { feature: stripped, project: updatedProject } = stripLibraryRefs(feature, project);
    // Library first: if the feature write fails, the canonical definition is
    // still consistent with what the author edited. The reverse order could
    // leave a feature referencing a definition that never got its update.
    if (updatedProject) await this.projects.save(updatedProject);
    await this.inner.save(stripped);
    this.invalidate();
  }

  async delete(id: FeatureId): Promise<void> {
    await this.inner.delete(id);
    this.invalidate();
  }
}

/**
 * Wrap a feature repository so project-library references resolve. Returns the
 * repository unchanged when there is no project repository to resolve against,
 * so call sites can apply it unconditionally.
 */
export const withProjectLibrary = (
  features: FeatureRepository,
  projects: ProjectRepository | undefined | null
): FeatureRepository =>
  projects ? new ProjectScopedFeatureRepository(features, projects) : features;
