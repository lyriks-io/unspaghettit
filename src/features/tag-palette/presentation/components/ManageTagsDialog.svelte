<script lang="ts">
  import type { TagColor } from '$shared/domain/TagPalette';
  import { humanizeTagText, tagKey, tagLabel, type Tag } from '$shared/domain/Tags';
  import { tagPaletteStore } from '$features/tag-palette/presentation/stores/tagPaletteStore.svelte';
  import TagSwatch from '$features/tag-palette/presentation/components/TagSwatch.svelte';
  import TagColorPicker from '$features/tag-palette/presentation/components/TagColorPicker.svelte';

  type Props = {
    open: boolean;
    tags: readonly Tag[];
    onClose: () => void;
    onRenamed?: (info: {
      readonly from: Tag;
      readonly to: Tag;
      readonly projectsUpdated: number;
      readonly featuresUpdated: number;
    }) => void | Promise<void>;
  };

  let { open, tags, onClose, onRenamed }: Props = $props();

  type RenameState = {
    readonly tag: Tag;
    type: string;
    value: string;
    busy: boolean;
    error: string | null;
  };

  let renaming = $state<RenameState | null>(null);

  // Group tags by normalized type so a type's color picker shows once and
  // its rows lists every distinct value beneath it.
  const grouped = $derived.by(() => {
    const byType = new Map<string, { tags: Tag[] }>();
    for (const tag of tags) {
      const key = tag.type.trim().toLowerCase();
      if (!key) continue;
      const existing = byType.get(key);
      if (existing) {
        if (!existing.tags.some((t) => tagKey(t) === tagKey(tag))) existing.tags.push(tag);
      } else {
        byType.set(key, { tags: [tag] });
      }
    }
    return [...byType.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => ({
        key,
        display: humanizeTagText(key),
        tags: [...group.tags].sort((a, b) =>
          a.value.localeCompare(b.value)
        )
      }));
  });

  async function setColor(type: string, color: TagColor | null) {
    try {
      await tagPaletteStore.setTypeColor(type, color);
    } catch (e) {
      console.error('Failed to set tag color', e);
    }
  }

  function startRename(tag: Tag) {
    // Pre-fill the inputs with the humanized form so the user edits what they
    // see on the cards. Saving normalizes back to lowercase.
    renaming = {
      tag,
      type: humanizeTagText(tag.type),
      value: humanizeTagText(tag.value),
      busy: false,
      error: null
    };
  }

  function cancelRename() {
    renaming = null;
  }

  async function confirmRename() {
    const current = renaming;
    if (!current) return;
    const from = current.tag;
    const to: Tag = {
      type: current.type.trim(),
      value: current.value.trim()
    };
    if (!to.type || !to.value) {
      renaming = { ...current, error: 'Type and value are required' };
      return;
    }
    if (tagKey(from) === tagKey(to)) {
      renaming = null;
      return;
    }
    renaming = { ...current, busy: true, error: null };
    try {
      const result = await tagPaletteStore.renameTag(from, to);
      renaming = null;
      await onRenamed?.({
        from,
        to,
        projectsUpdated: result.projectsUpdated,
        featuresUpdated: result.featuresUpdated
      });
    } catch (e) {
      renaming = { ...current, busy: false, error: (e as Error).message };
    }
  }

  function handleKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (renaming) cancelRename();
      else onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
  <div
    class="fixed inset-0 z-40 flex items-start justify-center bg-slate-950/30 px-4 py-16 backdrop-blur-sm"
    role="presentation"
    onclick={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}
  >
    <div
      class="w-full max-w-2xl overflow-hidden rounded-xl border border-hairline bg-white shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-tags-title"
    >
      <header class="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
        <div>
          <h2 id="manage-tags-title" class="text-base font-semibold text-slate-950">
            Manage tags
          </h2>
          <p class="mt-1 text-sm text-slate-500">
            Set a color per tag type, or rename a tag everywhere it appears.
          </p>
        </div>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          onclick={onClose}
          aria-label="Close"
        >
          x
        </button>
      </header>

      <div class="max-h-[60vh] overflow-y-auto px-5 py-4">
        {#if grouped.length === 0}
          <p class="text-sm text-slate-500">
            No tags yet. Add a tag to a project or feature to start grouping.
          </p>
        {:else}
          <ul class="space-y-5">
            {#each grouped as group (group.key)}
              {@const active = tagPaletteStore.colorFor(group.key)}
              <li class="space-y-2">
                <div class="flex items-center justify-between gap-3">
                  <div class="flex min-w-0 items-center gap-2">
                    <TagSwatch color={active} size={2.5} />
                    <span class="truncate text-sm font-semibold text-slate-900">
                      {group.display}
                    </span>
                    <span class="text-xs text-slate-500">
                      ({group.tags.length} value{group.tags.length === 1 ? '' : 's'})
                    </span>
                  </div>
                  <TagColorPicker
                    value={active}
                    onChange={(next) => setColor(group.key, next)}
                    label={group.display}
                  />
                </div>

                <ul class="space-y-1 pl-5">
                  {#each group.tags as tag (tagKey(tag))}
                    <li class="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm hover:bg-slate-50">
                      <span class="truncate text-slate-700" title={tagLabel(tag)}>
                        {humanizeTagText(tag.value)}
                      </span>
                      <button
                        type="button"
                        class="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        onclick={() => startRename(tag)}
                      >
                        Rename
                      </button>
                    </li>
                  {/each}
                </ul>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <footer class="flex items-center justify-end gap-2 border-t border-hairline bg-slate-50 px-5 py-3">
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          onclick={onClose}
        >
          Done
        </button>
      </footer>
    </div>
  </div>

  {#if renaming}
    <div
      class="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/40 px-4 py-24 backdrop-blur-sm"
      role="presentation"
      onclick={(event) => {
        if (event.currentTarget === event.target && !renaming?.busy) cancelRename();
      }}
    >
      <div
        class="w-full max-w-md overflow-hidden rounded-xl border border-hairline bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-tag-title"
      >
        <header class="border-b border-hairline px-5 py-4">
          <h3 id="rename-tag-title" class="text-base font-semibold text-slate-950">
            Rename "{tagLabel(renaming.tag)}"
          </h3>
          <p class="mt-1 text-xs text-slate-500">
            Updates every project and feature that uses this tag.
          </p>
        </header>
        <div class="space-y-3 px-5 py-4">
          <label class="block text-sm">
            <span class="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Type</span>
            <input
              type="text"
              bind:value={renaming.type}
              class="h-9 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-brand-700"
              disabled={renaming.busy}
            />
          </label>
          <label class="block text-sm">
            <span class="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Value</span>
            <input
              type="text"
              bind:value={renaming.value}
              class="h-9 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-brand-700"
              disabled={renaming.busy}
            />
          </label>
          {#if renaming.error}
            <p class="text-sm text-red-700">{renaming.error}</p>
          {/if}
        </div>
        <footer class="flex items-center justify-end gap-2 border-t border-hairline bg-slate-50 px-5 py-3">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            onclick={cancelRename}
            disabled={renaming.busy}
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            onclick={confirmRename}
            disabled={renaming.busy}
          >
            {renaming.busy ? 'Renaming...' : 'Rename everywhere'}
          </button>
        </footer>
      </div>
    </div>
  {/if}
{/if}
