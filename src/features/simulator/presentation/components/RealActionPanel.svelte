<script lang="ts">
  import type { Action } from '$features/behavior-model/domain/entities/Action';
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import {
    ALL_ENTITY_TYPES,
    type EntityType,
    type ExpectedEntity,
    type FoundEntity
  } from '$features/implementation-status/domain/ImplementationStatus';
  import { computeImplementationBreakdown } from '$features/implementation-status/domain/ImplementationBreakdown';
  import { implementationStatusStore } from '$features/implementation-status/presentation/stores/implementationStatusStore.svelte';

  type Props = { feature: Feature; action: Action | null };
  let { feature, action }: Props = $props();

  $effect(() => {
    implementationStatusStore.load(feature.id);
  });

  const breakdown = $derived(
    computeImplementationBreakdown(feature, implementationStatusStore.status)
  );

  const entry = $derived(
    action
      ? breakdown.perSurface
          .flatMap((s) => s.perAction)
          .find((c) => c.action.id === action.id) ?? null
      : null
  );

  type Row = { expected: ExpectedEntity; found: FoundEntity | null };

  const groupedRows = $derived.by(() => {
    if (!entry) return [] as { type: EntityType; rows: Row[] }[];
    const foundByKey = new Map<string, FoundEntity>();
    for (const f of entry.found) foundByKey.set(`${f.entityType}:${f.entityId}`, f);
    const out: { type: EntityType; rows: Row[] }[] = [];
    for (const t of ALL_ENTITY_TYPES) {
      const expected = entry.expected.filter((e) => e.entityType === t);
      if (expected.length === 0) continue;
      out.push({
        type: t,
        rows: expected.map((e) => ({
          expected: e,
          found: foundByKey.get(`${e.entityType}:${e.entityId}`) ?? null
        }))
      });
    }
    return out;
  });

  function entityTypeLabel(t: EntityType): string {
    switch (t) {
      case 'action':
        return 'Action';
      case 'event':
        return 'Events';
      case 'rule':
        return 'Rules';
      case 'invariant':
        return 'Invariants';
      case 'transition':
        return 'Transitions';
      case 'state':
        return 'States';
      case 'data':
        return 'Entity';
      case 'surface_rule':
        return 'Surface rules';
      case 'surface_invariant':
        return 'Surface invariants';
    }
  }

  function relTime(iso: string): string {
    const ts = Date.parse(iso);
    if (Number.isNaN(ts)) return iso;
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
    const days = Math.round(diff / 86_400_000);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
</script>

{#if !action}
  <p class="rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-500">
    Select an action to see its real implementation.
  </p>
{:else if !entry || entry.expectedCount === 0}
  <p class="rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-500">
    Nothing taggable on this action yet. No events, rules, invariants, or transitions
    declared.
  </p>
{:else if !entry.reported}
  <div class="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
    <p class="font-medium">No implementation reported yet.</p>
    <p>
      Add this action's implementation to <code>.unspa.json</code> in the implementation
      repo, then call <code>sync_from_index</code>. Real values will appear here.
    </p>
  </div>
{:else}
  <div class="space-y-3 text-xs">
    <div class="flex items-baseline justify-between">
      <span class="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        Real implementation
      </span>
      <span class="text-[10px] text-neutral-500" title={entry.status?.reportedAt}>
        captured {relTime(entry.status!.reportedAt)}
      </span>
    </div>

    {#each groupedRows as group (group.type)}
      <section>
        <p class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          {entityTypeLabel(group.type)}
        </p>
        <ul class="space-y-1">
          {#each group.rows as row (`${row.expected.entityType}:${row.expected.entityId}`)}
            <li class="rounded border border-neutral-200 bg-white px-2 py-1.5">
              <div class="flex items-baseline justify-between gap-2">
                <span
                  class="font-mono text-[11px] {row.found ? 'text-emerald-700' : 'text-red-700'}"
                >
                  {row.found ? '✓' : '✗'} {row.expected.entityName ?? row.expected.entityId}
                </span>
                <span class="font-mono text-[10px] text-neutral-400 truncate">
                  {row.expected.tag}
                </span>
              </div>
              {#if row.found}
                {#if row.found.locations.length > 0}
                  <ul class="mt-1 space-y-1">
                    {#each row.found.locations as loc, i (i)}
                      <li>
                        <div class="font-mono text-[10px] text-neutral-600">
                          {loc.file}{loc.line !== undefined ? `:${loc.line}` : ''}
                        </div>
                        {#if loc.snippet}
                          <pre
                            class="mt-0.5 overflow-x-auto rounded bg-neutral-900 px-2 py-1 text-[10px] leading-snug text-neutral-100">{loc.snippet}</pre>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {:else}
                  <p class="mt-0.5 text-[10px] italic text-neutral-500">
                    Tag found but no locations recorded.
                  </p>
                {/if}
                <p class="mt-1 text-[10px] text-neutral-400" title={row.found.capturedAt}>
                  captured {relTime(row.found.capturedAt)}
                </p>
              {:else}
                <p class="mt-0.5 text-[10px] italic text-neutral-500">No tag captured yet.</p>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}

    {#if entry.status && entry.status.extraTags.length > 0}
      <section>
        <p class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          Drift. Tags found that aren't declared
        </p>
        <ul class="space-y-0.5">
          {#each entry.status.extraTags as extra, i (i)}
            <li class="font-mono text-[10px] text-amber-800">
              {extra.tag}
              {#each extra.locations as loc, j (j)}
                <span class="ml-1 text-neutral-500">
                  {loc.file}{loc.line !== undefined ? `:${loc.line}` : ''}
                </span>
              {/each}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
{/if}
