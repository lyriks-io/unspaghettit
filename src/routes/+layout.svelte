<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import AppDialog from '$shared/presentation/dialogs/AppDialog.svelte';
  import FlyingSpaghettiEasterEgg from '$shared/presentation/easter-eggs/FlyingSpaghettiEasterEgg.svelte';
  import SyncToast from '$shared/presentation/toast/SyncToast.svelte';
  import TourOverlay from '$features/tutorial/presentation/components/TourOverlay.svelte';
  import GettingStartedBanner from '$features/tutorial/presentation/components/GettingStartedBanner.svelte';
  import FloatingQueueWidget from '$features/implementation-queue/presentation/components/FloatingQueueWidget.svelte';
  import AppHeader from '$features/app-shell/presentation/components/AppHeader.svelte';
  import UpdateBanner from '$features/update-check/presentation/components/UpdateBanner.svelte';
  import { bootstrapDashboard } from '$features/app-shell/presentation/bootstrapDashboard';
  import { isBuilderRoute } from '$features/app-shell/presentation/routeContext';
  import { themeStore } from '$lib/theme/themeStore.svelte';
  import '../app.css';

  let { children } = $props();

  const builderActive = $derived(isBuilderRoute(page.url.pathname));
  const embedded = $derived(page.url.searchParams.get('embed') === '1');
  const lyriks = $derived(embedded || themeStore.isLyriks);
  const requestedUser = $derived(page.url.searchParams.get('user') ?? undefined);

  onMount(() => {
    void bootstrapDashboard({
      displayName: requestedUser,
      suppressIdentityPrompt: embedded,
      forceLyriksSkin: embedded
    });
  });

  // The route key drives the transition. Including the dynamic params (e.g.
  // /projects/abc to /projects/xyz) so navigation between sibling pages also
  // animates rather than just swapping content silently.
  const routeKey = $derived(page.url.pathname);
</script>

<div
  class="flex min-h-full flex-col text-ink {lyriks
    ? 'bg-[linear-gradient(180deg,#e6ddfa_0%,#eeeafb_220px,#eeeafb_100%)]'
    : 'bg-[linear-gradient(180deg,#f0fdfa_0%,#f8fafc_220px,#f8fafc_100%)]'}"
>
  {#if !embedded}
    <AppHeader />
  {/if}
  <!-- Newer-release strip. Sits under the header, appears only when the
       server-side check reports an update, and remembers its dismissal per
       target version. -->
  {#if !embedded}
    <UpdateBanner />
  {/if}
  <!-- First-run onboarding strip. Sits outside the route transition so it
       doesn't re-fade on every navigation; hides itself permanently once
       the tour is completed or the user dismisses it. -->
  {#if !embedded}
    <GettingStartedBanner />
  {/if}
  <main class="flex-1 bg-[#152ffd0a]">
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

<!-- Always-in-corner implementation queue for the default view. Builder mode
     ships its own dark, project-scoped queue widget, so suppress this one there
     to avoid two stacked widgets in the same corner. -->
{#if !embedded && !builderActive}
  <FloatingQueueWidget />
{/if}

<AppDialog />
{#if !embedded}
  <FlyingSpaghettiEasterEgg />
  <SyncToast />
  <TourOverlay />
{/if}
