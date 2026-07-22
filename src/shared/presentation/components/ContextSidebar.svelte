<script lang="ts">
  import { page } from '$app/state';

  export type ContextSidebarItem = {
    readonly id: string;
    readonly label: string;
  };

  export type ContextSidebarGroup = {
    readonly label: string;
    readonly items: readonly ContextSidebarItem[];
  };

  type Props = {
    contextLabel: string;
    contextName: string;
    backHref: string;
    backLabel: string;
    /** Flat section list. Use this OR `groups`. */
    items?: readonly ContextSidebarItem[];
    /** Sections split into labelled categories. Takes precedence over `items`. */
    groups?: readonly ContextSidebarGroup[];
    activeId: string;
    /**
     * Badge number for a section. Return `null` for "not known yet" — rendered
     * as a muted placeholder instead of a `0`, so a counter still resolving its
     * data doesn't claim the section is empty.
     */
    count: (id: string) => number | null;
    onSelect: (id: string) => void;
  };

  let {
    contextLabel,
    contextName,
    backHref,
    backLabel,
    items,
    groups,
    activeId,
    count,
    onSelect
  }: Props = $props();

  const embedded = $derived(page.url.searchParams.get('embed') === '1');

  // Normalize to a list of {label, items}. A flat `items` list renders as one
  // header-less group, so grouped and ungrouped callers share a single render
  // path (and a caller passing neither just gets an empty nav).
  const sections = $derived<readonly ContextSidebarGroup[]>(
    groups ?? [{ label: '', items: items ?? [] }]
  );
</script>

<!--
  Floating sticky panel: a detached white card (rounded, soft shadow, margin
  off the edges) rather than a flush full-height dark rail. Locked to the light
  look regardless of the surrounding shell.
-->
<aside
  class="sticky z-20 m-4 flex w-60 shrink-0 flex-col self-start overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-[0_12px_28px_-10px_rgba(15,23,42,0.18)] {embedded
    ? 'top-4 max-h-[calc(100vh-2rem)]'
    : 'top-20 max-h-[calc(100vh-7rem)]'}"
>
  <div class="border-b border-slate-200 px-4 py-4">
    <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-600">
      {contextLabel}
    </p>
    <p class="mt-1 truncate text-sm font-semibold text-slate-900" title={contextName}>
      {contextName}
    </p>
  </div>

  <div class="px-2 pt-2">
    <a
      href={backHref}
      class="flex min-h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
      title={backLabel}
    >
      <svg viewBox="0 0 24 24" class="size-4 shrink-0" aria-hidden="true">
        <path
          d="M15 18l-6-6 6-6"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span class="truncate">{backLabel}</span>
    </a>
  </div>

  <nav
    class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2"
    aria-label={`${contextLabel} sections`}
  >
    {#each sections as group, gi (group.label + '-' + gi)}
      {#if group.label}
        <p
          class="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 {gi ===
          0
            ? 'pt-1'
            : 'pt-3'}"
        >
          {group.label}
        </p>
      {/if}
      {#each group.items as item (item.id)}
        {@render row(item)}
      {/each}
    {/each}
  </nav>
</aside>

{#snippet row(item: ContextSidebarItem)}
  {@const active = activeId === item.id}
  <button
    type="button"
    aria-current={active ? 'page' : undefined}
    onclick={() => onSelect(item.id)}
    class="flex min-h-9 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-[13px] font-medium transition-colors {active
      ? 'bg-violet-100 font-semibold text-violet-700'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}"
  >
    <span class="truncate">{item.label}</span>
    <span
      class="min-w-6 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold tabular-nums {active
        ? 'bg-violet-200 text-violet-700'
        : 'bg-slate-100 text-slate-500'}">{count(item.id) ?? '–'}</span
    >
  </button>
{/snippet}
