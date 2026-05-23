<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { buildTransitionCatalog } from '$features/behavior-model/domain/services/TransitionCatalog';

  type Props = {
    features: readonly Feature[];
    search: string;
  };

  let { features, search }: Props = $props();

  type Row = {
    featureId: string;
    featureName: string;
    rowKey: string;
    sourceName: string;
    targetName: string;
    label?: string;
    description?: string;
    sources: number;
  };

  // Mirrors the per-feature TransitionsManager: union of declared transitions
  // and transitions emitted by action / rule transition_surface effects.
  const rows = $derived<Row[]>(
    features.flatMap((e) =>
      buildTransitionCatalog(e).map((entry) => {
        const first = entry.sources[0];
        return {
          featureId: e.id,
          featureName: e.name,
          rowKey: `${entry.fromSurfaceId}->${entry.toSurfaceId}`,
          sourceName: entry.fromSurfaceName,
          targetName: entry.toSurfaceName,
          label: first?.description,
          description: undefined,
          sources: entry.sources.length
        };
      })
    )
  );

  const filtered = $derived(
    search.trim().length === 0
      ? rows
      : rows.filter((r) => {
          const q = search.toLowerCase();
          return (
            r.sourceName.toLowerCase().includes(q) ||
            r.targetName.toLowerCase().includes(q) ||
            (r.label ?? '').toLowerCase().includes(q) ||
            r.featureName.toLowerCase().includes(q)
          );
        })
  );
</script>

{#if filtered.length === 0}
  <p
    class="rounded-lg border border-dashed border-hairline bg-white p-6 text-center text-sm text-slate-500"
  >
    {rows.length === 0
      ? 'No transitions declared across the project’s features.'
      : 'No transitions match your search.'}
  </p>
{:else}
  <div class="overflow-x-auto rounded-lg border border-hairline bg-white">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th class="px-3 py-2">From</th>
          <th class="px-3 py-2">To</th>
          <th class="px-3 py-2">Label</th>
          <th class="px-3 py-2">From feature</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as row (row.featureId + ':' + row.rowKey)}
          <tr class="border-t border-slate-100">
            <td class="px-3 py-2 font-medium text-slate-950">{row.sourceName}</td>
            <td class="px-3 py-2 text-slate-700">{row.targetName}</td>
            <td class="px-3 py-2 text-slate-600">
              {row.label ?? '-'}
              {#if row.description}
                <div class="text-xs text-slate-500">{row.description}</div>
              {/if}
            </td>
            <td class="px-3 py-2 text-xs">
              <a
                href={`/features/${row.featureId}`}
                class="text-brand-700 hover:underline"
              >
                {row.featureName}
              </a>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
