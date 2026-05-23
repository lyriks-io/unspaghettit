<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { buildEventCatalog } from '$features/behavior-model/domain/services/EventCatalog';

  type Props = {
    features: readonly Feature[];
    search: string;
  };

  let { features, search }: Props = $props();

  type Row = {
    featureId: string;
    featureName: string;
    rowKey: string;
    name: string;
    description?: string;
    payloadFieldCount: number;
    emissions: number;
  };

  // Mirrors the per-feature EventsManager: union of registered events and
  // events emitted by action / rule effects, so events that fire at runtime
  // appear here even if no EventDefinition record exists.
  const rows = $derived<Row[]>(
    features.flatMap((e) => {
      const registered = new Map((e.events ?? []).map((ev) => [String(ev.name), ev]));
      return buildEventCatalog(e).map((entry) => {
        const name = String(entry.name);
        const declared = registered.get(name);
        return {
          featureId: e.id,
          featureName: e.name,
          rowKey: name,
          name,
          description: declared?.description,
          payloadFieldCount: declared?.payloadSchema?.length ?? 0,
          emissions: entry.emissions.length
        };
      });
    })
  );

  const filtered = $derived(
    search.trim().length === 0
      ? rows
      : rows.filter((r) => {
          const q = search.toLowerCase();
          return (
            r.name.toLowerCase().includes(q) ||
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
      ? 'No events registered across the project’s features.'
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
          <th class="px-3 py-2">From feature</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as row (row.featureId + ':' + row.rowKey)}
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
