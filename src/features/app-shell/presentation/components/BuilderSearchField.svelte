<script lang="ts">
  import { builderModeStore } from '$features/builder-mode/presentation/stores/builderModeStore.svelte';

  /**
   * Builder mode's search input, bound to the builder store's local filter.
   * Rendered twice by the header (desktop center slot and the mobile strip
   * below it), so the id for the label/input pairing must differ per instance.
   */
  type Props = {
    id: string;
    /** Extra classes on the positioning wrapper (e.g. desktop max width). */
    class?: string;
  };

  let { id, class: wrapperClass = '' }: Props = $props();

  const search = $derived(builderModeStore.search);
</script>

<label for={id} class="sr-only">Search builder</label>
<div class="relative {wrapperClass}">
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
  <input
    {id}
    type="search"
    placeholder="Search..."
    value={search}
    oninput={(e) => builderModeStore.setSearch((e.target as HTMLInputElement).value)}
    class="h-9 w-full rounded-lg border border-slate-700 bg-slate-900/70 py-1.5 pl-9 pr-9 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
  />
  {#if search.trim().length > 0}
    <button
      type="button"
      onclick={() => builderModeStore.clearSearch()}
      class="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-500 transition hover:bg-slate-800 hover:text-white"
      aria-label="Clear builder search"
      title="Clear search"
    >
      ×
    </button>
  {/if}
</div>
