<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { featureHref } from '$features/global-search/domain/searchNav';

  type Props = { features: readonly Feature[]; search: string };
  let { features, search }: Props = $props();

  const rows = $derived(
    features.flatMap((feature) => feature.personas.map((persona) => ({ feature, persona })))
  );
  const filtered = $derived.by(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(({ feature, persona }) =>
      [
        feature.name,
        persona.name,
        persona.description ?? '',
        ...persona.stateOverrides.map((override) => String(override.path)),
        ...persona.parameterOverrides.map((override) => override.parameterName)
      ].some((value) => value.toLowerCase().includes(query))
    );
  });
</script>

{#if filtered.length === 0}
  <p
    class="rounded-lg border border-dashed border-hairline bg-white p-6 text-center text-sm text-slate-500"
  >
    {rows.length === 0
      ? 'No personas defined across project features.'
      : 'No personas match your search.'}
  </p>
{:else}
  <div class="overflow-x-auto rounded-lg border border-hairline bg-white">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr
          ><th class="px-3 py-2">Persona</th><th class="px-3 py-2">Overrides</th><th
            class="px-3 py-2">Feature</th
          ><th class="px-3 py-2">Behavior</th></tr
        >
      </thead>
      <tbody>
        {#each filtered as row (`${row.feature.id}:${row.persona.id}`)}
          <tr class="border-t border-slate-100 align-top">
            <td class="px-3 py-2">
              <a
                href={featureHref(String(row.feature.id), { tab: 'personas' })}
                class="font-medium text-brand-700 hover:underline">{row.persona.name}</a
              >
              {#if row.persona.description}<p class="mt-0.5 max-w-md text-xs text-slate-500">
                  {row.persona.description}
                </p>{/if}
            </td>
            <td class="px-3 py-2 text-xs text-slate-600"
              >{row.persona.stateOverrides.length} state / {row.persona.parameterOverrides.length} parameters</td
            >
            <td class="px-3 py-2 text-xs"
              ><a href={featureHref(String(row.feature.id))} class="text-brand-700 hover:underline"
                >{row.feature.name}</a
              ></td
            >
            <td class="px-3 py-2 text-xs text-slate-600"
              >{row.persona.persistAcrossSurfaces
                ? 'Persists across surfaces'
                : 'Resets on surface change'}</td
            >
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
