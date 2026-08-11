<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { withBase } from '$shared/routing/appBase';
  import { groupEvents } from '$features/projects/presentation/services/crossFeatureGroups';

  type Props = {
    features: readonly Feature[];
    search: string;
  };

  let { features, search }: Props = $props();

  const rows = $derived(groupEvents(features));

  const filtered = $derived(
    search.trim().length === 0
      ? rows
      : rows.filter((r) => {
          const q = search.toLowerCase();
          return (
            r.name.toLowerCase().includes(q) ||
            (r.description ?? '').toLowerCase().includes(q) ||
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
      ? 'No events registered across the project features.'
      : 'No events match your search.'}
  </p>
{:else}
  <div class="overflow-x-auto rounded-lg border border-hairline bg-white">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th class="px-3 py-2">Event name</th>
          <th class="px-3 py-2">Emissions</th>
          <th class="px-3 py-2">Payload fields</th>
          <th class="px-3 py-2">From features</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as row (row.key)}
          <tr class="border-t border-slate-100">
            <td class="px-3 py-2 font-mono text-slate-950">
              {row.name}
              {#if row.description}
                <div class="font-sans text-xs text-slate-500">{row.description}</div>
              {/if}
            </td>
            <td class="px-3 py-2 text-slate-600">{row.emissions}</td>
            <td class="px-3 py-2 text-slate-600">{row.payloadFieldCount}</td>
            <td class="px-3 py-2 text-xs">
              <div class="flex flex-wrap gap-1">
                {#each row.sources as src (src.featureId)}
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
{/if}
