<script lang="ts">
  import type { StatePath } from '$features/behavior-model/domain/value-objects/StatePath';

  type Props = {
    value: string;
    availablePaths: readonly StatePath[];
    listId: string;
    onCommit: (raw: string) => void;
    placeholder?: string;
    width?: string;
  };

  let { value, availablePaths, listId, onCommit, placeholder = 'state.path', width = 'w-44' }: Props =
    $props();

  let draft = $state('');
  $effect(() => {
    draft = value;
  });

  const knownSet = $derived(new Set(availablePaths as readonly string[]));
  const isKnown = $derived(draft.trim() === '' ? true : knownSet.has(draft));
</script>

<div class="flex flex-col gap-0.5">
  <input
    type="text"
    list={listId}
    class="mono {width} rounded-md border px-2 py-1 text-xs {isKnown
      ? 'border-neutral-300'
      : 'border-amber-400 bg-amber-50'}"
    value={draft}
    oninput={(e) => (draft = (e.target as HTMLInputElement).value)}
    onblur={(e) => onCommit((e.target as HTMLInputElement).value)}
    {placeholder}
  />
  <datalist id={listId}>
    {#each availablePaths as p}
      <option value={p}></option>
    {/each}
  </datalist>
  {#if !isKnown}
    <span class="text-[10px] text-amber-700">Not defined on this surface</span>
  {/if}
</div>
