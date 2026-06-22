<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * One row inside a {@link KebabMenu}. `danger` paints it as a destructive
   * action (e.g. Delete). Keep the label content in the `children` snippet so
   * call sites can prepend a small glyph.
   */
  type Props = {
    onclick: () => void;
    danger?: boolean;
    disabled?: boolean;
    children: Snippet;
  };

  let { onclick, danger = false, disabled = false, children }: Props = $props();
</script>

<button
  type="button"
  role="menuitem"
  {disabled}
  {onclick}
  class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 {danger
    ? 'text-red-600 hover:bg-red-50'
    : 'text-slate-700 hover:bg-slate-50'}"
>
  {@render children()}
</button>
