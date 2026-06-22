<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { asActionId, asSurfaceId } from '$features/behavior-model/domain/value-objects/ids';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { editorStore } from '$features/behavior-model/presentation/stores/editorStore.svelte';
  import { getEffectiveEntities } from '$features/behavior-model/domain/services/EffectiveEntities';
  import { withSharedStateDefinitions } from '$features/behavior-model/domain/services/SharedStateDefinitions';
  import type { SurfacePanelTab } from '$features/maturity/domain/MaturityReport';
  import FeatureHeader from './FeatureHeader.svelte';
  import FeatureHealthStrip from './FeatureHealthStrip.svelte';
  import HistoryPanel from './HistoryPanel.svelte';
  import SurfaceList from './SurfaceList.svelte';
  import SurfacePanel from './SurfacePanel.svelte';
  import SidePanel from '$features/simulator/presentation/components/SidePanel.svelte';
  import ResourcesManager from './ResourcesManager.svelte';
  import EntityManager from './EntityManager.svelte';
  import EventsManager from './EventsManager.svelte';
  import FeatureInvariantsEditor from './FeatureInvariantsEditor.svelte';
  import ReachabilityGoalsEditor from './ReachabilityGoalsEditor.svelte';
  import TransitionsManager from './TransitionsManager.svelte';
  import { buildEventCatalog } from '$features/behavior-model/domain/services/EventCatalog';
  import { buildTransitionCatalog } from '$features/behavior-model/domain/services/TransitionCatalog';
  import { implementationStatusStore } from '$features/implementation-status/presentation/stores/implementationStatusStore.svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  const VALID_TOP_TABS = new Set([
    'build',
    'resources',
    'data',
    'events',
    'transitions',
    'invariants',
    'goals'
  ]);
  const VALID_PANEL_TABS = new Set([
    'actions',
    'state',
    'rules',
    'invariants',
    'data',
    'resources',
    'personas'
  ]);

  type Props = { feature: Feature };
  let { feature }: Props = $props();

  type TopTab =
    | 'build'
    | 'resources'
    | 'data'
    | 'events'
    | 'transitions'
    | 'invariants'
    | 'goals';
  // Top-level tab is now in the editor store so deep-link navigation can
  // jump back to "Build" when fixing an issue from elsewhere.
  const activeTab = $derived<TopTab>(editorStore.topLevelTab);

  const selectedSurface = $derived(
    feature.surfaces.find((s) => s.id === editorStore.selectedSurfaceId) ?? null
  );
  const selectedSurfaceForUse = $derived(
    selectedSurface ? withSharedStateDefinitions(feature, selectedSurface) : null
  );

  onMount(() => {
    if (!editorStore.selectedSurfaceId && feature.surfaces.length > 0) {
      const first = feature.surfaces[0];
      if (first) editorStore.selectSurface(first.id);
    }
    implementationStatusStore.load(feature.id);
  });

  $effect(() => {
    if (
      editorStore.selectedSurfaceId &&
      !feature.surfaces.some((s) => s.id === editorStore.selectedSurfaceId)
    ) {
      const first = feature.surfaces[0];
      editorStore.selectSurface(first ? first.id : null);
    }
  });

  // Focus observer: when the editor asks to focus a target (e.g. via the
  // maturity panel's "Fix →" anchor or a global-search result), wait a tick for
  // the surface/tab/capability selection to settle, then scroll the matching
  // DOM element into view and pulse it so the user can see exactly what they
  // searched for. The pulse holds for ~3s (FOCUS_FLASH_MS) — long enough to
  // catch the eye after the scroll lands.
  const FOCUS_FLASH_MS = 3000;
  $effect(() => {
    editorStore.focusToken; // re-fire each navigation
    const target = editorStore.focusTarget;
    if (!target) return;
    let cancelled = false;
    let flashed: Element | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Clear any leftover highlight from a previous navigation so re-searching
    // never leaves two elements glowing at once.
    document
      .querySelectorAll('.focus-flash')
      .forEach((el) => el.classList.remove('focus-flash'));
    const tryFocus = (attempt = 0) => {
      if (cancelled) return;
      const el = document.querySelector(`[data-focus-target="${CSS.escape(target)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Restart the CSS animation cleanly even if the class lingered.
        el.classList.remove('focus-flash');
        void (el as HTMLElement).offsetWidth; // reflow so the animation replays
        el.classList.add('focus-flash');
        flashed = el;
        timers.push(setTimeout(() => el.classList.remove('focus-flash'), FOCUS_FLASH_MS + 200));
        return;
      }
      // The element may not be in the DOM yet (tab switching, action
      // expanding). Retry a handful of times before giving up.
      if (attempt < 6) {
        timers.push(setTimeout(() => tryFocus(attempt + 1), 80));
      }
    };
    timers.push(setTimeout(() => tryFocus(), 60));
    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
      // Drop the highlight if we navigate away mid-pulse.
      flashed?.classList.remove('focus-flash');
    };
  });

  // ───────── URL ⇄ editorStore sync ────────────────────────────────────
  //
  // The browser URL is the source of truth for navigation: top-level tab,
  // selected surface, surface-panel tab. Two effects keep them in lockstep:
  //   • URL → store: only re-runs when the URL changes (back/forward, deep
  //     links). Store reads are wrapped in `untrack` so the effect cannot
  //     re-fire when its own writes propagate.
  //   • store → URL: only re-runs when the store changes. URL reads happen
  //     inside `untrack` for the same reason. Without this, a click on a
  //     surface mutates the store, the other effect immediately fires reading
  //     the still-stale URL, and reverts the click.

  $effect(() => {
    const url = page.url;
    const tabParam = url.searchParams.get('tab');
    const surfaceParam = url.searchParams.get('surface');
    const panelParam = url.searchParams.get('panel');
    // Optional one-shot deep-link focus (e.g. from global search): the value of
    // a `data-focus-target` attribute the focus observer below scrolls to and
    // pulses. Read here so it survives a fresh page load; the store→URL effect
    // strips it from the URL afterward, which is fine — it's a one-time pulse.
    const focusParam = url.searchParams.get('focus');

    untrack(() => {
      const tab =
        tabParam && VALID_TOP_TABS.has(tabParam)
          ? (tabParam as typeof editorStore.topLevelTab)
          : 'build';
      if (editorStore.topLevelTab !== tab) {
        editorStore.setTopLevelTab(tab);
      }

      const surfaceId = surfaceParam ? asSurfaceId(surfaceParam) : null;
      if (editorStore.selectedSurfaceId !== surfaceId) {
        editorStore.selectSurface(surfaceId);
      }

      const panel: SurfacePanelTab =
        panelParam && VALID_PANEL_TABS.has(panelParam)
          ? (panelParam as SurfacePanelTab)
          : 'actions';
      if (editorStore.surfacePanelTab !== panel) {
        editorStore.setSurfacePanelTab(panel);
      }

      if (focusParam) {
        // Open the dropdown for the exact target so the user sees the searched
        // item itself, not a collapsed header. An `action:<id>` focus selects
        // that capability, which expands its card (ActionsEditor renders the
        // selected action expanded). Runs AFTER selectSurface above, which
        // would otherwise reset the selected capability to null.
        const actionMatch = /^action:(.+)$/.exec(focusParam);
        if (actionMatch?.[1]) {
          editorStore.selectCapability(asActionId(actionMatch[1]));
        }
        // Bump the token so re-navigating to the same target still re-fires the
        // focus observer; writes propagate even from inside untrack.
        editorStore.focusTarget = focusParam;
        editorStore.focusToken += 1;
      }
    });
  });

  $effect(() => {
    const tab = editorStore.topLevelTab;
    const surfaceId = editorStore.selectedSurfaceId;
    const panel = editorStore.surfacePanelTab;

    untrack(() => {
      const params = new URLSearchParams();
      if (tab !== 'build') params.set('tab', tab);
      if (surfaceId) params.set('surface', surfaceId);
      if (panel !== 'actions') params.set('panel', panel);
      const qs = params.toString();
      const desired = qs ? `?${qs}` : '';
      const current = page.url.search;
      if (desired === current) return;
      void goto(`${page.url.pathname}${desired}`, {
        keepFocus: true,
        noScroll: true,
        replaceState: false
      });
    });
  });

  // Effective data = every namespace touched by the model (deduced + declared).
  // Counter must reflect what the Entity tab actually shows, not just stored
  // overrides.
  const effectiveDataCount = $derived(getEffectiveEntities(feature).length);
  const eventsCount = $derived(buildEventCatalog(feature).length);
  const transitionsCount = $derived(buildTransitionCatalog(feature).length);

  const tabs: ReadonlyArray<{ key: TopTab; label: string; count?: number }> = $derived([
    { key: 'build', label: 'Build', count: feature.surfaces.length },
    { key: 'resources', label: 'Resources', count: feature.resources.length },
    { key: 'data', label: 'Entity', count: effectiveDataCount },
    { key: 'events', label: 'Events', count: eventsCount },
    { key: 'transitions', label: 'Transitions', count: transitionsCount },
    {
      key: 'invariants',
      label: 'Invariants',
      count: feature.featureInvariants?.length ?? 0
    },
    {
      key: 'goals',
      label: 'Reachability goals',
      count: feature.reachabilityGoals?.length ?? 0
    }
  ]);

  // Global undo/redo shortcuts. We deliberately ignore the event when focus
  // is in a text editor. Native input/textarea undo handles per-keystroke
  // text edits, and our store-level undo only exists for committed mutations
  // (mutate() calls), not in-progress text drafts.
  $effect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return el.isContentEditable;
    };
    const onKeydown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      const isUndo = key === 'z' && !event.shiftKey;
      const isRedo = (key === 'z' && event.shiftKey) || key === 'y';
      if (!isUndo && !isRedo) return;
      if (isEditable(event.target)) return;
      event.preventDefault();
      if (isUndo) featureStore.undo();
      else featureStore.redo();
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });

  // Detect when the tab nav is pinned to the top of the viewport. A 1px
  // sentinel sits just above the nav; when it scrolls out of view the nav has
  // crossed top: 0 and we add a shadow to lift it off the content scrolling
  // behind it.
  let navStuck = $state(false);
  let stuckSentinel = $state<HTMLDivElement | null>(null);
  let historyOpen = $state(false);

  $effect(() => {
    const el = stuckSentinel;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) navStuck = !entry.isIntersecting;
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  });
</script>

<div class="relative flex">
<div class="mx-auto flex max-w-400 flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
  <FeatureHeader
    {feature}
    saving={featureStore.saving}
    {historyOpen}
    onToggleHistory={() => (historyOpen = !historyOpen)}
  />

  <FeatureHealthStrip {feature} />

  <div bind:this={stuckSentinel} aria-hidden="true" class="h-px"></div>

  <nav
    class="sticky top-16 z-20 -mx-4 flex flex-wrap gap-1 border-b border-hairline bg-canvas/95 px-4 backdrop-blur transition-shadow {navStuck
      ? 'shadow-[0_4px_8px_-2px_rgba(15,23,42,0.08)]'
      : ''}"
  >
    {#each tabs as tab (tab.key)}
      <button
        type="button"
        class="-mb-px border-b-2 px-4 py-2 text-sm font-medium transition {activeTab === tab.key
          ? 'border-brand-700 text-brand-800'
          : 'border-transparent text-slate-600 hover:text-slate-900'}"
        onclick={() => editorStore.setTopLevelTab(tab.key)}
      >
        {tab.label}{tab.count !== undefined ? ` (${tab.count})` : ''}
      </button>
    {/each}
  </nav>

  {#key activeTab}
    <div in:fade={{ duration: 140, easing: cubicOut }} class="motion-reduce:animate-none! motion-reduce:opacity-100!">
      {#if activeTab === 'build'}
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
          <aside
            class="w-full shrink-0 lg:sticky lg:top-32 lg:max-h-[calc(100vh-8rem)] lg:w-[16rem] lg:overflow-y-auto xl:w-[18rem]"
          >
            <SurfaceList
              {feature}
              selectedId={editorStore.selectedSurfaceId}
              onSelect={(id) => editorStore.selectSurface(id)}
            />
          </aside>
          <section class="min-w-0 flex-1">
            {#if selectedSurface}
              <SurfacePanel
                {feature}
                surface={selectedSurface}
                resources={feature.resources}
                personas={feature.personas}
              />
            {:else}
              <div
                class="rounded-lg border border-dashed border-hairline bg-white p-8 text-center text-sm text-slate-500"
              >
                Add a surface to get started.
              </div>
            {/if}
          </section>
          <aside
            class="w-full shrink-0 lg:sticky lg:top-32 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto {editorStore.railCollapsed
              ? 'lg:w-12'
              : 'lg:w-88 xl:w-104'}"
          >
            <SidePanel {feature} surface={selectedSurfaceForUse} />
          </aside>
        </div>
      {:else if activeTab === 'resources'}
        <section class="rounded-lg border border-hairline bg-white p-4">
          <ResourcesManager {feature} />
        </section>
      {:else if activeTab === 'data'}
        <section class="rounded-lg border border-hairline bg-white p-4">
          <EntityManager {feature} />
        </section>
      {:else if activeTab === 'events'}
        <section class="rounded-lg border border-hairline bg-white p-4">
          <EventsManager {feature} />
        </section>
      {:else if activeTab === 'invariants'}
        <section class="rounded-lg border border-hairline bg-white p-4">
          <FeatureInvariantsEditor {feature} />
        </section>
      {:else if activeTab === 'goals'}
        <section class="rounded-lg border border-hairline bg-white p-4">
          <ReachabilityGoalsEditor {feature} />
        </section>
      {:else}
        <section class="rounded-lg border border-hairline bg-white p-4">
          <TransitionsManager {feature} />
        </section>
      {/if}
    </div>
  {/key}
</div>
{#if historyOpen}
  <div class="sticky top-0 z-30 h-screen self-start">
    <HistoryPanel bind:open={historyOpen} />
  </div>
{/if}
</div>
