<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { effectTypeLabel } from '$features/behavior-model/domain/value-objects/Effect';
  import { ruleCategoryLabel } from '$features/behavior-model/domain/value-objects/RuleCategory';
  import { featureHref, surfaceTabFocus } from '$features/global-search/domain/searchNav';

  type Props = { features: readonly Feature[]; search?: string };
  let { features, search = '' }: Props = $props();

  const rows = $derived(
    features.flatMap((feature) =>
      feature.surfaces.flatMap((surface) =>
        surface.rules.map((rule) => ({ feature, surface, rule }))
      )
    )
  );
  const filtered = $derived.by(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(({ feature, surface, rule }) =>
      [
        feature.name,
        surface.name,
        rule.description ?? '',
        ruleCategoryLabel(rule.category),
        effectTypeLabel(rule.effect.type)
      ].some((value) => value.toLowerCase().includes(query))
    );
  });
</script>

{#if filtered.length === 0}
  <p
    class="rounded-lg border border-dashed border-hairline bg-white p-6 text-center text-sm text-slate-500"
  >
    {rows.length === 0 ? 'No surface rules defined.' : 'No surface rules match your search.'}
  </p>
{:else}
  <div class="overflow-x-auto rounded-lg border border-hairline bg-white">
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th class="px-3 py-2">Surface rule</th>
          <th class="px-3 py-2">Category</th>
          <th class="px-3 py-2">Effect</th>
          <th class="px-3 py-2">Feature / surface</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as row (`${row.feature.id}:${row.surface.id}:${row.rule.id}`)}
          <tr class="border-t border-slate-100 align-top">
            <td class="px-3 py-2">
              <a
                href={featureHref(String(row.feature.id), {
                  surface: String(row.surface.id),
                  panel: 'rules',
                  focus: surfaceTabFocus(String(row.surface.id), 'rules')
                })}
                class="font-medium text-brand-700 hover:underline"
                >{row.rule.description?.trim() || `${ruleCategoryLabel(row.rule.category)} rule`}</a
              >
              <p class="mt-0.5 text-xs text-slate-500">
                {row.rule.condition ? 'Conditional' : 'Always runs'}
              </p>
            </td>
            <td class="px-3 py-2 text-xs text-slate-600">{ruleCategoryLabel(row.rule.category)}</td>
            <td class="px-3 py-2 text-xs text-slate-600">{effectTypeLabel(row.rule.effect.type)}</td
            >
            <td class="px-3 py-2 text-xs text-slate-600">
              <a href={featureHref(String(row.feature.id))} class="text-brand-700 hover:underline"
                >{row.feature.name}</a
              >
              <div>{row.surface.name}</div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
