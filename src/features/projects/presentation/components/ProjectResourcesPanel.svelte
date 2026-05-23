<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';

  type Props = {
    features: readonly Feature[];
    search: string;
  };

  let { features, search }: Props = $props();

  type Row = {
    featureId: string;
    featureName: string;
    resourceId: string;
    name: string;
    kind: string;
    provider: string;
    scope: string;
    sensitivity: string;
    containsPii: boolean;
    description?: string;
  };

  const rows = $derived<Row[]>(
    features.flatMap((e) =>
      e.resources.map((r) => ({
        featureId: e.id,
        featureName: e.name,
        resourceId: r.id,
        name: r.name,
        kind: r.kind,
        provider: r.provider,
        scope: r.scope,
        sensitivity: r.sensitivity,
        containsPii: r.containsPii,
        description: r.description
      }))
    )
  );

  const filtered = $derived(
    search.trim().length === 0
      ? rows
      : rows.filter((r) => {
          const q = search.toLowerCase();
          return (
            r.name.toLowerCase().includes(q) ||
            r.provider.toLowerCase().includes(q) ||
            r.kind.toLowerCase().includes(q) ||
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
      ? 'No resources declared across the project’s features.'
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
          <th class="px-3 py-2">From feature</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as row (row.featureId + ':' + row.resourceId)}
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
