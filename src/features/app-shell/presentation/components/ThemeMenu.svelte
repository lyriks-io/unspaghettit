<script lang="ts">
  import { themeStore } from '$lib/theme/themeStore.svelte';
  import { ALL_THEMES } from '$lib/theme/registry';
  import HeaderMenu from '$features/app-shell/presentation/components/HeaderMenu.svelte';

  /** Colour-theme switcher: swatch trigger + one radio row per theme. */
  type Props = {
    dark: boolean;
    lyriks: boolean;
  };

  let { dark, lyriks }: Props = $props();

  const themes = ALL_THEMES;

  const triggerClass = (open: boolean): string =>
    `grid h-9 w-9 place-items-center rounded-md transition ${
      open
        ? lyriks
          ? 'bg-white/30 text-white'
          : dark
            ? 'bg-slate-800 text-white'
            : 'bg-slate-900 text-white'
        : lyriks
          ? 'bg-white/15 text-white hover:bg-white/25'
          : dark
            ? 'text-slate-300 hover:bg-white/10 hover:text-white'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
    }`;
</script>

<HeaderMenu label="Switch dashboard theme" title="Switch theme" {triggerClass} panelClass="w-64">
  {#snippet trigger()}
    <!-- Swatch / palette glyph: overlapping colour discs. -->
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="13.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="10.5" r="2.5" />
      <circle cx="8.5" cy="7.5" r="2.5" />
      <path
        d="M12 21a9 9 0 1 1 0-18c4.97 0 9 3.58 9 8 0 2.5-2 3.5-3.5 3.5H15a2 2 0 0 0-1.4 3.42A1.5 1.5 0 0 1 12 21z"
      />
    </svg>
  {/snippet}
  {#snippet menu(close)}
    <p class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
      Theme
    </p>
    {#each themes as theme (theme.id)}
      {@const active = themeStore.current === theme.id}
      <button
        type="button"
        role="menuitemradio"
        aria-checked={active}
        onclick={() => {
          themeStore.setTheme(theme.id);
          close();
        }}
        class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm {active
          ? 'bg-slate-100 text-slate-950'
          : 'text-slate-700 hover:bg-slate-50'}"
      >
        <span
          class="h-5 w-5 shrink-0 rounded-full ring-1 ring-slate-950/10"
          style="background: {theme.swatch}"
          aria-hidden="true"
        ></span>
        <span class="min-w-0 flex-1">
          <span class="block font-medium">{theme.label}</span>
          <span class="block text-[11px] text-slate-500">{theme.description}</span>
        </span>
        {#if active}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-4 w-4 shrink-0 text-brand-600"
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        {/if}
      </button>
    {/each}
  {/snippet}
</HeaderMenu>
