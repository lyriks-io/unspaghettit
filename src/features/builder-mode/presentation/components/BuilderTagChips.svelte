<script lang="ts" module>
  let nextDatalistSerial = 0;
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { humanizeTagText, tagKey, tagLabel, type Tag } from '$shared/domain/Tags';
  import { builderModeStore } from '$features/builder-mode/presentation/stores/builderModeStore.svelte';
  import type { TagColor } from '$shared/domain/TagPalette';
  import type { Action } from 'svelte/action';

  /**
   * Smoothly tween the wrapper's height to its content height whenever that
   * content changes — the add `+` appearing on hover, or chips wrapping to a
   * new line. Without this the card would jump in height.
   *
   * While a form is open (`editing`) the wrapper goes `overflow: visible` /
   * `height: auto`: a clipped, fixed-height box throws off the native datalist
   * dropdown's anchor (it renders far from the input) and would clip the form.
   * Honors prefers-reduced-motion.
   */
  const animateHeight: Action<HTMLElement, boolean> = (node, editing = false) => {
    const inner = node.firstElementChild as HTMLElement | null;
    if (!inner) return;
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hasObserver = typeof ResizeObserver !== 'undefined';
    let last = inner.offsetHeight;

    const toOpen = () => {
      // Unclip so inputs and the native type dropdown lay out / anchor correctly.
      node.style.transition = '';
      node.style.overflow = 'visible';
      node.style.height = 'auto';
    };
    const toClipped = () => {
      node.style.overflow = 'hidden';
      if (!hasObserver) {
        node.style.height = 'auto';
        return;
      }
      const start = node.offsetHeight;
      last = inner.offsetHeight;
      if (reduce) {
        node.style.height = `${last}px`;
        return;
      }
      node.style.transition = 'height 240ms cubic-bezier(0.22, 1, 0.36, 1)';
      node.style.height = `${start}px`;
      void node.offsetHeight; // commit the start height before transitioning
      node.style.height = `${last}px`;
    };

    let isEditing = editing;
    if (isEditing) toOpen();
    else {
      node.style.overflow = 'hidden';
      node.style.height = `${last}px`;
      if (!reduce) node.style.transition = 'height 240ms cubic-bezier(0.22, 1, 0.36, 1)';
    }

    let observer: ResizeObserver | null = null;
    if (hasObserver) {
      observer = new ResizeObserver(() => {
        if (isEditing) return; // height:auto handles growth while a form is open
        const next = inner.offsetHeight;
        if (next === last) return;
        if (reduce) {
          node.style.height = `${next}px`;
          last = next;
          return;
        }
        node.style.height = `${last}px`;
        void node.offsetHeight;
        node.style.height = `${next}px`;
        last = next;
      });
      observer.observe(inner);
    } else if (!isEditing) {
      node.style.height = 'auto';
    }

    return {
      update(next: boolean) {
        if (next === isEditing) return;
        isEditing = next;
        if (isEditing) toOpen();
        else toClipped();
      },
      destroy: () => observer?.disconnect()
    };
  };

  let {
    tags,
    onToggle,
    isActive,
    onAdd,
    onRemove,
    onRename,
    typeOptions = [],
    class: className = ''
  }: {
    readonly tags: readonly Tag[];
    readonly onToggle?: (tag: Tag) => void;
    readonly isActive?: (tag: Tag) => boolean;
    readonly onAdd?: (type: string, value: string) => void | Promise<void>;
    readonly onRemove?: (tag: Tag) => void | Promise<void>;
    readonly onRename?: (from: Tag, to: Tag) => void | Promise<void>;
    readonly typeOptions?: readonly string[];
    readonly class?: string;
  } = $props();

  const datalistId = `buildertags-types-${++nextDatalistSerial}`;

  // Mix the palette color toward a deep slate for the dark builder plate (the
  // shared light-theme styles mix toward white). `active` brightens the chip.
  const SLATE = '#64748b';
  const chipStyle = (color: TagColor | null, active: boolean): string => {
    const base = color ?? SLATE;
    const fill = active ? 42 : 20;
    const ring = active ? 72 : 42;
    return [
      `background-color: color-mix(in srgb, ${base} ${fill}%, #0b1220)`,
      `color: color-mix(in srgb, ${base} 72%, white)`,
      `box-shadow: inset 0 0 0 1px color-mix(in srgb, ${base} ${ring}%, transparent)`
    ].join('; ');
  };

  // ── add ──
  let adding = $state(false);
  let addType = $state('');
  let addValue = $state('');
  let addInput = $state<HTMLInputElement | null>(null);

  async function startAdd() {
    adding = true;
    await tick();
    addInput?.focus();
  }
  function cancelAdd() {
    adding = false;
    addType = '';
    addValue = '';
  }
  async function submitAdd(event: SubmitEvent) {
    event.preventDefault();
    const value = addValue.trim();
    if (!value) return;
    const type = addType.trim() || 'tag';
    cancelAdd(); // close the form immediately; the chip appears once persisted
    await onAdd?.(type, value);
  }

  // ── rename (propagates everywhere the tag is used) ──
  let editingKey = $state<string | null>(null);
  let editType = $state('');
  let editValue = $state('');
  let editInput = $state<HTMLInputElement | null>(null);

  async function startEdit(tag: Tag) {
    editingKey = tagKey(tag);
    editType = humanizeTagText(tag.type);
    editValue = humanizeTagText(tag.value);
    await tick();
    editInput?.select();
  }
  function cancelEdit() {
    editingKey = null;
  }
  async function submitEdit(event: SubmitEvent, from: Tag) {
    event.preventDefault();
    const value = editValue.trim();
    const type = editType.trim();
    if (!value || !type) return;
    cancelEdit();
    await onRename?.(from, { type, value });
  }

  function onFormKey(event: KeyboardEvent, cancel: () => void) {
    if (event.key === 'Escape') cancel();
  }
