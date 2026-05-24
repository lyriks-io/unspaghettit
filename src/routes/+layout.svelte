<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import AppDialog from "$shared/presentation/dialogs/AppDialog.svelte";
  import SyncToast from "$shared/presentation/toast/SyncToast.svelte";
  import { projectsStore } from "$features/projects/presentation/stores/projectsStore.svelte";
  import { identityStore } from "$shared/identity/identityStore.svelte";
  import { authStore } from "$shared/security/authStore.svelte";
  import {
    confirmDialog,
    promptDialog
  } from "$shared/presentation/dialogs/dialogStore.svelte";
  import "../app.css";

  onMount(async () => {
    // Hydrate the display-name store from localStorage before anything
    // tries to read identityStore.author (notably the YDocClient
    // building its WebSocket URL). Idempotent on re-mount.
    identityStore.init();
    // Hydrate the optional dashboard auth token the same way. When
    // unset, every API/SSE/WS request goes out unauthenticated; the
    // first 401 from the server triggers `apiFetch`'s prompt-and-retry
    // path which fills this store and persists the value.
    authStore.init();
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
      console.warn("Orphan reconciliation failed:", e);
    }
  });

  async function editIdentity() {
    const next = await promptDialog({
      title: "Your display name",
      message:
        "Shown on every history entry you create. Stored locally in this browser — never sent off-machine. Leave empty to stay anonymous.",
      inputLabel: "Display name",
      defaultValue: identityStore.name,
      placeholder: "e.g. John",
      confirmLabel: "Save",
      tone: "info"
    });
    if (next !== null) identityStore.setName(next);
  }

  // First letter, uppercase, used in the avatar when a name is set.
  const initial = $derived(
    identityStore.name.trim().charAt(0).toUpperCase()
  );

  // Dropdown state. Click the avatar to open / close; clicking outside
  // (any mousedown event whose target sits outside the menu container)
  // closes it. Escape too, via the existing dialog key handler scope.
  let identityMenuOpen = $state(false);
  let identityMenuRef = $state<HTMLDivElement | null>(null);

  function handleGlobalMouseDown(event: MouseEvent) {
    if (!identityMenuOpen) return;
    const node = identityMenuRef;
    if (!node) return;
    if (node.contains(event.target as Node)) return;
    identityMenuOpen = false;
  }

  async function pickRename() {
    identityMenuOpen = false;
    await editIdentity();
  }

  async function pickReset() {
    identityMenuOpen = false;
    await clearLocalData();
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
      title: "Reset local browser data?",
      message:
        "Clears your display name, the dashboard's local preferences, and any cached per-tab state in this browser. Your projects, features, history, and queue stay on disk untouched. The page will reload to apply a fresh state.",
      confirmLabel: "Reset everything",
      cancelLabel: "Cancel",
      tone: "danger"
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

  const navItems = [
    {
      href: "/projects",
      label: "Projects",
      match: (path: string) => path === "/" || path.startsWith("/projects"),
    },
    // Features tab is hidden for now. The /features page still exists in the
    // codebase but is not navigable from the header. Uncomment to restore.
    // {
    //   href: "/features",
    //   label: "Features",
    //   match: (path: string) => path.startsWith("/features"),
    // },
    {
      href: "/mcp",
      label: "MCP",
      match: (path: string) => path.startsWith("/mcp"),
    },
    {
      href: "/tutorial",
      label: "Tutorial",
      match: (path: string) => path.startsWith("/tutorial"),
    },
  ];

  // The route key drives the transition. Including the dynamic params (e.g.
  // /projects/abc to /projects/xyz) so navigation between sibling pages also
  // animates rather than just swapping content silently.
  const routeKey = $derived(page.url.pathname);
</script>

<svelte:window
  onmousedown={handleGlobalMouseDown}
  onkeydown={(e) => {
    if (e.key === "Escape" && identityMenuOpen) identityMenuOpen = false;
  }}
/>

<div
  class="flex min-h-full flex-col bg-[linear-gradient(180deg,#f0fdfa_0%,#f8fafc_220px,#f8fafc_100%)] text-ink"
>
  <header
    class="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"
  >
    <div
      class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6"
    >
      <a href="/" class="flex items-center gap-2">
        <img
          src="/unspaghettit_logo.png"
          alt="Unspaghettit"
          class="h-12 w-auto"
        />
        <span class="relative hidden font-brand text-3xl font-semibold leading-none sm:inline-block">
          Unspaghettit
          <span
            class="font-grotesk absolute right-0 -bottom-2 text-[10px] font-medium tracking-wide text-slate-500"
            >by Lyriks.io</span
          >
        </span>
      </a>
      <div class="flex items-center gap-3">
        <nav
          aria-label="Primary"
          class="flex items-center rounded-lg border border-slate-200 bg-white p-1 text-sm font-medium text-slate-600 shadow-sm shadow-slate-950/5"
        >
          {#each navItems as item}
            {@const active = item.match(page.url.pathname)}
            <a
              href={item.href}
              class="rounded-md px-3 py-1.5 transition {active
                ? 'bg-slate-900 text-white'
                : 'hover:bg-slate-100 hover:text-slate-950'}"
            >
              {item.label}
            </a>
          {/each}
        </nav>
        <div bind:this={identityMenuRef} class="relative">
          <button
            type="button"
            onclick={() => (identityMenuOpen = !identityMenuOpen)}
            aria-haspopup="menu"
            aria-expanded={identityMenuOpen}
            aria-label={identityStore.name
              ? `Signed in as ${identityStore.name}. Open identity menu.`
              : "Set your display name"}
            title={identityStore.name
              ? `Signed in as ${identityStore.name}`
              : "Set a display name so your edits are recognisable in history"}
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
                {identityStore.name
                  ? 'bg-emerald-500'
                  : 'bg-amber-400'}"
              aria-hidden="true"
            ></span>
          </button>
          {#if identityMenuOpen}
            <div
              role="menu"
              class="absolute right-0 top-12 z-40 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10"
            >
              {#if identityStore.name}
                <p class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
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
                    {identityStore.name ? "Change display name" : "Set display name"}
                  </span>
                  <span class="block text-[11px] text-slate-500">
                    Shown on every history entry you create.
                  </span>
                </span>
              </button>
              <!-- Destructive: pre-colored red so the user sees the
                   warning before clicking. Hover deepens the rose tint
                   without changing meaning. -->
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
      </div>
    </div>
  </header>
  <main class="flex-1">
    {#key routeKey}
      <div
        in:fade={{ duration: 160, easing: cubicOut }}
        class="motion-reduce:animate-none! motion-reduce:opacity-100!"
      >
        {@render children()}
      </div>
    {/key}
  </main>
</div>

<AppDialog />
<SyncToast />
