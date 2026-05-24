<script lang="ts" module>
  // Module-scoped counter so each TagList instance gets a unique datalist id
  // without relying on crypto/SSR-fragile randomness.
  let nextDatalistSerial = 0;
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import type { Tag } from '$shared/domain/Tags';

  type Props = {
    tags?: readonly Tag[];
    onAddTag?: (type: string, value: string) => void | Promise<void>;
    onRemoveTag?: (type: string, value: string) => void | Promise<void>;
    typeOptions?: readonly string[];
    addLabel?: string;
  };

  let { tags, onAddTag, onRemoveTag, typeOptions = [], addLabel = '+ Tag' }: Props = $props();

  let editing = $state(false);
  let typeDraft = $state('');
  let valueDraft = $state('');
  let typeInput = $state<HTMLInputElement | null>(null);

  const datalistId = `taglist-types-${++nextDatalistSerial}`;

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

  const hasTags = $derived(Boolean(tags && tags.length > 0));
</script>

{#if hasTags || onAddTag}
  <div class="flex flex-wrap items-center gap-1">
    {#if tags}
      {#each tags as tag}
        <span
          class="group/chip inline-flex h-5 max-w-full items-stretch overflow-hidden rounded-md text-[11px] font-medium ring-1 ring-inset ring-emerald-200/70"
          title={`${tag.type} — ${tag.value}`}
        >
          <span class="flex items-center bg-emerald-100/80 px-1.5 text-[9px] uppercase leading-none tracking-wider text-emerald-700">
            {tag.type}
          </span>
          <span class="flex items-center bg-emerald-50 px-1.5 leading-none text-emerald-800">
            <span class="truncate">{tag.value}</span>
          </span>
          {#if onRemoveTag}
            <button
              type="button"
              class="flex w-0 items-center justify-center overflow-hidden bg-emerald-50 leading-none text-emerald-700 opacity-0 transition-all duration-150 group-hover/chip:w-4 group-hover/chip:pr-1 group-hover/chip:opacity-100 hover:bg-red-100! hover:text-red-700!"
              onclick={() => onRemoveTag?.(tag.type, tag.value)}
              aria-label={`Remove tag ${tag.type}: ${tag.value}`}
              title="Remove tag"
            >
              Ã-
            </button>
          {/if}
        </span>
      {/each}
    {/if}
    {#if onAddTag}
      {#if !editing}
        <button
          type="button"
          class="inline-flex h-5 items-center rounded-md border border-dashed border-slate-300 px-1.5 text-[11px] font-medium text-slate-500 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700"
          class:opacity-100={!hasTags}
          onclick={openEditor}
          aria-label="Add tag"
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
