<script lang="ts">
  type Props = {
    value: string;
    availableNames: readonly string[];
    onCommit: (raw: string) => void;
    placeholder?: string;
    width?: string;
  };

  let {
    value,
    availableNames,
    onCommit,
    placeholder = 'parameterName',
    width = 'min-w-32'
  }: Props = $props();

  const CUSTOM = '__custom__';
  const knownSet = $derived(new Set<string>(availableNames));
  const isCustom = $derived(value.length > 0 && !knownSet.has(value));

  let customMode = $state(false);
  $effect(() => {
    customMode = isCustom;
  });

  function handleSelect(raw: string) {
    if (raw === CUSTOM) {
      customMode = true;
      return;
    }
    customMode = false;
    onCommit(raw);
  }

  function backToList() {
    customMode = false;
    if (knownSet.has(value)) return;
    const first = availableNames[0];
    if (first) onCommit(first);
  }
</script>

<div class="flex flex-col gap-0.5">
  {#if !customMode && availableNames.length > 0}
    <select
      class="{width} rounded-md border border-neutral-300 px-2 py-1 text-xs"
      value={knownSet.has(value) ? value : ''}
      onchange={(e) => handleSelect((e.target as HTMLSelectElement).value)}
    >
      {#if !knownSet.has(value)}
        <option value="" disabled>- pick a parameter -</option>
      {/if}
      {#each availableNames as n}
        <option value={n}>{n}</option>
      {/each}
      <option value={CUSTOM}>Custom name…</option>
    </select>
  {:else}
    <input
      type="text"
      class="mono {width} rounded-md border px-2 py-1 text-xs {isCustom
        ? 'border-amber-400 bg-amber-50'
        : 'border-neutral-300'}"
      {value}
      onblur={(e) => onCommit((e.target as HTMLInputElement).value)}
      {placeholder}
    />
    <div class="flex items-center gap-2">
      {#if availableNames.length > 0}
        <button
          type="button"
          class="text-[10px] text-brand-700 hover:underline"
          onclick={backToList}
        >
          ↩ Pick from list
        </button>
      {/if}
      {#if isCustom}
        <span class="text-[10px] text-amber-700">Not used by any action yet</span>
      {/if}
    </div>
  {/if}
</div>
