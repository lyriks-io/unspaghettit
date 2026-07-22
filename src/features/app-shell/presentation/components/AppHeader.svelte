<script lang="ts">
  import { page } from '$app/state';
  import GlobalSearch from '$features/global-search/presentation/components/GlobalSearch.svelte';
  import { builderModeStore } from '$features/builder-mode/presentation/stores/builderModeStore.svelte';
  import { themeStore } from '$lib/theme/themeStore.svelte';
  import { isBuilderRoute, usesWideContent } from '$features/app-shell/presentation/routeContext';
  import HeaderBrand from '$features/app-shell/presentation/components/HeaderBrand.svelte';
  import ViewSwitcher from '$features/app-shell/presentation/components/ViewSwitcher.svelte';
  import PrimaryNav from '$features/app-shell/presentation/components/PrimaryNav.svelte';
  import BuilderSearchField from '$features/app-shell/presentation/components/BuilderSearchField.svelte';
  import ThemeMenu from '$features/app-shell/presentation/components/ThemeMenu.svelte';
  import SettingsMenu from '$features/app-shell/presentation/components/SettingsMenu.svelte';
  import HelpLink from '$features/app-shell/presentation/components/HelpLink.svelte';
  import IdentityMenu from '$features/app-shell/presentation/components/IdentityMenu.svelte';

  /**
   * The sticky app header: brand, view switcher, primary nav, search (global
   * or builder-local), and the theme / settings / help / identity cluster.
   */

  const builderActive = $derived(isBuilderRoute(page.url.pathname));
  // Match the header container to whichever content column the current route
  // uses, so the header always spans the same width as the content below.
  const wideContent = $derived(usesWideContent(page.url.pathname));
  // The Lyriks theme paints the header with a saturated violet→fuchsia
  // gradient and the shell with a cool canvas. Cosmetic only.
  const lyriks = $derived(themeStore.isLyriks);
  // Branding is independent from the colour theme. A host can request the
  // Lyriks lockup explicitly without changing the rest of the dashboard.
  const lyriksBrand = $derived(page.url.searchParams.get('brand') === 'lyriks');
  // Dark chrome while in Builder OR under the Lyriks gradient header, so the
  // header's foreground (logo, icons, switcher) stays legible on a dark/vivid
  // background. The dropdown panels keep their own white surface regardless.
  const dark = $derived(builderActive || lyriks);
  const builderProject = $derived(builderActive ? builderModeStore.selectedProject : null);
</script>

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
      <HeaderBrand {dark} brand={lyriksBrand ? 'lyriks' : 'unspaghettit'} />
      <ViewSwitcher {dark} />
      <!-- Under the Lyriks brand the host owns top-level navigation, so the
           global Projects entry is dropped from the header. -->
      {#if !builderActive && !lyriksBrand}
        <PrimaryNav {dark} {lyriks} />
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
        <BuilderSearchField id="builder-global-search" class="w-full max-w-md" />
      </div>
    {:else}
      <!-- Global model search. Builder keeps its own local filter (above),
           so this only renders outside Builder. Flexes to fill the header
           center on every breakpoint; opens a grouped results menu. -->
      <div class="mx-2 flex min-w-0 flex-1 justify-center sm:mx-4 md:mx-6">
        <GlobalSearch {dark} {lyriks} />
      </div>
    {/if}
    <div class="flex shrink-0 items-center gap-1.5">
      <!-- The Lyriks brand ships a fixed skin, so the theme switcher is hidden
           and the identity avatar renders menuless (the host owns identity). -->
      {#if !lyriksBrand}
        <ThemeMenu {dark} {lyriks} />
      {/if}
      <SettingsMenu {dark} {lyriks} />
      <HelpLink {dark} {lyriks} />
      <IdentityMenu avatarOnly={lyriksBrand} />
    </div>
  </div>
  {#if builderActive}
    <div class="mx-auto px-4 pb-3 md:hidden">
      <BuilderSearchField id="builder-global-search-mobile" />
    </div>
  {/if}
</header>
