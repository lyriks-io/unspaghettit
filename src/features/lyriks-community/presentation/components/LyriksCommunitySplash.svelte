<script lang="ts">
  import { page } from '$app/state';
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { withBase } from '$shared/routing/appBase';
  import { dialogStore } from '$shared/presentation/dialogs/dialogStore.svelte';
  import { showUpgradeOffer } from '$features/lyriks-community/presentation/hostProduct';
  import { communitySplashStore } from '$features/lyriks-community/presentation/stores/communitySplashStore.svelte';

  /**
   * Standalone-only splash: Unspaghettit is the behavior engine, and Lyriks
   * Community is the free app that embeds it with the rest of a product
   * specification around it.
   *
   * Never rendered inside a host product (see `domain/upgradeOffer.ts`): the
   * Lyriks appliance sets `PUBLIC_UNSPA_HOST_PRODUCT`, and a framed or
   * host-branded navigation is excluded too. It opens on every visit until the
   * user explicitly retires it; closing it is just "not now".
   */

  const KEY_URL = 'https://get.lyriks.io/';

  const visible = $derived(
    showUpgradeOffer({
      url: page.url,
      optedOut: communitySplashStore.optedOut,
      dismissedForNow: communitySplashStore.dismissedForNow,
      reopened: communitySplashStore.reopened,
      dialogOpen: dialogStore.current !== null
    })
  );

  let panel = $state<HTMLElement | null>(null);

  // Move focus into the panel when it opens, so Tab acts on it and a screen
  // reader announces it instead of leaving the user behind the backdrop. Not
  // load-bearing for Escape: the route underneath is mounting at the same moment
  // and may autofocus a field of its own right after this.
  $effect(() => {
    if (visible) queueMicrotask(() => panel?.focus());
  });

  /** Close for this visit. It comes back next time. */
  const dismiss = (): void => communitySplashStore.dismiss();
  /** The one affordance that retires the offer for good. */
  const optOut = (): void => communitySplashStore.optOut();

  /**
   * Escape closes the panel, wherever focus happens to sit.
   *
   * `defaultPrevented` is the guard that matters. On a first visit the splash
   * waits behind the display-name prompt, and the ONE Escape that closes that
   * prompt would otherwise also close the splash it just revealed, in the same
   * event: the dialog layer consumes its own Escape (AppDialog calls
   * `preventDefault`), which is how this handler tells the two apart.
   */
  function handleKey(e: KeyboardEvent): void {
    if (!visible || e.defaultPrevented || e.key !== 'Escape') return;
    e.preventDefault();
    dismiss();
  }

  /**
   * Two kinds of row, because they answer two different questions. The first
   * one is what CARRIES OVER, and it leads: someone reading "evolved into" needs
   * to see that the engine they already use is not being taken away before a
   * list of new things means anything. Everything after it is what is NEW, which
   * is why it is a plus and not a tick.
   *
   * A few words each: this is a scan, not a spec sheet.
   */
  const rows = [
    { kind: 'kept', text: 'The same Unspaghettit engine and models' },
    { kind: 'new', text: 'Product brief, users and roles' },
    { kind: 'new', text: 'Features, requirements and releases' },
    { kind: 'new', text: 'Journeys, screens and a simulator' },
    { kind: 'new', text: 'Rules, data and architecture' },
    { kind: 'new', text: 'Audits and generated specs' }
  ] as const;
</script>

<svelte:window onkeydown={handleKey} />

{#if visible}
  <div
    class="fixed inset-0 z-90 flex items-center justify-center px-4 py-6"
    role="presentation"
    transition:fade={{ duration: 140, easing: cubicOut }}
  >
    <button
      type="button"
      aria-label="Close for now"
      class="absolute inset-0 bg-slate-950/55 backdrop-blur-sm"
      onclick={dismiss}
    ></button>

    <div
      bind:this={panel}
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lyriks-community-title"
      class="relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-950/40 outline-none"
      transition:scale={{ duration: 160, start: 0.97, easing: cubicOut }}
    >
      <!-- The Lyriks livery, not the dashboard's current skin: this panel is
           about Lyriks, and it has to read as Lyriks under either theme. -->
      <header
        class="flex items-center justify-between gap-3 bg-[linear-gradient(100deg,#6d28d9_0%,#a21caf_55%,#db2777_100%)] px-5 py-4 text-white sm:px-7"
      >
        <p class="font-grotesk truncate text-lg leading-none font-bold tracking-tight sm:text-xl">
          Lyriks Community is finally out!
        </p>
        <button
          type="button"
          onclick={dismiss}
          aria-label="Close for now"
          title="Close for now"
          class="-mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-white/80 transition hover:bg-white/20 hover:text-white"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </header>

      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 py-6">
        <h2
          id="lyriks-community-title"
          class="font-grotesk text-center text-xl leading-snug font-semibold text-balance text-slate-950 sm:text-2xl"
        >
          Unspaghettit evolved and became the Lyriks Community Edition.
        </h2>

        <!-- The same statement, animated. It carries its own wording, so the
             heading above is what a screen reader gets: the frames are decorative
             here, not the source of the message. -->
        <img
          src={withBase('/unspaghettit-evolution.gif')}
          alt=""
          aria-hidden="true"
          width="480"
          height="360"
          class="mt-5 max-h-[38vh] w-auto max-w-full self-center rounded-xl border border-hairline"
        />

        <p class="mt-6 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          What comes with it
        </p>

        <ul class="mt-3 space-y-2.5">
          {#each rows as row (row.text)}
            <li
              class="flex gap-3 text-sm leading-5 {row.kind === 'kept'
                ? 'text-slate-500'
                : 'text-slate-700'}"
            >
              {#if row.kind === 'kept'}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                  aria-hidden="true"
                >
                  <path d="m5 12 5 5L20 7" />
                </svg>
              {:else}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="mt-0.5 h-4 w-4 shrink-0 text-brand-600"
                  aria-hidden="true"
                >
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              {/if}
              <span>{row.text}</span>
            </li>
          {/each}
        </ul>
      </div>

      <footer
        class="flex flex-wrap items-center justify-end gap-2 border-t border-hairline bg-slate-50 px-7 py-4"
      >
        <button
          type="button"
          onclick={optOut}
          title="Retire this offer. Closing the panel any other way only hides it until next time."
          class="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Keep using Unspaghettit on its own
        </button>
        <a
          href={KEY_URL}
          target="_blank"
          rel="noopener noreferrer"
          onclick={dismiss}
          class="rounded-md bg-[linear-gradient(100deg,#6d28d9_0%,#a21caf_60%,#db2777_100%)] px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-slate-950/20 transition hover:brightness-110"
        >
          Get your free key
        </a>
      </footer>
    </div>
  </div>
{/if}
