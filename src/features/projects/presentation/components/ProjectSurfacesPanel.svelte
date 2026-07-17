<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { surfaceTypeLabel } from '$features/behavior-model/domain/entities/Surface';
  import { featureHref } from '$features/global-search/domain/searchNav';

  type Props = { features: readonly Feature[]; search: string };
  let { features, search }: Props = $props();

  const conceptKey = (name: string, type: string): string =>
    `${type}:${name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')}`;

  const rows = $derived(
    features.flatMap((feature) =>
      feature.surfaces.map((surface) => ({
        feature,
        surface,
        concept: conceptKey(surface.name, surface.type)
      }))
    )
  );

  const conceptCounts = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.concept, (counts.get(row.concept) ?? 0) + 1);
    return counts;
  });

  const filtered = $derived.by(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(({ feature, surface }) =>
      [feature.name, surface.name, surfaceTypeLabel(surface.type), surface.description ?? ''].some(
        (value) => value.toLowerCase().includes(query)
      )
    );
  });

  function relatedSurfaces(concept: string, featureId: string, surfaceId: string) {
    return rows.filter(
      (row) =>
        row.concept === concept &&
        (String(row.feature.id) !== featureId || String(row.surface.id) !== surfaceId)
    );
  }
</script>

{#if filtered.length === 0}
  <p
    class="rounded-lg border border-dashed border-hairline bg-white p-6 text-center text-sm text-slate-500"
  >
    {rows.length === 0
      ? 'No surfaces defined across project features.'
      : 'No surfaces match your search.'}
  </p>
{:else}
  <div class="overflow-x-auto rounded-lg border border-hairline bg-white">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th class="px-3 py-2">Surface</th>
          <th class="px-3 py-2">Feature</th>
          <th class="px-3 py-2">Behavior</th>
          <th class="px-3 py-2">Cross-feature relation</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as row (`${row.feature.id}:${row.surface.id}`)}
          {@const related = relatedSurfaces(
            row.concept,
            String(row.feature.id),
            String(row.surface.id)
          )}
          <tr class="border-t border-slate-100 align-top">
            <td class="px-3 py-2">
              <a
                href={featureHref(String(row.feature.id), { surface: String(row.surface.id) })}
                class="font-medium text-brand-700 hover:underline">{row.surface.name}</a
              >
              <div class="mt-0.5 text-xs text-slate-500">
                {surfaceTypeLabel(row.surface.type)}{row.surface.presentation
                  ? ' · presentation'
                  : ''}
              </div>
              {#if row.surface.description}
                <p class="mt-1 max-w-md text-xs text-slate-500">{row.surface.description}</p>
              {/if}
            </td>
            <td class="px-3 py-2 text-xs">
              <a href={featureHref(String(row.feature.id))} class="text-brand-700 hover:underline">
                {row.feature.name}
              </a>
            </td>
            <td class="px-3 py-2 text-xs tabular-nums text-slate-600">
              <div>
                {row.surface.actions.length} actions · {row.surface.stateDefinitions.length} states
              </div>
              <div>
                {row.surface.rules.length} rules · {row.surface.invariants.length} invariants
              </div>
            </td>
            <td class="px-3 py-2 text-xs">
              {#if (conceptCounts.get(row.concept) ?? 0) > 1}
                <p class="mb-1 text-slate-500">Same name and type in:</p>
                <div class="flex flex-wrap gap-1">
                  {#each related as match (`${match.feature.id}:${match.surface.id}`)}
                    <a
                      href={featureHref(String(match.feature.id), {
                        surface: String(match.surface.id)
                      })}
                      class="rounded-full border border-cyan-100 bg-cyan-50/60 px-2 py-0.5 text-brand-700 hover:bg-cyan-50 hover:underline"
                      >{match.feature.name}</a
                    >
                  {/each}
                </div>
              {:else}
                <span class="text-slate-400">Unique in this project</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
