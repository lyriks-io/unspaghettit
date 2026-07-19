<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import type { StateDefinition } from '$features/behavior-model/domain/entities/StateDefinition';
  import { featureHref, surfaceTabFocus } from '$features/global-search/domain/searchNav';

  type Props = { features: readonly Feature[]; search?: string };
  let { features, search = '' }: Props = $props();

  type Row = { feature: Feature; surface: Surface; definition: StateDefinition };

  const rows = $derived<Row[]>(
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

  type StateGroup = {
    key: string;
    path: string;
    type: string;
    typesVary: boolean;
    description: string;
    rows: Row[];
  };

  // The same state path is projected onto many surfaces (shared definitions)
  // and recurs across features. A flat row-per-projection list repeats
  // `cart.itemCount` a dozen times. Collapse by path so each state reads once,
  // with every surface that defines it listed underneath.
  const groups = $derived.by(() => {
    const map = new Map<string, StateGroup>();
    for (const row of filtered) {
      const key = String(row.definition.path);
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          path: key,
          type: row.definition.type,
          typesVary: false,
          description: '',
          rows: []
        };
        map.set(key, group);
      }
      if (row.definition.type !== group.type) group.typesVary = true;
      const description = row.definition.description?.trim() ?? '';
      if (description && !group.description) group.description = description;
      group.rows.push(row);
    }
    return [...map.values()].sort((a, b) =>
      a.path.localeCompare(b.path, undefined, { sensitivity: 'base' })
    );
  });
</script>

{#if groups.length === 0}
  <p
    class="rounded-lg border border-dashed border-hairline bg-white p-6 text-center text-sm text-slate-500"
  >
    {rows.length === 0 ? 'No states defined.' : 'No states match your search.'}
  </p>
{:else}
  <p class="mb-2 text-xs text-slate-500">
    {groups.length}
    {groups.length === 1 ? 'state' : 'states'} across {filtered.length}
    {filtered.length === 1 ? 'definition' : 'definitions'}
  </p>
  <div class="space-y-3">
    {#each groups as group (group.key)}
      <div class="overflow-hidden rounded-lg border border-hairline bg-white">
        <div class="border-b border-slate-100 bg-slate-50 px-3 py-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono font-medium text-slate-800">{group.path}</span>
            {#if !group.typesVary}
              <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                >{group.type}</span
              >
            {/if}
            <span
              class="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
              title="Surfaces that define this state"
            >
              {group.rows.length}
              {group.rows.length === 1 ? 'definition' : 'definitions'}
            </span>
          </div>
          {#if group.description}<p class="mt-0.5 max-w-2xl text-xs text-slate-500">
              {group.description}
            </p>{/if}
          {#if group.typesVary}<p class="mt-0.5 text-xs text-amber-600">
              Type differs between surfaces. Consider aligning them.
            </p>{/if}
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th class="px-3 py-1.5 font-medium">Feature / surface</th>
                <th class="px-3 py-1.5 font-medium">Type / default</th>
                <th class="px-3 py-1.5 font-medium">Sharing</th>
              </tr>
            </thead>
            <tbody>
              {#each group.rows as row (`${row.feature.id}:${row.surface.id}:${row.definition.id}`)}
                <tr class="border-t border-slate-100 align-top">
                  <td class="px-3 py-2 text-xs text-slate-600">
                    <a
                      href={featureHref(String(row.feature.id), {
                        surface: String(row.surface.id),
                        panel: 'state',
                        focus: surfaceTabFocus(String(row.surface.id), 'state')
                      })}
                      class="text-brand-700 hover:underline">{row.feature.name}</a
                    >
                    <div>{row.surface.name}</div>
                  </td>
                  <td class="px-3 py-2 text-xs text-slate-600">
                    <div>{row.definition.type}{row.definition.derived ? ' · derived' : ''}</div>
                    <div class="mt-0.5 font-mono text-slate-500">
                      {JSON.stringify(row.definition.defaultValue)}
                    </div>
                  </td>
                  <td class="px-3 py-2 text-xs text-slate-600">
                    {row.definition.sharedWith?.length ?? 0} other surface(s)
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
