<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { getEffectiveEntities } from '$features/behavior-model/domain/services/EffectiveEntities';

  type Props = {
    features: readonly Feature[];
    search: string;
  };

  let { features, search }: Props = $props();

  type Row = {
    featureId: string;
    featureName: string;
    rowKey: string;
    namespace: string;
    description?: string;
    fieldCount: number;
  };

  // Mirrors the per-feature EntityManager: union of stored Entity records and
  // namespaces deduced from state paths. Lets the project editor surface state-only
  // entities (state defined on a surface, no Entity row authored yet) too.
  const rows = $derived<Row[]>(
    features.flatMap((e) =>
      getEffectiveEntities(e).map((d) => ({
        featureId: e.id,
        featureName: e.name,
        rowKey: d.id ?? d.namespace,
        namespace: d.namespace,
        description: d.description,
        fieldCount: d.fields.length
      }))
    )
  );

  const filtered = $derived(
    search.trim().length === 0
      ? rows
      : rows.filter((r) => {
          const q = search.toLowerCase();
          return (
            r.namespace.toLowerCase().includes(q) ||
            r.featureName.toLowerCase().includes(q) ||
            (r.description ?? '').toLowerCase().includes(q)
          );
        })
  );
</script>

{#if filtered.length === 0}
  <p
    class="rounded-lg border border-dashed border-hairline bg-white p-6 text-center text-sm text-slate-500"
  >
    {rows.length === 0
      ? 'No data entities declared across the project’s features.'
      : 'No data entities match your search.'}
  </p>
{:else}
  <div class="overflow-x-auto rounded-lg border border-hairline bg-white">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th class="px-3 py-2">Namespace</th>
          <th class="px-3 py-2">Fields</th>
          <th class="px-3 py-2">From feature</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as row (row.featureId + ':' + row.rowKey)}
          <tr class="border-t border-slate-100">
            <td class="px-3 py-2 font-medium text-slate-950">
              {row.namespace}
              {#if row.description}
                <div class="text-xs font-normal text-slate-500">{row.description}</div>
              {/if}
            </td>
            <td class="px-3 py-2 text-slate-600">{row.fieldCount}</td>
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
