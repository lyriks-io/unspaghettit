<script lang="ts">
  import type { Resource } from '$features/behavior-model/domain/entities/Resource';
  import type { EventDefinition } from '$features/behavior-model/domain/entities/EventDefinition';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import type { Action } from '$features/behavior-model/domain/entities/Action';
  import {
    ruleCategoryLabel,
    type RuleCategory
  } from '$features/behavior-model/domain/value-objects/RuleCategory';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { editorStore } from '$features/behavior-model/presentation/stores/editorStore.svelte';
  import {
    addAction,
    moveActionBy,
    removeAction
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { newAction } from '$features/behavior-model/presentation/view-models/factories';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import ActionEditor from './ActionEditor.svelte';
  import { emit } from '$shared/events/eventBus';
  import { tourStore } from '$features/tutorial/presentation/stores/tourStore.svelte';
  import { evaluateTourSubmitGuard } from '$features/tutorial/domain/services/SubmitGuard';

  type AvailableSurface = { readonly id: Surface['id']; readonly name: string };

  type Props = {
    surface: Surface;
    resources: readonly Resource[];
    availableSurfaces?: readonly AvailableSurface[];
    availableEvents?: readonly EventDefinition[];
  };
  let { surface, resources, availableSurfaces = [], availableEvents = [] }: Props = $props();

  let nameDraft = $state('');
  let groupBy = $state<'none' | 'category'>('none');

  // Tutor-mode guard: blocks "Add action" submit until name matches the
  // tour's `requireExact.value`. Pure predicate from the domain layer.
  const tourGuard = $derived(
    evaluateTourSubmitGuard(tourStore.currentStep, 'add-action', nameDraft)
  );

  async function add() {
    const name = nameDraft.trim();
    if (name.length === 0) return;
    const action = newAction(cryptoIdGenerator, { name });
    await featureStore.mutate((current) => addAction(current, surface.id, action));
    editorStore.selectCapability(action.id);
    emit('editor.action.added', {
      surfaceId: String(surface.id),
      actionId: String(action.id),
      name
    });
    nameDraft = '';
  }

  async function remove(action: Action) {
    if (!confirm('Delete this action?')) return;
    await featureStore.mutate((current) => removeAction(current, surface.id, action.id));
  }

  async function move(action: Action, delta: -1 | 1) {
    await featureStore.mutate((current) =>
      moveActionBy(current, surface.id, action.id, delta)
    );
  }

  type GroupKey = RuleCategory | 'uncategorized';

  function dominantCategory(action: Action): GroupKey {
    if (action.rules.length === 0) return 'uncategorized';
    const counts = new Map<RuleCategory, number>();
    for (const rule of action.rules) {
      counts.set(rule.category, (counts.get(rule.category) ?? 0) + 1);
    }
    let best: RuleCategory | null = null;
    let bestCount = 0;
    for (const [cat, count] of counts) {
      if (count > bestCount) {
        best = cat;
        bestCount = count;
      }
    }
    return best ?? 'uncategorized';
  }

  function groupLabel(key: GroupKey): string {
    return key === 'uncategorized' ? 'Uncategorized' : ruleCategoryLabel(key);
  }

  const groups = $derived.by<Array<{ key: GroupKey; actions: Action[] }>>(() => {
    if (groupBy === 'none') return [];
    const byKey = new Map<GroupKey, Action[]>();
    for (const action of surface.actions) {
      const key = dominantCategory(action);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(action);
    }
    // Surface "uncategorized" last so reviewed groups appear first.
    return Array.from(byKey.entries())
      .sort(([a], [b]) => {
        if (a === 'uncategorized') return 1;
        if (b === 'uncategorized') return -1;
        return groupLabel(a).localeCompare(groupLabel(b));
      })
      .map(([key, actions]) => ({ key, actions }));
  });
</script>

<div class="space-y-3">
  <!-- Inline create. Action name is the primary handle; everything else
       (parameters, rules, effects) gets filled in by expanding the row. -->
  <form
    class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2"
    data-tour="add-action-form"
    onsubmit={(e) => {
      e.preventDefault();
      add();
    }}
  >
    <input
      type="text"
      bind:value={nameDraft}
      placeholder="Name a new action (e.g. Delete selection)"
      class="h-9 flex-1 rounded-md border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
    />
    <button
      type="submit"
      class="h-9 inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
      disabled={nameDraft.trim().length === 0 || tourGuard.blocked}
      title={tourGuard.blocked
        ? `Tutorial: name must be exactly "${tourGuard.requiredValue}"`
        : undefined}
    >
      <span class="text-base leading-none">+</span> Add action
    </button>
  </form>

  {#if surface.actions.length > 1}
    <div class="flex items-center gap-2 text-xs text-slate-600">
      <span class="text-slate-500">Group by:</span>
      <div class="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
        <button
          type="button"
          class="rounded px-2 py-0.5 transition {groupBy === 'none'
            ? 'bg-slate-900 text-white'
            : 'text-slate-600 hover:text-slate-900'}"
          onclick={() => (groupBy = 'none')}
        >
          None
        </button>
        <button
          type="button"
          class="rounded px-2 py-0.5 transition {groupBy === 'category'
            ? 'bg-slate-900 text-white'
            : 'text-slate-600 hover:text-slate-900'}"
          onclick={() => (groupBy = 'category')}
        >
          Rule category
        </button>
      </div>
    </div>
  {/if}

  {#if surface.actions.length === 0}
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50/30 p-6 text-center">
      <p class="text-sm font-medium text-slate-700">No actions yet</p>
      <p class="mx-auto mt-1 max-w-sm text-xs text-slate-500">
        An action is something the user or system can do on this surface. Add one above to get
        started, parameters, rules, and effects come next.
      </p>
    </div>
  {:else if groupBy === 'category'}
    <div class="space-y-4">
      {#each groups as group (group.key)}
        <section>
          <header class="mb-1 flex items-center gap-2">
            <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {groupLabel(group.key)}
            </span>
            <span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
              {group.actions.length}
            </span>
          </header>
          <ul class="space-y-2">
            {#each group.actions as action (action.id)}
              <li>
                <ActionEditor
                  {surface}
                  {action}
                  {resources}
                  {availableSurfaces}
                  {availableEvents}
                  expanded={editorStore.selectedCapabilityId === action.id}
                  onToggle={() =>
                    editorStore.selectCapability(
                      editorStore.selectedCapabilityId === action.id ? null : action.id
                    )}
                  onRemove={() => remove(action)}
                />
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {:else}
    <ul class="space-y-2">
      {#each surface.actions as action, index (action.id)}
        <li>
          <ActionEditor
            {surface}
            {action}
            {resources}
            {availableSurfaces}
            {availableEvents}
            expanded={editorStore.selectedCapabilityId === action.id}
            onToggle={() =>
              editorStore.selectCapability(
                editorStore.selectedCapabilityId === action.id ? null : action.id
              )}
            onRemove={() => remove(action)}
            onMoveUp={index > 0 ? () => move(action, -1) : undefined}
            onMoveDown={index < surface.actions.length - 1
              ? () => move(action, 1)
              : undefined}
          />
        </li>
      {/each}
    </ul>
  {/if}
</div>
