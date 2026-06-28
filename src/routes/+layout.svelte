<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import AppDialog from '$shared/presentation/dialogs/AppDialog.svelte';
  import FlyingSpaghettiEasterEgg from '$shared/presentation/easter-eggs/FlyingSpaghettiEasterEgg.svelte';
  import SyncToast from '$shared/presentation/toast/SyncToast.svelte';
  import TourOverlay from '$features/tutorial/presentation/components/TourOverlay.svelte';
  import GlobalSearch from '$features/global-search/presentation/components/GlobalSearch.svelte';
  import FloatingQueueWidget from '$features/implementation-queue/presentation/components/FloatingQueueWidget.svelte';
  import { projectsStore } from '$features/projects/presentation/stores/projectsStore.svelte';
  import { builderModeStore } from '$features/builder-mode/presentation/stores/builderModeStore.svelte';
  import { enabledViews, isEnabled } from '$lib/views/enabled';
  import { themeStore } from '$lib/theme/themeStore.svelte';
  import { ALL_THEMES } from '$lib/theme/registry';
  import { identityStore } from '$shared/identity/identityStore.svelte';
  import { authStore } from '$shared/security/authStore.svelte';
  import { apiFetch } from '$shared/security/apiFetch';
  import { confirmDialog, promptDialog } from '$shared/presentation/dialogs/dialogStore.svelte';
  import '../app.css';

  onMount(async () => {
    // Hydrate the display-name store from localStorage before anything
    // tries to read identityStore.author (notably the YDocClient
    // building its WebSocket URL). Idempotent on re-mount.
    identityStore.init();
    // Mirror the active colour theme from the <html data-theme> attribute
    // (server default + the inline head script's localStorage override) into
    // reactive state so the header switcher and chrome track it live.
    themeStore.init();
    // Hydrate the optional dashboard auth token the same way. When
    // unset, every API/SSE/WS request goes out unauthenticated; the
    // first 401 from the server triggers `apiFetch`'s prompt-and-retry
    // path which fills this store and persists the value.
    authStore.init();
    void loadHubDirectory();
    // First visit only: auto-prompt for a name. Once the user has been
    // asked (even if they dismissed without setting one), the flag in
    // localStorage suppresses the dialog on every subsequent reload.
    // The header avatar remains the explicit affordance to set/change
    // the name later. Deferred through queueMicrotask so the layout
    // has painted before the dialog opens.
    if (!identityStore.name && !identityStore.hasBeenAsked) {
      identityStore.markAsked();
      queueMicrotask(() => {
        void editIdentity();
      });
    }
    // Auto-bucket orphan features into an "Unknown" project. Runs silently
    // once per session. The Unknown project is a normal project the user can
    // rename or empty.
    try {
      await projectsStore.reconcileOrphanFeatures();
    } catch (e) {
      console.warn('Orphan reconciliation failed:', e);
    }
  });

  async function editIdentity() {
    const next = await promptDialog({
      title: 'Your display name',
      message:
        'Shown on every history entry you create. Stored locally in this browser — never sent off-machine. Leave empty to stay anonymous.',
      inputLabel: 'Display name',
      defaultValue: identityStore.name,
      placeholder: 'e.g. John',
      confirmLabel: 'Save',
      tone: 'info'
    });
    if (next !== null) identityStore.setName(next);
  }

  // First letter, uppercase, used in the avatar when a name is set.
  const initial = $derived(identityStore.name.trim().charAt(0).toUpperCase());

  // Header dropdown state. Click outside any open menu to close it; Escape
  // follows the same path through the window key handler below.
  let identityMenuOpen = $state(false);
  let identityMenuRef = $state<HTMLDivElement | null>(null);
  let settingsMenuOpen = $state(false);
  let settingsMenuRef = $state<HTMLDivElement | null>(null);
  let themeMenuOpen = $state(false);
  let themeMenuRef = $state<HTMLDivElement | null>(null);
  let hubDirectory = $state('');
  let hubDirectoryError = $state('');
  let openingHubDirectory = $state(false);

  function handleGlobalMouseDown(event: MouseEvent) {
    const target = event.target as Node;
    if (identityMenuOpen && identityMenuRef && !identityMenuRef.contains(target)) {
      identityMenuOpen = false;
    }
    if (settingsMenuOpen && settingsMenuRef && !settingsMenuRef.contains(target)) {
      settingsMenuOpen = false;
    }
    if (themeMenuOpen && themeMenuRef && !themeMenuRef.contains(target)) {
      themeMenuOpen = false;
    }
  }

  async function pickRename() {
    identityMenuOpen = false;
    await editIdentity();
  }

  async function pickReset() {
    settingsMenuOpen = false;
    await clearLocalData();
  }

  async function loadHubDirectory() {
    try {
      const response = await apiFetch('/api/system/hub-directory');
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { directory?: unknown };
      if (typeof payload.directory !== 'string') {
        throw new Error('The server returned an invalid directory.');
      }
      hubDirectory = payload.directory;
      hubDirectoryError = '';
    } catch (error) {
      hubDirectoryError = error instanceof Error ? error.message : 'Could not locate the hub.';
    }
  }

  async function openHubDirectory() {
    openingHubDirectory = true;
    hubDirectoryError = '';
    try {
      const response = await apiFetch('/api/system/hub-directory', {
        method: 'POST'
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { directory?: unknown };
      if (typeof payload.directory === 'string') {
        hubDirectory = payload.directory;
      }
      settingsMenuOpen = false;
    } catch (error) {
      hubDirectoryError = error instanceof Error ? error.message : 'Could not open the hub folder.';
    } finally {
      openingHubDirectory = false;
    }
  }

  // Wipe every browser-side persistence surface the dashboard uses:
  // localStorage (identity, "asked" flag, anything we add later) and
  // sessionStorage (transient per-tab state). IndexedDB / Cache API are
  // not currently used by the dashboard — if either gets adopted later,
  // add them to this list. The page reloads after so in-memory Svelte
  // stores, the YDocClient subscriptions, and the SSE stream all
  // re-initialize from a blank slate.
  //
  // Server-side data (project files, feature JSONs, history under
  // unspa/) is untouched — this is strictly about the browser-local
  // state the user can't otherwise reach without devtools.
  async function clearLocalData() {
    const ok = await confirmDialog({
      title: 'Reset local browser data?',
      message:
        "Clears your display name, the dashboard's local preferences, and any cached per-tab state in this browser. Your projects, features, history, and queue stay on disk untouched. The page will reload to apply a fresh state.",
      confirmLabel: 'Reset everything',
      cancelLabel: 'Cancel',
      tone: 'danger'
    });
    if (!ok) return;
    try {
      localStorage.clear();
    } catch {
      // Storage blocked (private browsing on some browsers) — nothing to clear.
    }
    try {
      sessionStorage.clear();
    } catch {
      // Same as above.
    }
    location.reload();
  }

  let { children } = $props();

  // Views are registry-driven (Expert is the always-on default; others like
  // Builder are opt-in via PUBLIC_UNSPA_VIEWS). The header shows a switcher
  // only when more than one view is active — a toggle between one thing is
  // meaningless. Builder is only "active" when it's both enabled and routed to.
  const views = $derived(enabledViews());
  // The Lyriks community edition presents a single, unswitched view, so hide
  // the Expert/Builder switcher while that theme is active.
  const showViewSwitcher = $derived(views.length > 1 && !themeStore.isLyriks);
  const builderActive = $derived(
    isEnabled('builder') && page.url.pathname.startsWith('/builder-mode')
  );
  const mcpActive = $derived(page.url.pathname.startsWith('/mcp'));
  // The feature editor + graph use a wider 1600px content column than the rest
  // of the app (max-w-7xl). Match the header container to whichever the current
  // route uses, so the header always spans the same width as the content below.
  const wideContent = $derived(page.url.pathname.startsWith('/features/'));
  // The Lyriks theme paints the header with a saturated violet→fuchsia
  // gradient (see below) and the shell with a cool canvas. Cosmetic only.
  const lyriks = $derived(themeStore.isLyriks);
  const themes = ALL_THEMES;
  // Dark chrome while in Builder OR under the Lyriks gradient header, so the
  // header's foreground (logo, icons, switcher) stays legible on a dark/vivid
  // background. The dropdown panels keep their own white surface regardless.
  const dark = $derived(builderActive || lyriks);
  const builderProject = $derived(builderActive ? builderModeStore.selectedProject : null);
  const builderSearch = $derived(builderModeStore.search);

  // The route key drives the transition. Including the dynamic params (e.g.
  // /projects/abc to /projects/xyz) so navigation between sibling pages also
  // animates rather than just swapping content silently.
  const routeKey = $derived(page.url.pathname);
</script>

<svelte:window
  onmousedown={handleGlobalMouseDown}
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      identityMenuOpen = false;
      settingsMenuOpen = false;
      themeMenuOpen = false;
    }
  }}
