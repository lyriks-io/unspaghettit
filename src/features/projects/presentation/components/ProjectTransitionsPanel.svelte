<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { groupTransitions } from '$features/projects/presentation/services/crossFeatureGroups';

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
</script>

{#if filtered.length === 0}
  <p
    class="rounded-lg border border-dashed border-hairline bg-white p-6 text-center text-sm text-slate-500"
  >
    {rows.length === 0
      ? 'No transitions declared across the project features.'
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
          <th class="px-3 py-2">From features</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as row (row.key)}
          <tr class="border-t border-slate-100">
            <td class="px-3 py-2 font-medium text-slate-950">{row.sourceName}</td>
            <td class="px-3 py-2 text-slate-700">{row.targetName}</td>
            <td class="px-3 py-2 text-slate-600">{row.label ?? '-'}</td>
            <td class="px-3 py-2 text-xs">
              <div class="flex flex-wrap gap-1">
                {#each row.sources as src (src.featureId)}
                  <a
                    href={`/features/${src.featureId}`}
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
{/if}
