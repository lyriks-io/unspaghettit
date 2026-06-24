<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { useFeatureQueueContext } from '$features/behavior-model/presentation/context/featureQueueContext';
  import TagDotStrip from '$features/tag-palette/presentation/components/TagDotStrip.svelte';
  import { tagPaletteStore } from '$features/tag-palette/presentation/stores/tagPaletteStore.svelte';

  type Props = {
    feature: Feature;
    saving: boolean;
    historyOpen?: boolean;
    onToggleHistory?: () => void;
  };
  let { feature, saving, historyOpen = false, onToggleHistory }: Props = $props();

  const queueCtx = useFeatureQueueContext();
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const modKey = isMac ? 'Cmd' : 'Ctrl';
  const undoTitle = `Undo (${modKey}+Z)`;
  const redoTitle = `Redo (${modKey}+Shift+Z)`;

  let editing = $state(false);
  let nameDraft = $state('');
  let descriptionDraft = $state('');

  $effect(() => {
    if (!feature) return;
    if (!editing) {
      nameDraft = feature.name;
      descriptionDraft = feature.description ?? '';
    }
  });

  // Register this feature's tag types with the palette store so auto-color
  // assignment stays consistent with the index pages.
  $effect(() => {
    const tags = feature?.tags ?? [];
    if (tags.length > 0) tagPaletteStore.registerTypes(tags.map((t) => t.type));
  });

  async function saveMeta() {
    const name = nameDraft.trim();
    if (name.length === 0) return;
    await featureStore.mutate((current) => ({
      ...current,
      name,
      description: descriptionDraft.trim() || undefined
    }));
    editing = false;
  }

  // Back link target depends on context: when this feature belongs to a
  // project, "Back" returns to the project it was opened from; otherwise
  // it falls back to the all-features list.
  const backHref = $derived(
    queueCtx.project ? `/projects/${queueCtx.project.id}` : '/features'
  );
  const backLabel = $derived(
    queueCtx.project
      ? `Back to ${queueCtx.project.name}`
      : 'Back to features'
  );
</script>

<header class="border-b border-slate-200 pb-4">
<div class="flex flex-wrap items-start justify-between gap-3">
  <div class="min-w-0 flex-1 space-y-1">
    <a href={backHref} class="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand-700 hover:underline">
      <span aria-hidden="true">←</span>
      {backLabel}
    </a>
    {#if editing}
      <input
        type="text"
        bind:value={nameDraft}
        class="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-2xl font-semibold outline-none focus:border-slate-900"
      />
      <input
        type="text"
        bind:value={descriptionDraft}
        placeholder="Short description"
        class="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-600 outline-none focus:border-slate-900"
      />
      <div class="flex gap-2 pt-1">
        <button type="button" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white" onclick={saveMeta}>
          Save
        </button>
        <button
          type="button"
          class="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          onclick={() => (editing = false)}
        >
          Cancel
        </button>
      </div>
    {:else}
      <h1 class="truncate text-3xl font-semibold tracking-tight text-slate-950">{feature.name}</h1>
      {#if feature.description}
        <p class="max-w-3xl text-sm leading-6 text-slate-600">{feature.description}</p>
      {/if}
      {#if feature.tags && feature.tags.length > 0}
        <div class="pt-1">
          <TagDotStrip tags={feature.tags} />
        </div>
      {/if}
      <div class="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <button class="font-medium text-brand-700 hover:underline" onclick={() => (editing = true)}>Edit metadata</button>
        <span>{saving ? 'Saving…' : 'Saved'}</span>
      </div>
    {/if}
  </div>

  <div class="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm shadow-slate-950/5">
    <div class="flex rounded-lg border border-hairline bg-white p-1">
      <a
        href={`/features/${feature.id}/graph`}
        title="Open behavior graph"
        aria-label="Open behavior graph"
        class="rounded-md px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Graph
      </a>
      <a
        href={`/features/${feature.id}/verify`}
        title="Verify this feature (scenarios, model check, drift)"
        aria-label="Verify this feature"
        class="rounded-md px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Verify
      </a>
      <a
        href={`/features/${feature.id}/provenance`}
        title="See the analyzed source file with each extracted element highlighted"
        aria-label="Open source provenance"
        class="rounded-md px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Source
      </a>
      <button
        type="button"
        title={undoTitle}
        aria-label={undoTitle}
        class="rounded-md px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!featureStore.canUndo}
        onclick={() => featureStore.undo()}
      >
        Undo
      </button>
      <button
        type="button"
        title={redoTitle}
        aria-label={redoTitle}
        class="rounded-md px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!featureStore.canRedo}
        onclick={() => featureStore.redo()}
      >
        Redo
      </button>
      <button
        type="button"
        title="Show history"
        aria-label="Show history"
        aria-pressed={historyOpen}
        class="rounded-md px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 {historyOpen ? 'bg-slate-100' : ''}"
        onclick={() => onToggleHistory?.()}
      >
        History {featureStore.historyEntries.length}
      </button>
    </div>
  </div>
</div>
</header>
