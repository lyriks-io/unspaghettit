<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import {
    rollupActions,
    type ActionCatalogEntry
  } from '$features/behavior-model/domain/services/ActionRollup';

  type Props = { features: readonly Feature[]; search: string };
  let { features, search }: Props = $props();

  const rollup = $derived(rollupActions(features));
  const query = $derived(search.trim().toLowerCase());
  const actions = $derived(
    query.length === 0
      ? rollup.actions
      : rollup.actions.filter((action) =>
          [
            action.actionName,
            action.intent,
            action.featureName,
            action.surfaceName,
            ...action.roles,
            ...action.references.statePaths,
            ...action.references.events,
            ...action.references.parameterNames,
            ...action.references.effectTypes
          ].some((value) => value.toLowerCase().includes(query))
        )
  );

  type FeatureGroup = {
    featureId: string;
    featureName: string;
    actions: ActionCatalogEntry[];
  };

  // Collapse the flat cross-feature list into one card per feature. `rollup`
  // already emits actions in feature order, so the Map's insertion order keeps
  // the project's own feature ordering instead of re-sorting.
  const featureGroups = $derived.by(() => {
    const map = new Map<string, FeatureGroup>();
    for (const action of actions) {
      const key = String(action.featureId);
      let group = map.get(key);
      if (!group) {
        group = { featureId: key, featureName: action.featureName, actions: [] };
        map.set(key, group);
      }
      group.actions.push(action);
    }
    return [...map.values()];
  });
  const reusableConcepts = $derived(
    rollup.concepts.filter(
      (concept) =>
        concept.occurrences > 1 &&
        (query.length === 0 ||
          concept.value.toLowerCase().includes(query) ||
          concept.kind.includes(query))
    )
  );
</script>

<div class="space-y-4">
  {#if reusableConcepts.length > 0}
    <section class="rounded-lg border border-hairline bg-white p-4">
      <div class="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 class="text-sm font-semibold text-slate-950">Reusable action concepts</h2>
          <p class="mt-0.5 text-xs text-slate-500">
            References repeated by actions. Cross-feature concepts are candidates for canonical
            project definitions.
          </p>
        </div>
        <span class="text-xs text-slate-500">{reusableConcepts.length} reused</span>
      </div>
      <div class="flex flex-wrap gap-2">
        {#each reusableConcepts as concept (`${concept.kind}:${concept.value}`)}
          <span
            class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs {concept.crossFeature
              ? 'border-cyan-200 bg-cyan-50 text-brand-800'
              : 'border-slate-200 bg-slate-50 text-slate-700'}"
            title={`${concept.occurrences} action references across ${concept.featureIds.length} feature(s)`}
          >
            <span class="text-[9px] font-semibold uppercase text-slate-500"
              >{concept.kind.replace('_', ' ')}</span
            >
            <span class="font-mono">{concept.value}</span>
            <span class="rounded-full bg-white px-1.5 tabular-nums">{concept.occurrences}</span>
          </span>
        {/each}
      </div>
    </section>
  {/if}

  {#if actions.length === 0}
    <p
      class="rounded-lg border border-dashed border-hairline bg-white p-6 text-center text-sm text-slate-500"
    >
      {rollup.actions.length === 0
        ? 'No actions across project features.'
        : 'No actions match your search.'}
    </p>
  {:else}
    <p class="text-xs text-slate-500">
      {actions.length}
      {actions.length === 1 ? 'action' : 'actions'} across {featureGroups.length}
      {featureGroups.length === 1 ? 'feature' : 'features'}
    </p>
    <div class="space-y-3">
      {#each featureGroups as group (group.featureId)}
        <div class="overflow-hidden rounded-lg border border-hairline bg-white">
          <div class="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
            <a
              href={`/features/${group.featureId}`}
              class="font-medium text-brand-700 hover:underline">{group.featureName}</a
            >
            <span
              class="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
              title="Actions defined in this feature"
            >
              {group.actions.length}
              {group.actions.length === 1 ? 'action' : 'actions'}
            </span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th class="px-3 py-1.5 font-medium">Action</th>
                  <th class="px-3 py-1.5 font-medium">Surface</th>
                  <th class="px-3 py-1.5 font-medium">Definition stats</th>
                  <th class="px-3 py-1.5 font-medium">Shared references</th>
                </tr>
              </thead>
              <tbody>
                {#each group.actions as action (action.actionId)}
                  <tr class="border-t border-slate-100 align-top">
                    <td class="px-3 py-2">
                      <a
                        href={`/features/${action.featureId}?tab=build&surface=${action.surfaceId}&panel=actions&focus=action:${action.actionId}`}
                        class="font-medium text-brand-700 hover:underline">{action.actionName}</a
                      >
                      <p class="mt-0.5 max-w-sm text-xs text-slate-500">{action.intent}</p>
                      {#if action.roles.length > 0}
                        <div class="mt-1 flex flex-wrap gap-1">
                          {#each action.roles as role (role)}
                            <span
                              class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                              >{role}</span
                            >
                          {/each}
                        </div>
                      {/if}
                    </td>
                    <td class="px-3 py-2 text-xs text-slate-600">{action.surfaceName}</td>
                    <td class="px-3 py-2 text-xs tabular-nums text-slate-600">
                      <div>{action.counts.parameters} parameters · {action.counts.rules} rules</div>
                      <div>
                        {action.counts.effects} effects · {action.counts.invariants} invariants
                      </div>
                      <div>
                        {action.counts.scenarios} scenarios · {action.counts.outcomes} outcomes
                      </div>
                    </td>
                    <td class="px-3 py-2 text-xs">
                      <div class="flex max-w-md flex-wrap gap-1">
                        {#each action.references.statePaths as path (path)}
                          <span class="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-violet-700"
                            >{path}</span
                          >
                        {/each}
                        {#each action.references.events as event (event)}
                          <span class="rounded bg-cyan-50 px-1.5 py-0.5 font-mono text-cyan-700"
                            >{event}</span
                          >
                        {/each}
                        {#each action.references.resources as resource (resource)}
                          <span class="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-amber-700"
                            >resource:{resource}</span
                          >
                        {/each}
                        {#if action.references.statePaths.length === 0 && action.references.events.length === 0 && action.references.resources.length === 0}
                          <span class="text-slate-400">Local only</span>
                        {/if}
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
