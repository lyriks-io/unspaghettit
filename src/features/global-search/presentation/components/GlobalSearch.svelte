<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { withBase } from '$shared/routing/appBase';
  import type { SearchDoc } from '$features/global-search/domain/SearchDoc';
  import { globalSearchStore as store } from '$features/global-search/presentation/stores/globalSearchStore.svelte';
  import { searchKindMeta } from '$features/global-search/presentation/searchKindMeta';

  type Props = { dark?: boolean; lyriks?: boolean };
  let { dark = false, lyriks = false }: Props = $props();

  let rootRef = $state<HTMLDivElement | null>(null);
  let inputRef = $state<HTMLInputElement | null>(null);
  let panelRef = $state<HTMLDivElement | null>(null);

  onMount(() => {
    // Subscribe the shared store to model-change events exactly once.
    store.init();
  });

  // The breadcrumb context line: Project › Feature › Surface (only the parts
  // that exist and that aren't already the title).
  function crumb(doc: SearchDoc): string {
    const parts: string[] = [];
    if (doc.projectName) parts.push(doc.projectName);
    if (doc.featureName && doc.kind !== 'feature') parts.push(doc.featureName);
    if (doc.surfaceName && doc.kind !== 'surface') parts.push(doc.surfaceName);
    return parts.join(' › ');
  }

  function navigate(doc: SearchDoc): void {
    void goto(withBase(doc.nav.href));
    store.close();
    inputRef?.blur();
  }

  // Each rendered row gets its global (visual) index so the keyboard highlight
  // and aria-activedescendant line up with `store.results`.
  const indexedGroups = $derived.by(() => {
    let i = 0;
    return store.grouped.map((group) => ({
      kind: group.kind,
      meta: searchKindMeta(group.kind),
      rows: group.docs.map((doc) => ({ doc, index: i++ }))
    }));
  });

  // Keep the highlighted row in view as the user arrows through results.
  $effect(() => {
    const i = store.activeIndex;
    if (!store.open || !panelRef) return;
    const el = panelRef.querySelector(`#gs-opt-${i}`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  });

  function onInputKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        store.openPanel();
        store.move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        store.move(-1);
        break;
      case 'Enter':
        if (store.activeDoc) {
          event.preventDefault();
          navigate(store.activeDoc);
        }
        break;
      case 'Escape':
        event.preventDefault();
        if (store.hasQuery) {
          store.clear();
        } else {
          store.close();
          inputRef?.blur();
        }
        break;
    }
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    // ⌘K / Ctrl+K focuses and opens the search from anywhere.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      store.openPanel();
      inputRef?.focus();
      inputRef?.select();
    }
  }

  function onWindowMousedown(event: MouseEvent): void {
    if (store.open && rootRef && !rootRef.contains(event.target as Node)) {
      store.close();
    }
  }

  // Light vs dark input chrome. The dropdown panel always uses a white surface
  // (like the other header menus), regardless of the header background.
  const inputClass = $derived(
    dark
      ? 'border-slate-700 bg-slate-900/70 text-white placeholder:text-white/70 focus:border-brand-400'
      : 'border-slate-300 bg-white/90 text-slate-900 placeholder:text-slate-400 focus:border-brand-400'
  );
  const iconColor = $derived(dark ? 'text-slate-400' : 'text-slate-400');
  const kbdClass = $derived(
    dark
      ? 'border-slate-600 text-slate-300'
      : lyriks
        ? 'border-white/40 text-white/80'
        : 'border-slate-300 text-slate-400'
  );
</script>

<svelte:window onkeydown={onWindowKeydown} onmousedown={onWindowMousedown} />

<div bind:this={rootRef} class="relative w-full max-w-xl">
  <label for="global-search-input" class="sr-only">Search the model</label>
  <!-- Search glyph -->
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 {iconColor}"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>

  <input
    bind:this={inputRef}
    id="global-search-input"
    type="text"
    role="combobox"
    aria-expanded={store.open}
    aria-controls="global-search-listbox"
    aria-activedescendant={store.resultCount > 0 ? `gs-opt-${store.activeIndex}` : undefined}
    autocomplete="off"
    spellcheck="false"
    placeholder="Search everything…"
    value={store.query}
    oninput={(e) => store.setQuery((e.target as HTMLInputElement).value)}
    onfocus={() => store.openPanel()}
    onkeydown={onInputKeydown}
    class="h-9 w-full rounded-lg border py-1.5 pl-9 pr-16 text-sm outline-none transition focus:ring-2 focus:ring-brand-500/20 {inputClass}"
  />

  {#if store.hasQuery}
    <button
      type="button"
      onclick={() => {
        store.clear();
        inputRef?.focus();
      }}
      class="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-sm transition {dark
        ? 'text-slate-400 hover:bg-slate-800 hover:text-white'
        : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}"
      aria-label="Clear search"
      title="Clear search"
    >
      ×
    </button>
  {:else}
    <kbd
      class="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border px-1.5 py-0.5 text-[10px] font-medium sm:block {kbdClass}"
      aria-hidden="true"
    >
      ⌘K
    </kbd>
  {/if}

  {#if store.open}
    <div
      bind:this={panelRef}
      id="global-search-listbox"
      role="listbox"
      aria-label="Search results"
      class="absolute left-0 right-0 top-11 z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-950/15"
    >
      {#if store.error}
        <p class="px-3 py-6 text-center text-sm text-rose-600">{store.error}</p>
      {:else if store.loading && store.resultCount === 0}
        <p class="px-3 py-6 text-center text-sm text-slate-500">Building index…</p>
      {:else if !store.hasQuery}
        <div class="px-3 py-6 text-center">
          <p class="text-sm font-medium text-slate-600">Search the whole model</p>
          <p class="mt-1 text-xs text-slate-400">
            Projects, features, surfaces, actions, state, rules, effects, personas, entities — anything.
          </p>
        </div>
      {:else if store.resultCount === 0}
        <p class="px-3 py-6 text-center text-sm text-slate-500">
          No matches for “{store.query.trim()}”.
        </p>
      {:else}
        {#each indexedGroups as group (group.kind)}
          <p
            class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
          >
            {group.meta.label} ({group.rows.length})
          </p>
          {#each group.rows as row (row.doc.id)}
            {@const active = row.index === store.activeIndex}
            <button
              type="button"
              id={`gs-opt-${row.index}`}
              role="option"
              aria-selected={active}
              onmouseenter={() => store.setActive(row.index)}
              onclick={() => navigate(row.doc)}
              class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition {active
                ? 'bg-slate-100'
                : 'hover:bg-slate-50'}"
            >
              <span
                class="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-50 {group.meta.accent}"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d={group.meta.icon} />
                </svg>
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-slate-900">
                  {row.doc.title}
                </span>
                {#if row.doc.subtitle || crumb(row.doc)}
                  <span class="block truncate text-[11px] text-slate-500">
                    {#if crumb(row.doc)}<span class="text-slate-400">{crumb(row.doc)}</span>{/if}
                    {#if crumb(row.doc) && row.doc.subtitle}<span class="text-slate-300"> · </span>{/if}
                    {#if row.doc.subtitle}{row.doc.subtitle}{/if}
                  </span>
                {/if}
              </span>
              <span
                class="shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-500"
              >
                {group.meta.label}
              </span>
            </button>
          {/each}
        {/each}
      {/if}
    </div>
  {/if}
</div>
