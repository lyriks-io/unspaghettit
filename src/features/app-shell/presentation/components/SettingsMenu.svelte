<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import HeaderMenu from '$features/app-shell/presentation/components/HeaderMenu.svelte';
  import LyriksLogo from '$features/app-shell/presentation/components/LyriksLogo.svelte';
  import { hubDirectoryStore } from '$features/app-shell/presentation/stores/hubDirectoryStore.svelte';
  import { resetLocalData } from '$features/app-shell/presentation/resetLocalData';
  import { isHosted } from '$features/lyriks-community/presentation/hostProduct';
  import { communitySplashStore } from '$features/lyriks-community/presentation/stores/communitySplashStore.svelte';

  /**
   * The gear menu: open the hub snapshots folder in the OS file manager, the
   * way back to the Lyriks Community splash (standalone installs only), and
   * the destructive "Reset local data" action.
   */
  type Props = {
    dark: boolean;
    lyriks: boolean;
  };

  let { dark, lyriks }: Props = $props();

  // Resolve the hub path up front so the menu's subtitle/tooltip can show it
  // on the very first open.
  onMount(() => {
    void hubDirectoryStore.load();
  });

  async function pickOpenFolder(close: () => void) {
    if (await hubDirectoryStore.openFolder()) close();
  }

  // The way back once the user retired the Lyriks Community splash for good.
  // Hidden inside a host product, which already IS the offer.
  const standalone = $derived(!isHosted(page.url));

  function pickCommunity(close: () => void) {
    close();
    communitySplashStore.open();
  }

  async function pickReset(close: () => void) {
    close();
    await resetLocalData();
  }

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
            ? 'text-slate-400 hover:bg-slate-800 hover:text-white'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
    }`;
</script>

<HeaderMenu label="Open app menu" title="App menu" {triggerClass}>
  {#snippet trigger()}
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
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
      />
    </svg>
  {/snippet}
  {#snippet menu(close)}
    <button
      type="button"
      role="menuitem"
      onclick={() => pickOpenFolder(close)}
      disabled={hubDirectoryStore.opening}
      title={hubDirectoryStore.directory || 'Open the active snapshot folder'}
      class="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
        aria-hidden="true"
      >
        <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="m14 12 3 3 3-3" />
        <path d="M17 15V9" />
      </svg>
      <span class="min-w-0 flex-1">
        <span class="block font-medium">
          {hubDirectoryStore.opening ? 'Opening hub folder…' : 'Open hub folder'}
        </span>
        <span class="block truncate text-[11px] text-slate-500" title={hubDirectoryStore.directory}>
          {hubDirectoryStore.directory || 'Folder containing all project snapshots'}
        </span>
        {#if hubDirectoryStore.error}
          <span class="mt-0.5 block text-[11px] text-rose-600">
            Could not open the folder. Try again.
          </span>
        {/if}
      </span>
    </button>
    {#if standalone}
      <div class="my-1 h-px bg-slate-100"></div>
      <button
        type="button"
        role="menuitem"
        onclick={() => pickCommunity(close)}
        class="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
      >
        <LyriksLogo size={16} class="mt-0.5 shrink-0" />
        <span class="min-w-0 flex-1">
          <span class="block font-medium">About Lyriks Community</span>
          <span class="block text-[11px] text-slate-500">
            The free appliance that embeds this dashboard in a full product workspace
          </span>
        </span>
      </button>
    {/if}
    <div class="my-1 h-px bg-slate-100"></div>
    <button
      type="button"
      role="menuitem"
      onclick={() => pickReset(close)}
      class="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50 hover:text-rose-800"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="mt-0.5 h-4 w-4 shrink-0 text-rose-500"
        aria-hidden="true"
      >
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </svg>
      <span class="min-w-0 flex-1">
        <span class="block font-semibold">Reset local data</span>
        <span class="block text-[11px] text-rose-600/80">
          Wipes display name + browser settings. Projects on disk are kept.
        </span>
      </span>
    </button>
  {/snippet}
</HeaderMenu>
