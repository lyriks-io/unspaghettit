<script lang="ts">
  import { page } from '$app/state';
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import LyriksLogo from '$features/app-shell/presentation/components/LyriksLogo.svelte';
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
  const GUIDE_URL = 'https://get.lyriks.io/docs';

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

  /** What Lyriks Community adds around the same behavior models. */
  const adds = [
    'The product brief, its guardrails, and who the users and their roles are',
    'Features with requirements, acceptance criteria, scope and releases',
    'Journeys, screen design and an experience simulator on your models',
    'Rules, data, architecture and one knowledge graph over all of it',
    'Traceability, completion audits and generated specification documents'
  ];
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
      aria-describedby="lyriks-community-lead"
      class="relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-950/40 outline-none"
      transition:scale={{ duration: 160, start: 0.97, easing: cubicOut }}
    >
      <!-- The Lyriks livery, not the dashboard's current skin: this panel is
           about Lyriks, and it has to read as Lyriks under either theme. -->
      <header
        class="flex items-center justify-between gap-4 bg-[linear-gradient(100deg,#6d28d9_0%,#a21caf_55%,#db2777_100%)] px-7 py-5 text-white"
      >
        <div class="flex min-w-0 items-center gap-3">
          <LyriksLogo size={30} class="shrink-0" />
          <p class="font-grotesk truncate text-xl leading-none font-bold tracking-tight">
            Lyriks Community
          </p>
        </div>
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

      <div class="min-h-0 flex-1 overflow-y-auto px-7 py-6">
        <h2
          id="lyriks-community-title"
          class="font-grotesk text-2xl leading-tight font-semibold text-slate-950"
        >
          The same engine, with the product around it.
        </h2>
        <p id="lyriks-community-lead" class="mt-3 text-sm leading-6 text-slate-600">
          You are running Unspaghettit on its own, which models how your software behaves. Lyriks
          Community is the free app that embeds this exact dashboard and these exact models, and
          holds the rest of the specification around them:
        </p>

        <ul class="mt-4 space-y-2.5">
          {#each adds as item (item)}
            <li class="flex gap-3 text-sm leading-5 text-slate-700">
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
                <path d="m5 12 5 5L20 7" />
              </svg>
              <span>{item}</span>
            </li>
          {/each}
        </ul>

        <p class="mt-5 text-sm leading-6 text-slate-600">
          Free, one operator, installed by
          <a
            href={GUIDE_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="text-brand-700 underline underline-offset-2 hover:text-brand-800">one command</a
          >
          on your own machine. Nothing changes here: Unspaghettit stays open source and local-first.
        </p>
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
