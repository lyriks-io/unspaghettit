<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { withBase } from '$shared/routing/appBase';
  import { groupResources } from '$features/projects/presentation/services/crossFeatureGroups';

  type Props = {
    features: readonly Feature[];
    search: string;
  };

  let { features, search }: Props = $props();

  const rows = $derived(groupResources(features));

  const filtered = $derived(
    search.trim().length === 0
      ? rows
      : rows.filter((r) => {
          const q = search.toLowerCase();
          return (
            r.name.toLowerCase().includes(q) ||
            r.provider.toLowerCase().includes(q) ||
            r.kind.toLowerCase().includes(q) ||
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
      ? 'No resources declared across the project features.'
      : 'No resources match your search.'}
  </p>
{:else}
  <div class="overflow-x-auto rounded-lg border border-hairline bg-white">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th class="px-3 py-2">Name</th>
          <th class="px-3 py-2">Kind</th>
          <th class="px-3 py-2">Provider</th>
          <th class="px-3 py-2">Scope</th>
          <th class="px-3 py-2">Sensitivity</th>
          <th class="px-3 py-2">PII</th>
          <th class="px-3 py-2">From features</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as row (row.key)}
          <tr class="border-t border-slate-100">
            <td class="px-3 py-2 font-medium text-slate-950">
              {row.name}
              {#if row.description}
                <div class="text-xs font-normal text-slate-500">{row.description}</div>
              {/if}
            </td>
            <td class="px-3 py-2 text-slate-600">{row.kind}</td>
            <td class="px-3 py-2 text-slate-600">{row.provider}</td>
            <td class="px-3 py-2 text-slate-600">{row.scope}</td>
            <td class="px-3 py-2 text-slate-600">{row.sensitivity}</td>
            <td class="px-3 py-2 text-slate-600">{row.containsPii ? 'Yes' : 'No'}</td>
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
