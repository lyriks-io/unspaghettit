<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Persona } from '$features/behavior-model/domain/entities/Persona';
  import { featureHref } from '$features/global-search/domain/searchNav';

  type Props = { features: readonly Feature[]; search: string };
  let { features, search }: Props = $props();

  type Usage = { feature: Feature; persona: Persona };

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

  type PersonaGroup = {
    key: string;
    name: string;
    description: string;
    descriptionsVary: boolean;
    usages: Usage[];
  };

  // Collapse the same persona used across many features into one group so the
  // list reads as "who acts in this product", not one row per feature.
  const groups = $derived.by(() => {
    const map = new Map<string, PersonaGroup>();
    for (const usage of filtered) {
      const key = usage.persona.name.trim().toLowerCase();
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          name: usage.persona.name,
          description: '',
          descriptionsVary: false,
          usages: []
        };
        map.set(key, group);
      }
      const description = usage.persona.description?.trim() ?? '';
      if (description) {
        if (!group.description) group.description = description;
        else if (description !== group.description) group.descriptionsVary = true;
      }
      group.usages.push(usage);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
</script>

{#if groups.length === 0}
  <p
    class="rounded-lg border border-dashed border-hairline bg-white p-6 text-center text-sm text-slate-500"
  >
    {rows.length === 0
      ? 'No personas defined across project features.'
      : 'No personas match your search.'}
  </p>
{:else}
  <p class="mb-2 text-xs text-slate-500">
    {groups.length}
    {groups.length === 1 ? 'persona' : 'personas'} across {filtered.length}
    {filtered.length === 1 ? 'feature usage' : 'feature usages'}
  </p>
  <div class="space-y-3">
    {#each groups as group (group.key)}
      <div class="overflow-hidden rounded-lg border border-hairline bg-white">
        <div class="border-b border-slate-100 bg-slate-50 px-3 py-2">
          <div class="flex items-center gap-2">
            <span class="font-medium text-slate-800">{group.name}</span>
            <span
              class="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
              title="Distinct features this persona is used in"
            >
              {group.usages.length}
              {group.usages.length === 1 ? 'feature' : 'features'}
            </span>
          </div>
          {#if group.description}<p class="mt-0.5 max-w-2xl text-xs text-slate-500">
              {group.description}
            </p>{/if}
          {#if group.descriptionsVary}<p class="mt-0.5 text-xs text-amber-600">
              Description differs between features. Consider aligning them.
            </p>{/if}
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr
                ><th class="px-3 py-1.5 font-medium">Feature</th><th class="px-3 py-1.5 font-medium"
                  >Overrides</th
                ><th class="px-3 py-1.5 font-medium">Behavior</th></tr
              >
            </thead>
            <tbody>
              {#each group.usages as row (`${row.feature.id}:${row.persona.id}`)}
                <tr class="border-t border-slate-100 align-top">
                  <td class="px-3 py-2 text-xs"
                    ><a
                      href={featureHref(String(row.feature.id), { tab: 'personas' })}
                      class="text-brand-700 hover:underline">{row.feature.name}</a
                    ></td
                  >
                  <td class="px-3 py-2 text-xs text-slate-600"
                    >{row.persona.stateOverrides.length} state / {row.persona.parameterOverrides
                      .length} parameters</td
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
      </div>
    {/each}
  </div>
{/if}
