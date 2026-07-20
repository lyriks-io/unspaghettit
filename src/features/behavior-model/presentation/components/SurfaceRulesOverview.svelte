<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import type { Rule } from '$features/behavior-model/domain/entities/Rule';
  import { effectTypeLabel } from '$features/behavior-model/domain/value-objects/Effect';
  import { ruleCategoryLabel } from '$features/behavior-model/domain/value-objects/RuleCategory';
  import { featureHref, surfaceTabFocus } from '$features/global-search/domain/searchNav';

  type Props = { features: readonly Feature[]; search?: string };
  let { features, search = '' }: Props = $props();

  type Row = { feature: Feature; surface: Surface; rule: Rule };

  const ruleName = (rule: Rule) =>
    rule.description?.trim() || `${ruleCategoryLabel(rule.category)} rule`;

  const rows = $derived<Row[]>(
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

  type RuleGroup = {
    key: string;
    name: string;
    category: Rule['category'];
    categoriesVary: boolean;
    rows: Row[];
  };

  // The same surface rule name recurs across many features and surfaces
  // (a shared "Validation rule", a guard repeated on every screen). A flat
  // row-per-rule list repeats the name over and over. Collapse by name so each
  // reads once, with every feature/surface that defines it listed underneath,
  // sorted alphabetically.
  const groups = $derived.by(() => {
    const map = new Map<string, RuleGroup>();
    for (const row of filtered) {
      const key = ruleName(row.rule);
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          name: key,
          category: row.rule.category,
          categoriesVary: false,
          rows: []
        };
        map.set(key, group);
      }
      if (row.rule.category !== group.category) group.categoriesVary = true;
      group.rows.push(row);
    }
    for (const group of map.values()) {
      group.rows.sort(
        (a, b) =>
          a.feature.name.localeCompare(b.feature.name, undefined, { sensitivity: 'base' }) ||
          a.surface.name.localeCompare(b.surface.name, undefined, { sensitivity: 'base' })
      );
    }
    return [...map.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
  });
</script>

{#if groups.length === 0}
  <p
    class="rounded-lg border border-dashed border-hairline bg-white p-6 text-center text-sm text-slate-500"
  >
    {rows.length === 0 ? 'No surface rules defined.' : 'No surface rules match your search.'}
  </p>
{:else}
  <p class="mb-2 text-xs text-slate-500">
    {groups.length}
    {groups.length === 1 ? 'rule' : 'rules'} across {filtered.length}
    {filtered.length === 1 ? 'definition' : 'definitions'}
  </p>
  <div class="space-y-3">
    {#each groups as group (group.key)}
      <div class="overflow-hidden rounded-lg border border-hairline bg-white">
        <div class="border-b border-slate-100 bg-slate-50 px-3 py-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium text-slate-800">{group.name}</span>
            {#if !group.categoriesVary}
              <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                >{ruleCategoryLabel(group.category)}</span
              >
            {/if}
            <span
              class="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
              title="Surfaces that define this rule"
            >
              {group.rows.length}
              {group.rows.length === 1 ? 'definition' : 'definitions'}
            </span>
          </div>
          {#if group.categoriesVary}<p class="mt-0.5 text-xs text-amber-600">
              Category differs between surfaces.
            </p>{/if}
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th class="px-3 py-1.5 font-medium">Feature / surface</th>
                <th class="px-3 py-1.5 font-medium">Category</th>
                <th class="px-3 py-1.5 font-medium">Effect</th>
                <th class="px-3 py-1.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {#each group.rows as row (`${row.feature.id}:${row.surface.id}:${row.rule.id}`)}
                <tr class="border-t border-slate-100 align-top">
                  <td class="px-3 py-2 text-xs text-slate-600">
                    <a
                      href={featureHref(String(row.feature.id), {
                        surface: String(row.surface.id),
                        panel: 'rules',
                        focus: surfaceTabFocus(String(row.surface.id), 'rules')
                      })}
                      class="text-brand-700 hover:underline">{row.feature.name}</a
                    >
                    <div>{row.surface.name}</div>
                  </td>
                  <td class="px-3 py-2 text-xs text-slate-600"
                    >{ruleCategoryLabel(row.rule.category)}</td
                  >
                  <td class="px-3 py-2 text-xs text-slate-600"
                    >{effectTypeLabel(row.rule.effect.type)}</td
                  >
                  <td class="px-3 py-2 text-xs text-slate-600">
                    {row.rule.condition ? 'Conditional' : 'Always runs'}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/each}
  </div>
{/if}
