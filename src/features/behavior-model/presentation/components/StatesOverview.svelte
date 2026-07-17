<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { featureHref, surfaceTabFocus } from '$features/global-search/domain/searchNav';

  type Props = { features: readonly Feature[]; search?: string };
  let { features, search = '' }: Props = $props();

  const rows = $derived(
    features.flatMap((feature) =>
      feature.surfaces.flatMap((surface) =>
        surface.stateDefinitions.map((definition) => ({ feature, surface, definition }))
      )
    )
  );
  const filtered = $derived.by(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(({ feature, surface, definition }) =>
      [
        feature.name,
        surface.name,
        String(definition.path),
        definition.type,
        definition.description ?? ''
      ].some((value) => value.toLowerCase().includes(query))
    );
  });
</script>

{#if filtered.length === 0}
  <p
    class="rounded-lg border border-dashed border-hairline bg-white p-6 text-center text-sm text-slate-500"
  >
    {rows.length === 0 ? 'No states defined.' : 'No states match your search.'}
  </p>
{:else}
  <div class="overflow-x-auto rounded-lg border border-hairline bg-white">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th class="px-3 py-2">State</th>
          <th class="px-3 py-2">Type / default</th>
          <th class="px-3 py-2">Feature / surface</th>
          <th class="px-3 py-2">Sharing</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as row (`${row.feature.id}:${row.surface.id}:${row.definition.id}`)}
          <tr class="border-t border-slate-100 align-top">
            <td class="px-3 py-2">
              <a
                href={featureHref(String(row.feature.id), {
                  surface: String(row.surface.id),
                  panel: 'state',
                  focus: surfaceTabFocus(String(row.surface.id), 'state')
                })}
                class="font-mono font-medium text-brand-700 hover:underline"
                >{row.definition.path}</a
              >
              {#if row.definition.description}
                <p class="mt-0.5 max-w-md font-sans text-xs text-slate-500">
                  {row.definition.description}
                </p>
              {/if}
            </td>
            <td class="px-3 py-2 text-xs text-slate-600">
              <div>{row.definition.type}{row.definition.derived ? ' · derived' : ''}</div>
              <div class="mt-0.5 font-mono text-slate-500">
                {JSON.stringify(row.definition.defaultValue)}
              </div>
            </td>
            <td class="px-3 py-2 text-xs text-slate-600">
              <a href={featureHref(String(row.feature.id))} class="text-brand-700 hover:underline"
                >{row.feature.name}</a
              >
              <div>{row.surface.name}</div>
            </td>
            <td class="px-3 py-2 text-xs text-slate-600">
              {row.definition.sharedWith?.length ?? 0} other surface(s)
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
