<script lang="ts">
  import { humanizeStatePath } from '$features/behavior-model/domain/value-objects/humanize';
  import type { StatePath } from '$features/behavior-model/domain/value-objects/StatePath';

  type Props = {
    value: string;
    availablePaths: readonly StatePath[];
    onCommit: (raw: string) => void;
    placeholder?: string;
    width?: string;
  };

  let {
    value,
    availablePaths,
    onCommit,
    placeholder = 'state.path',
    width = 'min-w-44'
  }: Props = $props();

  const CUSTOM = '__custom__';

  const knownSet = $derived(new Set<string>(availablePaths as readonly string[]));
  const isCustom = $derived(value.length > 0 && !knownSet.has(value));

  // When `isCustom` flips because of an external value change, sync the local
  // edit-mode state. We keep a separate "in custom mode" flag so the user can
  // also opt into custom from a known value.
  let customMode = $state(false);
  $effect(() => {
    customMode = isCustom;
  });

  function handleSelect(raw: string) {
    if (raw === CUSTOM) {
      customMode = true;
      // don't commit yet. Wait for the input value
      return;
    }
    customMode = false;
    onCommit(raw);
  }

  function handleCustomBlur(raw: string) {
    onCommit(raw);
  }

  function backToList() {
    customMode = false;
    if (knownSet.has(value)) return;
    // Picking the first available path is friendlier than leaving the field
    // empty when the user toggles back to the list.
    const first = availablePaths[0];
    if (first) onCommit(first);
  }
</script>

<div class="flex flex-col gap-0.5">
  {#if !customMode && availablePaths.length > 0}
    <select
      class="{width} rounded-md border border-neutral-300 px-2 py-1 text-xs"
      value={knownSet.has(value) ? value : ''}
      onchange={(e) => handleSelect((e.target as HTMLSelectElement).value)}
    >
      {#if !knownSet.has(value)}
        <option value="" disabled>- pick a state -</option>
      {/if}
      {#each availablePaths as p}
        <option value={p} title={p}>{humanizeStatePath(p)}</option>
      {/each}
      <option value={CUSTOM}>Custom path…</option>
    </select>
    {#if knownSet.has(value)}
      <span class="mono text-[10px] text-neutral-400" title="Canonical state path">{value}</span>
    {/if}
  {:else}
    <input
      type="text"
      class="mono {width} rounded-md border px-2 py-1 text-xs {isCustom
        ? 'border-amber-400 bg-amber-50'
        : 'border-neutral-300'}"
      {value}
      onblur={(e) => handleCustomBlur((e.target as HTMLInputElement).value)}
      {placeholder}
    />
    <div class="flex items-center gap-2">
      {#if availablePaths.length > 0}
        <button
          type="button"
          class="text-[10px] text-brand-700 hover:underline"
          onclick={backToList}
        >
          ↩ Pick from list
        </button>
      {/if}
      {#if isCustom}
        <span class="text-[10px] text-amber-700">Not defined on this surface</span>
      {/if}
    </div>
  {/if}
</div>
