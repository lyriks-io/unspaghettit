import type {
  BuilderModeCoreFeature,
  BuilderModeDashboard,
  BuilderModeFeature,
  BuilderModeProject
} from '$features/builder-mode/domain/BuilderModeDashboard';
import { getBuilderModeDashboardUseCase } from '$features/builder-mode/application/use-cases/GetBuilderModeDashboard';
import { getBuilderModeProjectUseCase } from '$features/builder-mode/application/use-cases/GetBuilderModeProject';
import {
  clearActionEvolution,
  dismissActionEvolution
} from '$features/behavior-model/domain/services/FeatureTransforms';
import type { BuilderHost } from '$features/builder-mode/presentation/ports/BuilderHostPorts';
import { defaultBuilderHost } from '$features/builder-mode/infrastructure/adapters/defaultBuilderHost';
import type { Container } from '$shared/infrastructure/container';
import { asActionId, asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import type { QueueView } from '$features/implementation-queue/application/use-cases/ListQueue';
import type { SyncEvent } from '$lib/client/sync/syncEvents';
import type { TagColor } from '$shared/domain/TagPalette';
import {
  queueItemKey,
  type QueueItemId,
  type QueueTarget,
  type QueueTargetMetric
} from '$features/implementation-queue/domain/entities/QueueItem';
import {
  addTag as addTagToList,
  removeTag as removeTagFromList,
  renameTagInList,
  tagKey,
  type Tag
} from '$shared/domain/Tags';

const actionKey = (featureId: string, actionId: string): string =>
  `action:${featureId}:${actionId}`;

const featureKey = (featureId: string): string => `feature:${featureId}`;

const byRelevance = <T>(
  items: readonly T[],
  score: (item: T) => number
): readonly T[] =>
  items
    .map((item, index) => ({ item, index, score: score(item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);

class BuilderModeStore {
  // Host services are injected (dependency inversion): the store depends only
  // on the BuilderHost port, never on the app's concrete singletons. The
  // composition root at the bottom of this file wires the default adapter.
  constructor(private readonly host: BuilderHost) {}

  loading = $state(true);
  dashboard = $state<BuilderModeDashboard>({ projects: [] });
  // Explicit selection model: `null` means "no filter" (show the whole list,
  // detail pane prompts the user to pick). Selecting a project/core feature
  // filters to it; the UI floats it to the top of its list and pins it sticky.
  selectedProjectId = $state<string | null>(null);
  selectedCoreFeatureId = $state<string | null>(null);
  search = $state('');
  // Single active tag filter (mirrors the expert view's concept, pared down to
  // one toggle). Clicking a tag chip on a project / core feature narrows the
  // visible lists to items carrying it; clicking it again (or the clear pill)
  // removes the filter. Combined with search as an intersection.
  activeTag = $state<Tag | null>(null);
  error = $state<string | null>(null);

  // The active project's implementation queue (only meaningful while a project
  // is selected). Game-like "build queue" the user fills from suggestions.
  queue = $state<readonly QueueView[]>([]);
  queueError = $state<string | null>(null);

  // Action ids with an in-flight mutation (accept / dismiss). Drives a
  // per-suggestion spinner. Reassigned (not mutated in place) so the rune
  // reactivity fires.
  busyActions = $state<ReadonlySet<string>>(new Set());

  isBusy(actionId: string): boolean {
    return this.busyActions.has(actionId);
  }

  private setBusy(actionId: string, busy: boolean): void {
    const next = new Set(this.busyActions);
    if (busy) next.add(actionId);
    else next.delete(actionId);
    this.busyActions = next;
  }

  selectedProject = $derived<BuilderModeProject | null>(
    this.dashboard.projects.find((project) => project.id === this.selectedProjectId) ?? null
  );

  selectedCoreFeature = $derived<BuilderModeCoreFeature | null>(
    this.selectedProject?.coreFeatures.find(
      (coreFeature) => coreFeature.id === this.selectedCoreFeatureId
    ) ?? null
  );

  searchQuery = $derived(this.search.trim().toLowerCase());

  searchActive = $derived(this.searchQuery.length > 0);

  activeTagKey = $derived(this.activeTag ? tagKey(this.activeTag) : null);

  tagActive = $derived(this.activeTag !== null);

  /** Every distinct tag type in the dashboard, for palette color registration. */
  allTagTypes = $derived.by<readonly string[]>(() => {
    const types = new Set<string>();
    for (const project of this.dashboard.projects) {
      for (const tag of project.tags) types.add(tag.type);
      for (const coreFeature of project.coreFeatures) {
        for (const tag of coreFeature.tags) types.add(tag.type);
      }
    }
    return [...types];
  });

  filteredProjects = $derived.by<readonly BuilderModeProject[]>(() => {
    let list = this.dashboard.projects;
    const tag = this.activeTagKey;
    if (tag) list = list.filter((project) => this.projectMatchesTag(project, tag));
    const q = this.searchQuery;
    if (!q) return list;
    return byRelevance(list, (project) => this.projectScore(project, q));
  });

  // A project matches a tag when it carries the tag itself OR contains a core
  // feature that does — so filtering from any chip keeps the relevant projects.
  private projectMatchesTag(project: BuilderModeProject, key: string): boolean {
    return (
      project.tags.some((tag) => tagKey(tag) === key) ||
      project.coreFeatures.some((coreFeature) =>
        coreFeature.tags.some((tag) => tagKey(tag) === key)
      )
    );
  }

  // A core feature matches when it carries the tag, or the whole project does
  // (a project-level tag implicitly applies to all of its core features).
  private coreFeatureMatchesTag(
    coreFeature: BuilderModeCoreFeature,
    project: BuilderModeProject,
    key: string
  ): boolean {
    return (
      project.tags.some((tag) => tagKey(tag) === key) ||
      coreFeature.tags.some((tag) => tagKey(tag) === key)
    );
  }

  toggleTag(tag: Tag): void {
    this.activeTag = this.activeTagKey === tagKey(tag) ? null : tag;
  }

  clearTag(): void {
    this.activeTag = null;
  }

  isActiveTag(tag: Tag): boolean {
    return this.activeTagKey === tagKey(tag);
  }

  // ── Host service pass-throughs ─────────────────────────────────────────────
  // Components read these off the view's store rather than importing the app's
  // tag-palette / sync singletons directly, so the whole view depends only on
  // the injected host.

  refreshTagPalette(): Promise<void> {
    return this.host.tags.refresh();
  }

  registerTagTypes(types: readonly string[]): void {
    this.host.tags.registerTypes(types);
  }

  colorForTag(tag: Tag): TagColor | null {
    return this.host.tags.colorForTag(tag);
  }

  subscribeSync(handler: (event: SyncEvent) => void): () => void {
    return this.host.sync.subscribe(handler);
  }

  // ── Tag editing ────────────────────────────────────────────────────────────
  // Add / remove operate on a single entity; rename propagates across every
  // project and feature that uses the tag (same `type:value` identity), via the
  // shared RenameTag use case behind the palette store. After each mutation we
  // re-read and drop the active filter if it no longer matches anything.

  async addProjectTag(projectId: string, tag: Tag): Promise<void> {
    await this.mutateTags(projectId, async (container) => {
      const project = await container.useCases.getProject(asProjectId(projectId));
      if (!project) return;
      await container.useCases.saveProject({ ...project, tags: addTagToList(project.tags, tag) });
    });
  }

  async removeProjectTag(projectId: string, tag: Tag): Promise<void> {
    await this.mutateTags(projectId, async (container) => {
      const project = await container.useCases.getProject(asProjectId(projectId));
      if (!project) return;
      await container.useCases.saveProject({
        ...project,
        tags: removeTagFromList(project.tags, tag)
      });
    });
  }

  async addCoreFeatureTag(featureId: string, tag: Tag): Promise<void> {
    await this.mutateTags(this.selectedProjectId, async (container) => {
      const feature = await container.useCases.getFeature(asFeatureId(featureId));
      if (!feature) return;
      await container.useCases.saveFeature({ ...feature, tags: addTagToList(feature.tags, tag) });
    });
  }

  async removeCoreFeatureTag(featureId: string, tag: Tag): Promise<void> {
    await this.mutateTags(this.selectedProjectId, async (container) => {
      const feature = await container.useCases.getFeature(asFeatureId(featureId));
      if (!feature) return;
      await container.useCases.saveFeature({
        ...feature,
        tags: removeTagFromList(feature.tags, tag)
      });
    });
  }

  /** Rename a tag everywhere it's used and follow the filter onto the new name. */
  async renameTag(from: Tag, to: Tag): Promise<void> {
    if (tagKey(from) === tagKey(to)) return;
    // Update every card in place immediately so the new value shows at once —
    // a full re-read spans the whole hub and took seconds. Persistence and a
    // reconciling re-read run in the background.
    this.dashboard = {
      ...this.dashboard,
      projects: this.dashboard.projects.map((project) => ({
        ...project,
        tags: renameTagInList(project.tags, from, to) ?? [],
        coreFeatures: project.coreFeatures.map((coreFeature) => ({
          ...coreFeature,
          tags: renameTagInList(coreFeature.tags, from, to) ?? []
        }))
      }))
    };
    if (this.activeTagKey === tagKey(from)) this.activeTag = to;
    try {
      await this.host.tags.renameTag(from, to);
      void this.refreshSilent().then(() => this.reconcileActiveTag());
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  private async mutateTags(
    projectId: string | null,
    op: (container: Container) => Promise<void>
  ): Promise<void> {
    try {
      const container = await this.host.data.getContainer();
      await op(container);
      // Re-read ONLY the affected project (add/remove touches a single project
      // or feature). A full dashboard rebuild here cost multiple seconds on
      // large hubs. Rename still does a full refresh — it spans every project.
      if (projectId) await this.refreshProject(projectId);
      else await this.refreshSilent();
      this.reconcileActiveTag();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  /** Drop the active tag filter once nothing carries it anymore. */
  private reconcileActiveTag(): void {
    const key = this.activeTagKey;
    if (!key) return;
    if (!this.dashboard.projects.some((project) => this.projectMatchesTag(project, key))) {
      this.activeTag = null;
    }
  }

  /** Same filter semantics as projects: only the selected core feature shows. */
  visibleCoreFeatures = $derived.by<readonly BuilderModeCoreFeature[]>(() => {
    const project = this.selectedProject;
    const selected = this.selectedCoreFeature;
    let visible = selected ? [selected] : project?.coreFeatures ?? [];
    const tag = this.activeTagKey;
    if (tag && project && !selected) {
      visible = visible.filter((coreFeature) =>
        this.coreFeatureMatchesTag(coreFeature, project, tag)
      );
    }
    const q = this.searchQuery;
    if (!q) return visible;
    if (project && this.matchesText(q, project.name, project.description)) {
      return visible;
    }
    return byRelevance(visible, (coreFeature) => this.coreFeatureScore(coreFeature, q));
  });

  visibleSelectedFeatures = $derived.by<readonly BuilderModeFeature[]>(() => {
    const coreFeature = this.selectedCoreFeature;
    if (!coreFeature) return [];
    const q = this.searchQuery;
    if (!q || this.matchesText(q, coreFeature.name, coreFeature.description)) {
      return coreFeature.features;
    }
    return byRelevance(coreFeature.features, (feature) => this.featureScore(feature, q));
  });

  setSearch(query: string): void {
    this.search = query;
  }

  clearSearch(): void {
    this.search = '';
  }

  private matchesText(query: string, ...values: readonly string[]): boolean {
    return values.some((value) => value.toLowerCase().includes(query));
  }

  private textScore(query: string, value: string, weight: number): number {
    const text = value.toLowerCase();
    if (!text.includes(query)) return 0;
    if (text === query) return weight * 5;
    if (text.startsWith(query)) return weight * 4;
    if (text.split(/\s+/).some((word) => word.startsWith(query))) return weight * 3;
    return weight;
  }

  private featureScore(feature: BuilderModeFeature, query: string): number {
    return Math.max(
      this.textScore(query, feature.name, 100),
      this.textScore(query, feature.description, 35),
      ...feature.suggestions.map((suggestion) => this.textScore(query, suggestion.text, 20))
    );
  }

  private tagScore(tags: readonly Tag[], query: string, weight: number): number {
    if (tags.length === 0) return 0;
    return Math.max(
      ...tags.map((tag) =>
        Math.max(this.textScore(query, tag.value, weight), this.textScore(query, tag.type, weight * 0.5))
      )
    );
  }

  private coreFeatureScore(coreFeature: BuilderModeCoreFeature, query: string): number {
    return Math.max(
      this.textScore(query, coreFeature.name, 95),
      this.textScore(query, coreFeature.description, 32),
      this.tagScore(coreFeature.tags, query, 60),
      ...coreFeature.suggestions.map((suggestion) => this.textScore(query, suggestion.text, 24)),
      ...coreFeature.features.map((feature) => this.featureScore(feature, query) * 0.75)
    );
  }

  private projectScore(project: BuilderModeProject, query: string): number {
    return Math.max(
      this.textScore(query, project.name, 120),
      this.textScore(query, project.description, 40),
      this.tagScore(project.tags, query, 70),
      ...project.coreFeatures.map((coreFeature) => this.coreFeatureScore(coreFeature, query) * 0.8)
    );
  }

  async refresh(): Promise<void> {
    this.loading = true;
    await this.refreshSilent();
    this.loading = false;
  }

  async refreshSilent(): Promise<void> {
    try {
      const container = await this.host.data.getContainer();
      const loadDashboard = getBuilderModeDashboardUseCase({
        projects: container.projectRepository,
        features: container.repository,
        statuses: container.statusRepository
      });
      this.dashboard = await loadDashboard();
      if (
        this.selectedProjectId &&
        !this.dashboard.projects.some((project) => project.id === this.selectedProjectId)
      ) {
        this.selectedProjectId = null;
        this.selectedCoreFeatureId = null;
      }
      this.error = null;
      await this.refreshQueue();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  selectProject(id: string): void {
    this.selectedProjectId = id;
    this.selectedCoreFeatureId = null;
    void this.refreshQueue();
  }

  /** Cancel the project filter. */
  deselectProject(): void {
    this.selectedProjectId = null;
    this.selectedCoreFeatureId = null;
    this.queue = [];
  }

  /** Toggle a core feature filter (click the selected one again to clear). */
  selectCoreFeature(id: string): void {
    this.selectedCoreFeatureId = this.selectedCoreFeatureId === id ? null : id;
  }

  deselectCoreFeature(): void {
    this.selectedCoreFeatureId = null;
  }

  // ── Build queue ──────────────────────────────────────────────────────────

  async refreshQueue(): Promise<void> {
    const projectId = this.selectedProjectId;
    if (!projectId) {
      this.queue = [];
      return;
    }
    try {
      const container = await this.host.data.getContainer();
      this.queue = await container.useCases.listQueue(asProjectId(projectId));
      this.queueError = null;
    } catch (e) {
      this.queueError = (e as Error).message;
    }
  }

  isQueued(featureId: string, actionId: string): boolean {
    const key = actionKey(featureId, actionId);
    return this.queue.some((view) => queueItemKey(view.item) === key);
  }

  /** 1-based build-queue position of a queued action, or null when not queued. */
  queuePositionForAction(featureId: string, actionId: string): number | null {
    return this.queuePosition(actionKey(featureId, actionId));
  }

  private queuePosition(key: string): number | null {
    const idx = this.queue.findIndex((view) => queueItemKey(view.item) === key);
    return idx < 0 ? null : idx + 1;
  }

  private queueItemIdForAction(featureId: string, actionId: string): QueueItemId | null {
    const key = actionKey(featureId, actionId);
    return this.queue.find((view) => queueItemKey(view.item) === key)?.item.id ?? null;
  }

  /** Add the action to the queue, or remove it if already queued. */
  async toggleAction(featureId: string, actionId: string): Promise<void> {
    const projectId = this.selectedProjectId;
    if (!projectId) return;
    const existing = this.queueItemIdForAction(featureId, actionId);
    await this.mutateQueue(async (container) => {
      if (existing) {
        await container.useCases.dequeueQueueItem(asProjectId(projectId), existing);
      } else {
        await container.useCases.enqueueQueueItem(asProjectId(projectId), {
          kind: 'action',
          featureId: asFeatureId(featureId),
          actionId: asActionId(actionId)
        });
      }
    });
  }

  /**
   * True when the WHOLE feature is queued (a `kind:'feature'` entry). This is
   * independent of any per-action entries for the same feature: queueing the
   * feature means "implement whatever is still missing", while per-action
   * entries target just a part. Both granularities can coexist.
   */
  isFeatureQueued(featureId: string): boolean {
    const key = featureKey(featureId);
    return this.queue.some((view) => queueItemKey(view.item) === key);
  }

  /** 1-based build-queue position of a queued whole-feature entry, or null. */
  queuePositionForFeature(featureId: string): number | null {
    return this.queuePosition(featureKey(featureId));
  }

  private queueItemIdForFeature(featureId: string): QueueItemId | null {
    const key = featureKey(featureId);
    return this.queue.find((view) => queueItemKey(view.item) === key)?.item.id ?? null;
  }

  /**
   * Queue the whole feature for implementation, or remove it if already queued.
   * A `feature`-kind queue item is a pointer at the entire feature; the build
   * step resolves "what's missing" (possibly everything, possibly just a few
   * unimplemented actions) at implementation time.
   */
  async toggleFeature(featureId: string): Promise<void> {
    const projectId = this.selectedProjectId;
    if (!projectId) return;
    const existing = this.queueItemIdForFeature(featureId);
    await this.mutateQueue(async (container) => {
      if (existing) {
        await container.useCases.dequeueQueueItem(asProjectId(projectId), existing);
      } else {
        await container.useCases.enqueueQueueItem(asProjectId(projectId), {
          kind: 'feature',
          featureId: asFeatureId(featureId)
        });
      }
    });
  }

  async dequeue(itemId: QueueItemId): Promise<void> {
    const projectId = this.selectedProjectId;
    if (!projectId) return;
    await this.mutateQueue(async (container) => {
      await container.useCases.dequeueQueueItem(asProjectId(projectId), itemId);
    });
  }

  /**
   * Set (or clear, with `undefined`) the implementation goal on a queued item.
   * The target rides along to the LLM via the MCP queue tools, so "implement
   * this feature to half maturity" is something the user can pin in the queue
   * and the assistant reads back.
   */
  async setQueueTarget(itemId: QueueItemId, target: QueueTarget | undefined): Promise<void> {
    const projectId = this.selectedProjectId;
    if (!projectId) return;
    await this.mutateQueue(async (container) => {
      await container.useCases.setQueueItemTarget(asProjectId(projectId), itemId, target);
    });
  }

  /**
   * The current score (0–100) of a queued item for the given metric — where the
   * goal progress bar starts filled. Resolved from the live dashboard: a whole
   * feature reads its core-feature score, an action reads its own. Unknown /
   * orphaned targets read 0.
   */
  currentScoreFor(view: QueueView, metric: QueueTargetMetric): number {
    const project = this.selectedProject;
    if (!project) return 0;
    const coreFeature = project.coreFeatures.find(
      (cf) => cf.id === String(view.item.featureId)
    );
    if (!coreFeature) return 0;
    const pick = (maturity: number, implementation: number | null): number =>
      metric === 'maturity' ? maturity : (implementation ?? 0);
    if (view.item.kind === 'action') {
      const actionId = String(view.item.actionId);
      const feature = coreFeature.features.find((f) => f.id === actionId);
      return feature ? pick(feature.maturityPercentage, feature.implementationPercentage) : 0;
    }
    // 'feature' (whole core feature) and any other kind fall back to the core score.
    return pick(coreFeature.maturityPercentage, coreFeature.implementationPercentage);
  }

  /**
   * Dismiss a suggestion: mark its Evolution `dismissed` (via the domain
   * transform + diff-aware mutateFeature use case) instead of deleting it. The
   * proposal stays in the spec as a tombstone so the assistant won't re-suggest
   * it and can propose something else, but it's hidden from the user's list. We
   * also drop it from the queue if present. Only the affected project is
   * re-read afterwards, not the whole dashboard.
   */
  async dismissSuggestion(featureId: string, actionId: string): Promise<void> {
    const projectId = this.selectedProjectId;
    this.setBusy(actionId, true);
    try {
      const container = await this.host.data.getContainer();
      if (projectId && this.isQueued(featureId, actionId)) {
        const itemId = this.queueItemIdForAction(featureId, actionId);
        if (itemId) await container.useCases.dequeueQueueItem(asProjectId(projectId), itemId);
      }
      await container.useCases.mutateFeature({
        featureId: asFeatureId(featureId),
        transform: (feature) => dismissActionEvolution(feature, asActionId(actionId))
      });
      await this.refreshSelectedProject();
      await this.refreshQueue();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.setBusy(actionId, false);
    }
  }

  /**
   * Queue a suggestion: accept the Evolution (clear its marker so it becomes a
   * committed feature) AND add it to the build queue. The proposal then leaves
   * the suggestions list and shows up as a real feature. Only the affected
   * project is re-read afterwards.
   */
  async acceptSuggestion(featureId: string, actionId: string): Promise<void> {
    const projectId = this.selectedProjectId;
    this.setBusy(actionId, true);
    try {
      const container = await this.host.data.getContainer();
      await container.useCases.mutateFeature({
        featureId: asFeatureId(featureId),
        transform: (feature) => clearActionEvolution(feature, asActionId(actionId))
      });
      if (projectId && !this.isQueued(featureId, actionId)) {
        await container.useCases.enqueueQueueItem(asProjectId(projectId), {
          kind: 'action',
          featureId: asFeatureId(featureId),
          actionId: asActionId(actionId)
        });
      }
      await this.refreshSelectedProject();
      await this.refreshQueue();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.setBusy(actionId, false);
    }
  }

  /**
   * Rebuild ONE project in place (scoped use case) instead of re-reading and
   * re-scoring every project. Keeps post-mutation refreshes O(features in one
   * project) rather than O(all features) — the difference between snappy and
   * multi-second on large hubs.
   */
  async refreshProject(projectId: string): Promise<void> {
    const container = await this.host.data.getContainer();
    const loadProject = getBuilderModeProjectUseCase({
      projects: container.projectRepository,
      features: container.repository,
      statuses: container.statusRepository
    });
    const updated = await loadProject(asProjectId(projectId));
    if (!updated) return;
    this.dashboard = {
      ...this.dashboard,
      projects: this.dashboard.projects.map((project) =>
        project.id === updated.id ? updated : project
      )
    };
  }

  async refreshSelectedProject(): Promise<void> {
    if (this.selectedProjectId) await this.refreshProject(this.selectedProjectId);
  }

  /** Drag-and-drop reorder: drop `itemId` at absolute position `targetIndex`. */
  async moveQueueTo(itemId: QueueItemId, targetIndex: number): Promise<void> {
    const projectId = this.selectedProjectId;
    if (!projectId) return;
    await this.mutateQueue(async (container) => {
      await container.useCases.moveQueueItem(asProjectId(projectId), itemId, {
        kind: 'to',
        targetIndex
      });
    });
  }

  private async mutateQueue(
    op: (container: Container) => Promise<void>
  ): Promise<void> {
    try {
      const container = await this.host.data.getContainer();
      await op(container);
      await this.refreshQueue();
    } catch (e) {
      this.queueError = (e as Error).message;
    }
  }
}

export const builderModeStore = new BuilderModeStore(defaultBuilderHost);
