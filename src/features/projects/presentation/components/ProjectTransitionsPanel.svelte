<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { withBase } from '$shared/routing/appBase';
  import {
    groupTransitions,
    type FeatureAttribution
  } from '$features/projects/presentation/services/crossFeatureGroups';

  type Props = {
    features: readonly Feature[];
    search: string;
  };

  let { features, search }: Props = $props();

  const rows = $derived(groupTransitions(features));

  const filtered = $derived(
    search.trim().length === 0
      ? rows
      : rows.filter((r) => {
          const q = search.toLowerCase();
          return (
            r.sourceName.toLowerCase().includes(q) ||
            r.targetName.toLowerCase().includes(q) ||
            (r.label ?? '').toLowerCase().includes(q) ||
            r.sources.some((s) => s.featureName.toLowerCase().includes(q))
          );
        })
  );

  type Outgoing = {
    key: string;
    targetName: string;
    label?: string;
    sources: readonly FeatureAttribution[];
  };
  type SourceGroup = {
    key: string;
    sourceName: string;
    transitions: Outgoing[];
  };

  // A flat row-per-transition list repeats the "From" surface on every edge it
  // originates. Collapse by source so each surface reads once, with everywhere
  // it can go listed underneath, sorted alphabetically by target.
  const groups = $derived.by(() => {
    const map = new Map<string, SourceGroup>();
    for (const row of filtered) {
      const key = row.sourceName.toLowerCase();
      let group = map.get(key);
      if (!group) {
        group = { key, sourceName: row.sourceName, transitions: [] };
        map.set(key, group);
      }
      group.transitions.push({
        key: row.key,
        targetName: row.targetName,
        label: row.label,
        sources: row.sources
      });
    }
    for (const group of map.values()) {
      group.transitions.sort(
        (a, b) =>
          a.targetName.localeCompare(b.targetName, undefined, { sensitivity: 'base' }) ||
          (a.label ?? '').localeCompare(b.label ?? '', undefined, { sensitivity: 'base' })
      );
    }
    return [...map.values()].sort((a, b) =>
      a.sourceName.localeCompare(b.sourceName, undefined, { sensitivity: 'base' })
    );
  });
</script>

{#if groups.length === 0}
  <p
    class="rounded-lg border border-dashed border-hairline bg-white p-6 text-center text-sm text-slate-500"
  >
    {rows.length === 0
      ? 'No transitions declared across the project features.'
      : 'No transitions match your search.'}
  </p>
{:else}
  <p class="mb-2 text-xs text-slate-500">
    {groups.length}
    {groups.length === 1 ? 'source' : 'sources'} across {filtered.length}
    {filtered.length === 1 ? 'transition' : 'transitions'}
  </p>
  <div class="space-y-3">
    {#each groups as group (group.key)}
      <div class="overflow-hidden rounded-lg border border-hairline bg-white">
        <div
          class="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2"
        >
          <span class="font-medium text-slate-950">{group.sourceName}</span>
          <span
            class="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
            title="Transitions leaving this surface"
          >
            {group.transitions.length}
            {group.transitions.length === 1 ? 'transition' : 'transitions'}
          </span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th class="px-3 py-1.5 font-medium">To</th>
                <th class="px-3 py-1.5 font-medium">Label</th>
                <th class="px-3 py-1.5 font-medium">From features</th>
              </tr>
            </thead>
            <tbody>
              {#each group.transitions as t (t.key)}
                <tr class="border-t border-slate-100 align-top">
                  <td class="px-3 py-2 text-slate-700">{t.targetName}</td>
                  <td class="px-3 py-2 text-slate-600">{t.label ?? '-'}</td>
                  <td class="px-3 py-2 text-xs">
                    <div class="flex flex-wrap gap-1">
                      {#each t.sources as src (src.featureId)}
                        <a
                          href={withBase(`/features/${src.featureId}`)}
                          class="rounded-full border border-cyan-100 bg-cyan-50/60 px-2 py-0.5 text-brand-700 hover:bg-cyan-50 hover:underline"
                        >
                          {src.featureName}
                        </a>
                      {/each}
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
