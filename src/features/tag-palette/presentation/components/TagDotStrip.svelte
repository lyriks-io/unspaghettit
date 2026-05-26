<script lang="ts" module>
  let nextDatalistSerial = 0;
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { humanizeTagText, tagLabel, type Tag } from '$shared/domain/Tags';
  import { tagPaletteStore } from '$features/tag-palette/presentation/stores/tagPaletteStore.svelte';
  import { stylesFor } from '$features/tag-palette/presentation/services/tagColorStyles';
  import TagSwatch from '$features/tag-palette/presentation/components/TagSwatch.svelte';

  type Props = {
    tags?: readonly Tag[];
    onAddTag?: (type: string, value: string) => void | Promise<void>;
    onRemoveTag?: (type: string, value: string) => void | Promise<void>;
    typeOptions?: readonly string[];
    addLabel?: string;
  };

  let {
    tags,
    onAddTag,
    onRemoveTag,
    typeOptions = [],
    addLabel = '+'
  }: Props = $props();

  let editing = $state(false);
  let typeDraft = $state('');
  let valueDraft = $state('');
  let typeInput = $state<HTMLInputElement | null>(null);

  const datalistId = `tagdotstrip-types-${++nextDatalistSerial}`;

  const hasTags = $derived(Boolean(tags && tags.length > 0));

  async function openEditor() {
    editing = true;
    await tick();
    typeInput?.focus();
  }

  function cancel() {
    editing = false;
    typeDraft = '';
    valueDraft = '';
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const type = typeDraft.trim();
    const value = valueDraft.trim();
    if (!type || !value) return;
    await onAddTag?.(type, value);
    cancel();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') cancel();
  }
</script>

{#if hasTags || onAddTag}
  <div class="flex flex-wrap items-center gap-1.5">
    {#if tags}
      {#each tags as tag}
        {@const color = tagPaletteStore.colorForTag(tag)}
        {@const style = stylesFor(color)}
        <span
          class="group/chip inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style="background-color: {style.pillBackground}; color: {style.pillText}; box-shadow: inset 0 0 0 1px {style.pillRing};"
          title={tagLabel(tag)}
        >
          <TagSwatch {color} size={1.5} />
          <span class="truncate">{humanizeTagText(tag.value)}</span>
          {#if onRemoveTag}
            <button
              type="button"
              class="ml-0.5 flex size-3 shrink-0 items-center justify-center rounded-full text-[9px] leading-none opacity-0 transition group-hover/chip:opacity-70 hover:opacity-100! hover:bg-white/60"
              onclick={() => onRemoveTag?.(tag.type, tag.value)}
              aria-label={`Remove tag ${tagLabel(tag)}`}
              title={`Remove ${tagLabel(tag)}`}
            >
              &times;
            </button>
          {/if}
        </span>
      {/each}
    {/if}

    {#if onAddTag}
      {#if !editing}
        <button
          type="button"
          class="inline-flex h-4 items-center rounded-sm px-1 text-[10px] font-medium text-slate-400 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-slate-100 hover:text-slate-700"
          class:opacity-100={!hasTags}
          onclick={openEditor}
          aria-label="Add tag"
          title="Add tag"
        >
          {addLabel}
        </button>
      {:else}
        <form class="inline-flex items-center gap-1" onsubmit={submit}>
          <input
            bind:this={typeInput}
            type="text"
            bind:value={typeDraft}
            placeholder="Type"
            list={typeOptions.length > 0 ? datalistId : undefined}
            onkeydown={onKey}
            class="h-5.5 w-20 rounded border border-slate-300 px-1.5 text-[11px] outline-none focus:border-brand-700"
          />
          {#if typeOptions.length > 0}
            <datalist id={datalistId}>
              {#each typeOptions as option (option)}
                <option value={option}></option>
              {/each}
            </datalist>
          {/if}
          <input
            type="text"
            bind:value={valueDraft}
            placeholder="Value"
            onkeydown={onKey}
            class="h-5.5 w-24 rounded border border-slate-300 px-1.5 text-[11px] outline-none focus:border-brand-700"
          />
          <button
            type="submit"
            class="h-5.5 rounded bg-slate-900 px-2 text-[11px] font-medium text-white disabled:opacity-40"
            disabled={typeDraft.trim().length === 0 || valueDraft.trim().length === 0}
          >
            Add
          </button>
          <button
            type="button"
            class="h-5.5 rounded px-1 text-[11px] text-slate-500 hover:text-slate-800"
            onclick={cancel}
          >
            Cancel
          </button>
        </form>
      {/if}
    {/if}
  </div>
{/if}