</script>

{#if tags.length > 0 || onAdd}
  <div class={className} use:animateHeight={adding || editingKey !== null}>
    <div class="flex flex-wrap items-center gap-1.5">
    {#each tags as tag (tagKey(tag))}
      {#if editingKey === tagKey(tag)}
        <form class="inline-flex items-center gap-1" onsubmit={(e) => submitEdit(e, tag)}>
          <input
            bind:this={editInput}
            bind:value={editType}
            list={typeOptions.length > 0 ? datalistId : undefined}
            placeholder="Type"
            onkeydown={(e) => onFormKey(e, cancelEdit)}
            class="h-6 w-16 rounded border border-slate-700 bg-slate-900/70 px-1.5 text-[11px] text-slate-200 outline-none focus:border-brand-500"
          />
          <input
            bind:value={editValue}
            placeholder="Value"
            onkeydown={(e) => onFormKey(e, cancelEdit)}
            class="h-6 w-20 rounded border border-slate-700 bg-slate-900/70 px-1.5 text-[11px] text-slate-200 outline-none focus:border-brand-500"
          />
          <button type="submit" class="text-[11px] font-semibold text-brand-300 hover:text-brand-200" title="Rename everywhere">✓</button>
          <button type="button" class="text-[11px] text-slate-500 hover:text-slate-300" onclick={cancelEdit} title="Cancel">✕</button>
        </form>
      {:else}
        {@const color = builderModeStore.colorForTag(tag)}
        {@const active = isActive?.(tag) ?? false}
        <span
          class="group/chip inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-2 pr-1.5 text-[10px] font-medium transition"
          style={chipStyle(color, active)}
        >
          <span class="size-1.5 shrink-0 rounded-full" style="background-color: {color ?? SLATE}"></span>
          {#if onToggle}
            <button
              type="button"
              class="truncate"
              onclick={() => onToggle(tag)}
              aria-pressed={active}
              title={`${tagLabel(tag)} — click to filter`}
            >{humanizeTagText(tag.value)}</button>
          {:else}
            <span class="truncate" title={tagLabel(tag)}>{humanizeTagText(tag.value)}</span>
          {/if}
          {#if onRename}
            <button
              type="button"
              class="shrink-0 opacity-0 transition group-hover/chip:opacity-70 hover:opacity-100!"
              onclick={() => startEdit(tag)}
              aria-label={`Rename ${tagLabel(tag)}`}
              title="Rename (applies everywhere)"
            >✎</button>
          {/if}
          {#if onRemove}
            <button
              type="button"
              class="shrink-0 opacity-0 transition group-hover/chip:opacity-70 hover:opacity-100!"
              onclick={() => onRemove(tag)}
              aria-label={`Remove ${tagLabel(tag)}`}
              title="Remove from this item"
            >✕</button>
          {/if}
        </span>
      {/if}
    {/each}

    {#if onAdd}
      {#if adding}
        <form class="inline-flex items-center gap-1" onsubmit={submitAdd}>
          <input
            bind:this={addInput}
            bind:value={addType}
            list={typeOptions.length > 0 ? datalistId : undefined}
            placeholder="Type"
            onkeydown={(e) => onFormKey(e, cancelAdd)}
            class="h-6 w-16 rounded border border-slate-700 bg-slate-900/70 px-1.5 text-[11px] text-slate-200 outline-none focus:border-brand-500"
          />
          <input
            bind:value={addValue}
            placeholder="Value"
            onkeydown={(e) => onFormKey(e, cancelAdd)}
            class="h-6 w-20 rounded border border-slate-700 bg-slate-900/70 px-1.5 text-[11px] text-slate-200 outline-none focus:border-brand-500"
          />
          <button type="submit" class="text-[11px] font-semibold text-brand-300 hover:text-brand-200" title="Add tag">✓</button>
          <button type="button" class="text-[11px] text-slate-500 hover:text-slate-300" onclick={cancelAdd} title="Cancel">✕</button>
        </form>
      {:else}
        <button
          type="button"
          class="size-5 items-center justify-center rounded-full border border-dashed border-slate-600 text-[11px] leading-none text-slate-400 transition hover:border-brand-500 hover:text-brand-300 hidden group-hover:inline-flex group-focus-within:inline-flex"
          onclick={startAdd}
          aria-label="Add tag"
          title="Add tag"
        >+</button>
      {/if}
    {/if}

    {#if typeOptions.length > 0}
      <datalist id={datalistId}>
        {#each typeOptions as option (option)}
          <option value={option}></option>
        {/each}
      </datalist>
    {/if}
    </div>
  </div>
{/if}