/>

<div
  class="flex min-h-full flex-col text-ink {lyriks
    ? 'bg-[linear-gradient(180deg,#e6ddfa_0%,#eeeafb_220px,#eeeafb_100%)]'
    : 'bg-[linear-gradient(180deg,#f0fdfa_0%,#f8fafc_220px,#f8fafc_100%)]'}"
>
  <header
    class="sticky top-0 z-30 border-b backdrop-blur transition-colors {lyriks
      ? 'border-transparent bg-[linear-gradient(90deg,#6d28d9_0%,#a21caf_55%,#db2777_100%)]'
      : dark
        ? 'border-slate-800 bg-slate-950/90'
        : 'border-slate-200 bg-white/95'}"
  >
    <div
      class="mx-auto flex h-16 items-center justify-between px-4 sm:px-6 {wideContent
        ? 'max-w-400'
        : 'max-w-7xl'}"
    >
      <div class="flex min-w-0 items-center gap-3">
        <a href="/" class="flex shrink-0 items-center gap-2.5">
          <img
            src={lyriks ? '/lyriks_logo.svg' : '/unspaghettit_logo.png'}
            alt={lyriks ? 'Lyriks' : 'Unspaghettit'}
            class={lyriks ? 'h-9 w-9 shrink-0' : 'h-12 w-auto'}
          />
          {#if lyriks}
            <!-- Clean stacked lockup: wordmark with an aligned uppercase
                 edition label below (the old absolute subtitle overflowed
                 because "community edition" is wider than "Lyriks"). -->
            <span class="hidden flex-col items-start leading-none sm:flex">
              <span
                class="font-brand text-2xl font-bold tracking-tight {dark
                  ? 'text-white'
                  : 'text-slate-950'}">Lyriks.io</span
              >
              <span
                class="mt-1 pl-px text-[9px] font-semibold uppercase tracking-[0.18em] {dark
                  ? 'text-white/75'
                  : 'text-slate-500'}">Community Edition</span
              >
            </span>
          {:else}
            <span
              class="relative hidden font-brand text-3xl font-semibold leading-none sm:inline-block {dark
                ? 'text-white'
                : 'text-slate-950'}"
            >
              Unspaghettit
              <span
                class="font-grotesk absolute right-0 -bottom-2 text-[10px] font-medium tracking-wide {dark
                  ? 'text-white/70'
                  : 'text-slate-500'}">by Lyriks.io</span
              >
            </span>
          {/if}
        </a>
        {#if showViewSwitcher}
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
        {#if builderProject}
          <div class="hidden min-w-0 items-center gap-2 sm:flex">
            <span class="shrink-0 text-slate-600" aria-hidden="true">/</span>
            <button
              type="button"
              onclick={() => builderModeStore.deselectProject()}
              class="max-w-56 truncate text-sm font-medium text-white transition hover:text-brand-300"
              title="Back to all projects"
            >
              {builderProject.name}
            </button>
          </div>
        {/if}
      </div>
      {#if builderActive}
        <div class="mx-3 hidden min-w-0 flex-1 justify-center md:flex">
          <label for="builder-global-search" class="sr-only">Search builder</label>
          <div class="relative w-full max-w-md">
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
              id="builder-global-search"
              type="search"
              placeholder="Search..."
              value={builderSearch}
              oninput={(e) => builderModeStore.setSearch((e.target as HTMLInputElement).value)}
              class="h-9 w-full rounded-lg border border-slate-700 bg-slate-900/70 py-1.5 pl-9 pr-9 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
            />
            {#if builderSearch.trim().length > 0}
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
        </div>
      {/if}
      {#if !builderActive}
        <!-- Global model search. Builder keeps its own local filter (above),
             so this only renders outside Builder. Flexes to fill the header
             center on every breakpoint; opens a grouped results menu. -->
        <div class="mx-2 flex min-w-0 flex-1 justify-center sm:mx-4 md:mx-6">
          <GlobalSearch {dark} {lyriks} />
        </div>
      {/if}
      <div class="flex shrink-0 items-center gap-1.5">
        <div bind:this={themeMenuRef} class="relative">
          <button
            type="button"
            onclick={() => {
              themeMenuOpen = !themeMenuOpen;
              settingsMenuOpen = false;
              identityMenuOpen = false;
            }}
            aria-haspopup="menu"
            aria-expanded={themeMenuOpen}
            aria-label="Switch dashboard theme"
            title="Switch theme"
            class="grid h-9 w-9 place-items-center rounded-md transition {themeMenuOpen
              ? lyriks
                ? 'bg-white/30 text-white'
                : dark
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-900 text-white'
              : lyriks
                ? 'bg-white/15 text-white hover:bg-white/25'
                : dark
                  ? 'text-slate-300 hover:bg-white/10 hover:text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}"
          >
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
          </button>
          {#if themeMenuOpen}
            <div
              role="menu"
              class="absolute right-0 top-12 z-40 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10"
            >
              <p
                class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
              >
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
                    themeMenuOpen = false;
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
            </div>
          {/if}
        </div>
        <div bind:this={settingsMenuRef} class="relative">
          <button
            type="button"
            onclick={() => {
              settingsMenuOpen = !settingsMenuOpen;
              identityMenuOpen = false;
            }}
            aria-haspopup="menu"
            aria-expanded={settingsMenuOpen}
            aria-label="Open app menu"
            title="App menu"
            class="grid h-9 w-9 place-items-center rounded-md transition {settingsMenuOpen ||
            mcpActive
              ? lyriks
                ? 'bg-white/30 text-white'
                : dark
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-900 text-white'
              : lyriks
                ? 'bg-white/15 text-white hover:bg-white/25'
                : dark
                  ? 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}"
          >
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
          </button>
          {#if settingsMenuOpen}
            <div
              role="menu"
              class="absolute right-0 top-12 z-40 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10"
            >
              <a
                href="/mcp"
                role="menuitem"
                onclick={() => (settingsMenuOpen = false)}
                class="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm {mcpActive
                  ? 'bg-slate-100 text-slate-950'
                  : 'text-slate-700 hover:bg-slate-50'}"
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
                  <path d="M12 3v18" />
                  <path d="M3 12h18" />
                  <path d="M5 5l14 14" />
                  <path d="M19 5L5 19" />
                </svg>
                <span class="min-w-0 flex-1">
                  <span class="block font-medium">MCP</span>
                  <span class="block text-[11px] text-slate-500"
                    >Tools, setup, and integration help.</span
                  >
                </span>
              </a>
              <div class="my-1 h-px bg-slate-100"></div>
              <button
                type="button"
                role="menuitem"
                onclick={openHubDirectory}
                disabled={openingHubDirectory}
                title={hubDirectory || 'Open the active snapshot folder'}
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
                  <path
                    d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
                  />
                  <path d="m14 12 3 3 3-3" />
                  <path d="M17 15V9" />
                </svg>
                <span class="min-w-0 flex-1">
                  <span class="block font-medium">
                    {openingHubDirectory ? 'Opening hub folder…' : 'Open hub folder'}
                  </span>
                  <span class="block truncate text-[11px] text-slate-500" title={hubDirectory}>
                    {hubDirectory || 'Folder containing all project snapshots'}
                  </span>
                  {#if hubDirectoryError}
                    <span class="mt-0.5 block text-[11px] text-rose-600">
                      Could not open the folder. Try again.
                    </span>
                  {/if}
                </span>
              </button>
              <div class="my-1 h-px bg-slate-100"></div>
              <button
                type="button"
                role="menuitem"
                onclick={pickReset}
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
            </div>
          {/if}
        </div>
        <a
          href="/tutorial"
          aria-label="Help & tutorial"
          title="Help & tutorial"
          class="grid h-9 w-9 place-items-center rounded-md transition {lyriks
            ? 'bg-white/15 text-white hover:bg-white/25'
            : dark
              ? 'text-slate-400 hover:bg-slate-800 hover:text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-5 w-5"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M9.4 9a2.6 2.6 0 0 1 5 1c0 1.6-2.4 2-2.4 3.4" />
            <line x1="12" y1="17.5" x2="12.01" y2="17.5" />
          </svg>
        </a>
        <div bind:this={identityMenuRef} class="relative flex items-center gap-1.5">
          <button
            type="button"
            onclick={() => {
              identityMenuOpen = !identityMenuOpen;
              settingsMenuOpen = false;
            }}
            aria-haspopup="menu"
            aria-expanded={identityMenuOpen}
            aria-label={identityStore.name
              ? `Signed in as ${identityStore.name}. Open identity menu.`
              : 'Set your display name'}
            title={identityStore.name
              ? `Signed in as ${identityStore.name}`
              : 'Set a display name so your edits are recognisable in history'}
            class="group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold shadow-sm shadow-slate-950/5 ring-1 ring-transparent transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300
              {identityStore.name
              ? 'bg-linear-to-br from-brand-600 to-brand-800 text-white hover:from-brand-500 hover:to-brand-700'
              : 'border border-dashed border-slate-300 bg-white text-slate-400 hover:border-brand-400 hover:text-brand-700'}"
          >
            {#if identityStore.name}
              <span aria-hidden="true">{initial}</span>
            {:else}
              <!-- Person silhouette: head + shoulders. Sized to match the
                   surrounding nav buttons; thin stroke so the dashed border
                   around it stays the dominant "needs action" cue. -->
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
                <circle cx="12" cy="8" r="3.5" />
                <path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" />
              </svg>
            {/if}
            <!-- Status dot: green when set, amber dashed when missing.
                 Communicates the "set" / "needs action" state at a glance,
                 distinguishing the avatar from a generic nav pill. -->
            <span
              class="absolute -right-0.5 -bottom-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full ring-2 ring-white
                {identityStore.name ? 'bg-emerald-500' : 'bg-amber-400'}"
              aria-hidden="true"
            ></span>
          </button>
          {#if identityMenuOpen}
            <div
              role="menu"
              class="absolute right-0 top-12 z-40 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10"
            >
              {#if identityStore.name}
                <p
                  class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
                >
                  Signed in as
                </p>
                <p class="truncate px-3 pb-2 text-sm font-medium text-slate-800">
                  {identityStore.name}
                </p>
                <div class="my-1 h-px bg-slate-100"></div>
              {/if}
              <button
                type="button"
                role="menuitem"
                onclick={pickRename}
                class="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
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
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                </svg>
                <span class="min-w-0 flex-1">
                  <span class="block font-medium">
                    {identityStore.name ? 'Change display name' : 'Set display name'}
                  </span>
                  <span class="block text-[11px] text-slate-500">
                    Shown on every history entry you create.
                  </span>
                </span>
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>
    {#if builderActive}
      <div class="mx-auto px-4 pb-3 md:hidden">
        <label for="builder-global-search-mobile" class="sr-only">Search builder</label>
        <div class="relative">
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
            id="builder-global-search-mobile"
            type="search"
            placeholder="Search..."
            value={builderSearch}
            oninput={(e) => builderModeStore.setSearch((e.target as HTMLInputElement).value)}
            class="h-9 w-full rounded-lg border border-slate-700 bg-slate-900/70 py-1.5 pl-9 pr-9 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
          />
          {#if builderSearch.trim().length > 0}
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
      </div>
    {/if}
  </header>
  <main class="flex-1">
    {#key routeKey}
      <div
        in:fade={{ duration: 160, easing: cubicOut }}
        class="motion-reduce:animate-none! motion-reduce:opacity-100! bg-[#152ffd0a]"
      >
        {@render children()}
      </div>
    {/key}
  </main>
</div>

<!-- Always-in-corner implementation queue for the default view. Builder mode
     ships its own dark, project-scoped queue widget, so suppress this one there
     to avoid two stacked widgets in the same corner. -->
{#if !builderActive}
  <FloatingQueueWidget />
{/if}

<AppDialog />
<FlyingSpaghettiEasterEgg />
<SyncToast />
<TourOverlay />
