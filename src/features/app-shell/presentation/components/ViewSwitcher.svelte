<script lang="ts">
  import { page } from '$app/state';
  import { enabledViews } from '$lib/views/enabled';
  import { themeStore } from '$lib/theme/themeStore.svelte';

  /**
   * Expert/Builder view toggle. Views are registry-driven (Expert is the
   * always-on default; others like Builder are opt-in via PUBLIC_UNSPA_VIEWS).
   * Renders nothing unless more than one view is active - a toggle between one
   * thing is meaningless - and hides under the Lyriks community edition, which
   * presents a single, unswitched view.
   */
  type Props = {
    dark: boolean;
  };

  let { dark }: Props = $props();

  const views = $derived(enabledViews());
  const show = $derived(views.length > 1 && !themeStore.isLyriks);
</script>

{#if show}
  <div
    role="group"
    aria-label="View mode"
    class="flex shrink-0 items-center rounded-full border p-0.5 text-[11px] font-medium {dark
      ? 'border-slate-700/70 bg-slate-800/60'
      : 'border-slate-200 bg-slate-100'}"
  >
    {#each views as view (view.id)}
      {@const active = view.matches(page.url.pathname)}
      <a
        href={view.href}
        class="rounded-full px-2.5 py-0.5 transition {active
          ? dark
            ? 'bg-slate-700 text-white shadow-sm shadow-black/20'
            : 'bg-white text-slate-900 shadow-sm shadow-slate-950/10'
          : dark
            ? 'text-slate-400 hover:text-slate-200'
            : 'text-slate-500 hover:text-slate-800'}"
        aria-current={active ? 'page' : undefined}
      >
        {view.label}
      </a>
    {/each}
  </div>
{/if}
