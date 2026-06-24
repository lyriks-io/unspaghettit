<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type {
    ElementType,
    Provenance,
    SourceSpan
  } from '$features/source-provenance/domain/Provenance';
  import { enumerateFeatureElements } from '$features/source-provenance/domain/FeatureElements';
  import { toHighlightedLines } from '$features/source-provenance/domain/Highlighting';

  type Props = {
    feature: Feature;
    provenance: Provenance | null;
    loading?: boolean;
    refreshing?: boolean;
    error?: string | null;
    onRefresh?: () => void;
  };

  let {
    feature,
    provenance,
    loading = false,
    refreshing = false,
    error = null,
    onRefresh
  }: Props = $props();

  // Local UI state — the "Source Viewer" surface's state paths, kept client-side.
  let selectedElementId = $state<string | null>(null);
  let highlightsVisible = $state(true);
  let filterType = $state<ElementType | 'all'>('all');
  let codeEl = $state<HTMLDivElement | null>(null);

  const TYPE_STYLE: Record<ElementType, { chip: string; mark: string; dot: string }> = {
    surface: { chip: 'bg-indigo-100 text-indigo-800', mark: 'bg-indigo-100', dot: 'bg-indigo-400' },
    action: { chip: 'bg-cyan-100 text-cyan-800', mark: 'bg-cyan-100', dot: 'bg-cyan-400' },
    rule: { chip: 'bg-amber-100 text-amber-800', mark: 'bg-amber-100', dot: 'bg-amber-400' },
    invariant: { chip: 'bg-rose-100 text-rose-800', mark: 'bg-rose-100', dot: 'bg-rose-400' },
    transition: { chip: 'bg-violet-100 text-violet-800', mark: 'bg-violet-100', dot: 'bg-violet-400' },
    state: { chip: 'bg-emerald-100 text-emerald-800', mark: 'bg-emerald-100', dot: 'bg-emerald-400' },
    event: { chip: 'bg-sky-100 text-sky-800', mark: 'bg-sky-100', dot: 'bg-sky-400' },
    entity: { chip: 'bg-slate-200 text-slate-800', mark: 'bg-slate-200', dot: 'bg-slate-400' },
    effect: { chip: 'bg-neutral-200 text-neutral-800', mark: 'bg-neutral-200', dot: 'bg-neutral-400' }
  };

  const elements = $derived(enumerateFeatureElements(feature));
  const labelById = $derived(new Map(elements.map((e) => [e.id, e.label])));
  const file = $derived(provenance?.file ?? null);
  const allSpans = $derived(file ? provenance!.spans : []);
  const sortedSpans = $derived([...allSpans].sort((a, b) => a.startOffset - b.startOffset));

  const presentTypes = $derived(
    [...new Set(allSpans.map((s) => s.elementType))].sort() as ElementType[]
  );
  const activeSpans = $derived(
    filterType === 'all' ? allSpans : allSpans.filter((s) => s.elementType === filterType)
  );
  const visibleSpans = $derived(highlightsVisible ? activeSpans : []);
  const lines = $derived(file ? toHighlightedLines(file.content, visibleSpans) : []);

  const tracedCount = $derived(allSpans.length);
  const totalCount = $derived(elements.length);

  const labelFor = (span: SourceSpan): string => labelById.get(span.elementId) ?? span.elementId;

  const formatBytes = (n: number): string =>
    n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

  function selectElement(id: string): void {
    selectedElementId = id;
    const span = allSpans.find((s) => s.elementId === id);
    if (span && codeEl) {
      codeEl
        .querySelector(`[data-line="${span.startLine}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
</script>

{#if loading}
  <div class="mx-auto max-w-3xl px-4 py-12 text-sm text-slate-500">Loading source…</div>
{:else if error}
  <div class="mx-auto max-w-3xl px-4 py-12 text-sm text-red-600">{error}</div>
{:else if !file}
  <div class="mx-auto max-w-2xl px-4 py-12 text-center">
    <p class="text-sm font-medium text-slate-700">No source file stored for this feature yet.</p>
    <p class="mt-2 text-sm text-slate-500">
      When an agent analyzes a file, it stores it with the
      <code class="rounded bg-slate-100 px-1 py-0.5 text-xs">attach_source_file</code> MCP tool and
      stamps each extracted element with
      <code class="rounded bg-slate-100 px-1 py-0.5 text-xs">record_element_span</code>. The
      highlighted source then appears here.
    </p>
    {#if onRefresh}
      <button
        type="button"
        class="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        onclick={onRefresh}
      >
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    {/if}
  </div>
{:else}
  <section class="mx-auto max-w-7xl space-y-4 px-4 py-6">
    <header
      class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5"
    >
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h2 class="truncate font-mono text-sm font-semibold text-slate-900">{file.fileName}</h2>
          {#if provenance?.finalized}
            <span class="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
              Finalized
            </span>
          {/if}
        </div>
        <p class="mt-0.5 text-xs text-slate-500">
          {formatBytes(file.byteLength)} · {tracedCount}/{totalCount} elements traced · hash {file.contentHash}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <input type="checkbox" bind:checked={highlightsVisible} class="accent-brand-700" />
          Highlights
        </label>
        <select
          bind:value={filterType}
          class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
          aria-label="Filter highlights by element type"
        >
          <option value="all">All types</option>
          {#each presentTypes as type (type)}
            <option value={type}>{type}</option>
          {/each}
        </select>
        {#if onRefresh}
          <button
            type="button"
            class="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onclick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        {/if}
      </div>
    </header>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_18rem]">
      <!-- Source with highlights -->
      <div
        bind:this={codeEl}
        class="max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-950/5"
      >
        <div class="min-w-max font-mono text-xs leading-5">
          {#each lines as line (line.number)}
            <div class="flex" data-line={line.number}>
              <span
                class="w-12 shrink-0 select-none border-r border-slate-100 px-2 text-right text-slate-300"
              >
                {line.number}
              </span>
              <span class="whitespace-pre px-3">
                {#if line.tokens.length === 0}
                  {' '}
                {:else}
                  {#each line.tokens as token, i (i)}
                    {#if token.span}
                      <button
                        type="button"
                        class={`rounded-sm ${TYPE_STYLE[token.span.elementType].mark} ${
                          selectedElementId === token.span.elementId
                            ? 'ring-2 ring-brand-500'
                            : 'hover:brightness-95'
                        }`}
                        title={`${token.span.elementType}: ${labelFor(token.span)}`}
                        onclick={() => selectElement(token.span!.elementId)}
                      >{token.text}</button>
                    {:else}{token.text}{/if}
                  {/each}
                {/if}
              </span>
            </div>
          {/each}
        </div>
      </div>

      <!-- Span list -->
      <aside
        class="max-h-[70vh] space-y-1 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm shadow-slate-950/5"
      >
        <p class="px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Extracted from ({sortedSpans.length})
        </p>
        {#if sortedSpans.length === 0}
          <p class="px-1 py-2 text-xs text-slate-500">No spans recorded yet.</p>
        {:else}
          {#each sortedSpans as span (span.id)}
            <button
              type="button"
              class={`flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
                selectedElementId === span.elementId
                  ? 'border-brand-300 bg-brand-50'
                  : 'border-transparent hover:bg-slate-50'
              }`}
              onclick={() => selectElement(span.elementId)}
            >
              <span class={`mt-1 h-2 w-2 shrink-0 rounded-full ${TYPE_STYLE[span.elementType].dot}`}></span>
              <span class="min-w-0">
                <span class="block truncate text-xs font-medium text-slate-800">{labelFor(span)}</span>
                <span class="mt-0.5 flex items-center gap-1.5">
                  <span class={`rounded px-1 py-0.5 text-[10px] font-medium ${TYPE_STYLE[span.elementType].chip}`}>
                    {span.elementType}
                  </span>
                  <span class="text-[10px] text-slate-400">
                    L{span.startLine}{span.endLine !== span.startLine ? `–${span.endLine}` : ''}
                  </span>
                </span>
              </span>
            </button>
          {/each}
        {/if}
      </aside>
    </div>
  </section>
{/if}
