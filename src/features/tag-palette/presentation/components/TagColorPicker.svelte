<script lang="ts">
  import type { TagColor } from '$shared/domain/TagPalette';
  import { normalizeTagColor } from '$shared/domain/TagPalette';
  import { TAG_PRESETS } from '$features/tag-palette/presentation/services/tagPresets';
  import TagSwatch from '$features/tag-palette/presentation/components/TagSwatch.svelte';

  type Props = {
    value: TagColor | null;
    onChange: (next: TagColor | null) => void;
    /** Used in aria-labels so screen readers know which thing this picks for. */
    label?: string;
  };

  let { value, onChange, label = 'tag' }: Props = $props();

  let open = $state(false);
  let popover = $state<HTMLDivElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);

  function toggle() {
    open = !open;
  }

  function close() {
    open = false;
  }

  // Close on outside click or Escape. Bound only while the popover is open
  // so we don't keep listeners alive for nothing.
  $effect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popover?.contains(target)) return;
      if (trigger?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
    };
  });

  function pick(color: TagColor | null) {
    onChange(color);
    close();
  }

  function handleCustom(event: Event) {
    const next = (event.target as HTMLInputElement).value;
    // Don't close on input so the user can scrub through the picker; commit
    // on change (when they release the picker).
    onChange(normalizeTagColor(next));
  }

  function handleCustomCommit(event: Event) {
    const next = (event.target as HTMLInputElement).value;
    onChange(normalizeTagColor(next));
    close();
  }

  // Browser <input type="color"> needs a non-empty value attribute. When
  // nothing is set yet, seed with a neutral slate so it has a starting point.
  const CUSTOM_FALLBACK: TagColor = '#94a3b8';
</script>

<div class="relative inline-block">
  <button
    bind:this={trigger}
    type="button"
    class="flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-1 ring-inset ring-slate-300 transition hover:ring-slate-500"
    style={value ? `background-color: ${value};` : 'background-color: white;'}
    onclick={toggle}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label={`Pick a color for ${label}`}
    title="Pick a color"
  >
    {#if !value}
      <TagSwatch color={null} size={4} />
    {/if}
  </button>

  {#if open}
    <div
      bind:this={popover}
      class="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-hairline bg-white p-3 shadow-lg"
      role="dialog"
      aria-label="Color picker"
    >
      <p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Presets</p>
      <div class="grid grid-cols-5 gap-2">
        {#each TAG_PRESETS as preset (preset.color)}
          {@const active = value === preset.color}
          <button
            type="button"
            class="flex size-7 items-center justify-center rounded-full ring-offset-2 transition hover:scale-110"
            class:ring-2={active}
            class:ring-slate-900={active}
            style="background-color: {preset.color};"
            onclick={() => pick(preset.color)}
            title={preset.name}
            aria-label={`Set ${label} color to ${preset.name}`}
          ></button>
        {/each}
      </div>

      <div class="mt-3 border-t border-hairline pt-3">
        <label class="flex items-center justify-between gap-2 text-xs text-slate-700">
          <span class="font-medium">Custom</span>
          <input
            type="color"
            value={value ?? CUSTOM_FALLBACK}
            oninput={handleCustom}
            onchange={handleCustomCommit}
            class="h-7 w-12 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
            aria-label={`Custom color for ${label}`}
          />
        </label>
      </div>

      <div class="mt-2">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-red-700 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-600"
          onclick={() => pick(null)}
          disabled={value === null}
        >
          <TagSwatch color={null} size={4} />
          <span>No color</span>
        </button>
      </div>
    </div>
  {/if}
</div>
