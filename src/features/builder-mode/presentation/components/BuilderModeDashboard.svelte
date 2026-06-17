<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { afterNavigate, replaceState } from '$app/navigation';
  import { fade, fly, slide } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import ClampedDescription from './ClampedDescription.svelte';
  import BuilderTagChips from './BuilderTagChips.svelte';
  import { humanizeTagText } from '$shared/domain/Tags';
  import GameScore from './GameScore.svelte';
  import { builderModeStore } from '$features/builder-mode/presentation/stores/builderModeStore.svelte';
  import { registerViewLinkResolver } from '$shared/presentation/toast/viewLinkResolver';
  import type {
    BuilderModeFeature,
    BuilderModeSuggestion
  } from '$features/builder-mode/domain/BuilderModeDashboard';
  import type { QueueView } from '$features/implementation-queue/application/use-cases/ListQueue';
  import {
    clampPercent,
    isEmptyTarget,
    type QueueTarget,
    type QueueTargetMetric
  } from '$features/implementation-queue/domain/entities/QueueItem';

  // Honour the OS "reduce motion" setting: collapse transition durations to 0.
  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionMs = (ms: number): number => (reduceMotion ? 0 : ms);

  // Per-item entrance delay for staggered list reveals. Capped so long lists
  // don't take forever to finish appearing; collapses to 0 under reduce-motion.
  const stagger = (index: number): number => motionMs(Math.min(index, 12) * 40);

  // Leaving core-feature cards collapse their own box (height + margins +
  // padding) while fading, so the surviving (selected) card reflows up to the
  // top smoothly instead of the list snapping. Used as the `out` transition.
  function collapse(node: HTMLElement, { duration = 300 }: { duration?: number } = {}) {
    const style = getComputedStyle(node);
    const height = parseFloat(style.height);
    const marginTop = parseFloat(style.marginTop);
    const marginBottom = parseFloat(style.marginBottom);
    const paddingTop = parseFloat(style.paddingTop);
    const paddingBottom = parseFloat(style.paddingBottom);
    return {
      duration,
      easing: cubicOut,
      css: (t: number) =>
        `overflow: hidden; opacity: ${t};` +
        `height: ${t * height}px;` +
        `margin-top: ${t * marginTop}px; margin-bottom: ${t * marginBottom}px;` +
        `padding-top: ${t * paddingTop}px; padding-bottom: ${t * paddingBottom}px;`
    };
  }

  // Detect when the "pick a core feature" prompt column is pinned (stuck) under
  // the header, so we can glide the prompt to the centre of the remaining space
  // while pinned and back to its original top position when it un-pins. A
  // sentinel at the grid's top toggles the flag via IntersectionObserver.
  let stickySentinel = $state<HTMLElement | null>(null);
  let promptStuck = $state(false);

  // Placeholder cards shown while the dashboard loads (mirrors the projects grid).
  const skeletonSlots = Array.from({ length: 8 }, (_, i) => i);

  // The core-feature / feature grid. Selecting a core feature collapses the
  // left column to that one card, but the page can be scrolled anywhere — so we
  // bring the grid's top back under the header, putting the just-opened core
  // feature in view. scroll-margin-top (scroll-mt-*) clears the sticky header.
  let coreFeaturesGrid = $state<HTMLElement | null>(null);

  /**
   * iOS-style rubber-band overscroll. When the window is scrolled against an
   * edge and the user keeps wheeling past it, translate the content with
   * *increasing resistance* — each further notch moves it less, asymptoting to
   * a hard ceiling so it reads as "this is the end" — then spring back to rest.
   * Transforms the content wrapper so the gap reveals the dark page background.
   */
  function overscrollBounce(node: HTMLElement) {
    if (typeof window === 'undefined') return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const MAX = 96; // hard ceiling on the stretch (px)
    const RESIST = 340; // higher = softer ramp
    const docEl = document.documentElement;
    let overscroll = 0; // signed accumulated input beyond the edge
    let raf = 0;
    let idle: ReturnType<typeof setTimeout> | null = null;

    const atBottom = (): boolean =>
      Math.ceil(window.scrollY + window.innerHeight) >= docEl.scrollHeight - 1;
    const atTop = (): boolean => window.scrollY <= 0;

    // Asymptotic damping: displacement approaches MAX but never reaches it, so
    // resistance feels stronger the deeper you push.
    const damp = (v: number): number => {
      const sign = Math.sign(v);
      return sign * MAX * (1 - Math.exp(-Math.abs(v) / RESIST));
    };
    const apply = (): void => {
      const offset = -damp(overscroll);
      node.style.transform = offset ? `translate3d(0, ${offset}px, 0)` : '';
    };

    const release = (): void => {
      if (idle) {
        clearTimeout(idle);
        idle = null;
      }
      const from = overscroll;
      if (from === 0) {
        node.style.transform = '';
        node.style.willChange = '';
        return;
      }
      const start = performance.now();
      const duration = 440;
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic spring-back
        overscroll = from * (1 - eased);
        apply();
        if (t < 1) raf = requestAnimationFrame(step);
        else {
          overscroll = 0;
          node.style.transform = '';
          node.style.willChange = '';
        }
      };
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(step);
    };

    const scheduleRelease = (): void => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(release, 90);
    };

    const onWheel = (event: WheelEvent): void => {
      const pushingEdge =
        (event.deltaY > 0 && atBottom()) || (event.deltaY < 0 && atTop());
      if (overscroll === 0 && !pushingEdge) return; // normal scrolling
      // While stretched, consume scroll until we're back at rest, then release.
      event.preventDefault();
      cancelAnimationFrame(raf);
      node.style.willChange = 'transform';
      overscroll += event.deltaY;
      // Don't let a stretch cross zero into the opposite edge's direction.
      if (atBottom() && !atTop()) overscroll = Math.max(0, overscroll);
      else if (atTop() && !atBottom()) overscroll = Math.min(0, overscroll);
      apply();
      scheduleRelease();
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    return {
      destroy() {
        window.removeEventListener('wheel', onWheel);
        cancelAnimationFrame(raf);
        if (idle) clearTimeout(idle);
        node.style.transform = '';
        node.style.willChange = '';
      }
    };
  }

  async function openCoreFeature(id: string): Promise<void> {
    builderModeStore.selectCoreFeature(id);
    await tick(); // let the selection re-render before measuring scroll position
    coreFeaturesGrid?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start'
    });
  }

  $effect(() => {
    const el = stickySentinel;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) promptStuck = !entry.isIntersecting;
      },
      // 72px = the sticky `top-18` (4.5rem) offset the column pins at.
      { rootMargin: '-72px 0px 0px 0px', threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  });

  let unsubscribeSync: (() => void) | null = null;
  let unregisterViewLink: (() => void) | null = null;

  // Keep tag colors resolvable in this view: load the palette and feed it the
  // tag types as the dashboard surfaces them (same handshake the expert pages
  // use), so auto-color assignment stays stable across views.
  $effect(() => {
    const types = builderModeStore.allTagTypes;
    if (types.length > 0) builderModeStore.registerTagTypes(types);
  });

  // Deep-link / refresh-persist the current selection in the URL, like the
  // Expert view's routes do. `?project=<id>&core=<id>` is restored on load and
  // kept in sync as the user drills in/out. Guarded so the sync effect doesn't
  // clobber the incoming params before they're restored.
  let urlRestored = $state(false);

  $effect(() => {
    if (!urlRestored || typeof window === 'undefined') return;
    const pid = builderModeStore.selectedProjectId;
    const cid = builderModeStore.selectedCoreFeatureId;
    const url = new URL(page.url);
    const before = url.search;
    if (pid) url.searchParams.set('project', pid);
    else url.searchParams.delete('project');
    if (cid) url.searchParams.set('core', cid);
    else url.searchParams.delete('core');
    if (url.search !== before) replaceState(`${url.pathname}${url.search}`, {});
  });

  // The other half of the URL ↔ selection binding, but driven by real
  // navigations only — the activity-toast "View" links into the Builder and
  // browser back/forward. Crucially NOT a reactive `page.url` effect: that
  // raced the writer above (on a card click it would run before the writer
  // had reflected the new selection into the URL, read the stale empty query,
  // and revert the click). `afterNavigate` fires on link clicks / popstate but
  // NOT on the writer's `replaceState`, so there's no race. The initial load
  // (`from` is null) is left to onMount's restore.
  afterNavigate((nav) => {
    if (!nav.from) return;
    const params = page.url.searchParams;
    builderModeStore.applySelection(params.get('project'), params.get('core'));
  });

  onMount(() => {
    // Restore selection from the URL before the sync effect runs.
    const params = page.url.searchParams;
    const initialProject = params.get('project');
    builderModeStore.applySelection(initialProject, params.get('core'));
    urlRestored = true;

    // Teach the activity-toast to deep-link into the Builder while it's open
    // (falling back to the Expert route when an entity isn't shown here).
    unregisterViewLink = registerViewLinkResolver((kind, id) =>
      builderModeStore.deepLinkFor(kind, id)
    );

    // Deep-linked to one project → load just that project (the rest of the
    // list fills in lazily if the user goes back to all projects). No project
    // in the URL → load the full list up front.
    if (initialProject) {
      void builderModeStore.loadProjectOnly(initialProject);
    } else {
      void builderModeStore.refresh();
    }
    void builderModeStore.refreshTagPalette();
    unsubscribeSync = builderModeStore.subscribeSync((event) => {
      // Scoped, in-place update — rebuild only the affected project's card
      // (like the Expert view's refetchOne) instead of the whole dashboard,
      // so scroll / selection / the queue widget / expanded descriptions are
      // preserved. The store decides project vs feature scope and only does a
      // full refresh for a genuinely new entity.
      if (
        event.kind === 'project' ||
        event.kind === 'feature' ||
        event.kind === 'implementation-status'
      ) {
        void builderModeStore.applySyncEvent(event);
      }
    });
  });

  onDestroy(() => {
    unsubscribeSync?.();
    unsubscribeSync = null;
    unregisterViewLink?.();
    unregisterViewLink = null;
  });

  // Floating build-queue widget: minimized (bubble) vs expanded (panel).
  let queueOpen = $state(false);

  // ── Build-queue drag & drop ──────────────────────────────────────────────
  let dragIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);

  function onQueueDragStart(index: number) {
    dragIndex = index;
  }
  function onQueueDragOver(event: DragEvent, index: number) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragOverIndex = index;
  }
  function onQueueDrop(index: number) {
    const from = dragIndex;
    dragIndex = null;
    dragOverIndex = null;
    if (from === null || from === index) return;
    const view = builderModeStore.queue[from];
    if (view) void builderModeStore.moveQueueTo(view.item.id, index);
  }
  function onQueueDragEnd() {
    dragIndex = null;
    dragOverIndex = null;
  }

  function projectFeatureCount(project: { coreFeatures: readonly { features: readonly unknown[] }[] }): number {
    return project.coreFeatures.reduce((total, coreFeature) => total + coreFeature.features.length, 0);
  }

  function suggestionLabel(suggestion: BuilderModeSuggestion): string {
    return suggestion.tone === 'urgent' ? 'Priority' : 'Idea';
  }

  function queueTitle(view: QueueView): string {
    if (view.item.kind === 'action') return view.actionName ?? 'Action';
    if (view.item.kind === 'surface') return view.surfaceName ?? 'Surface';
    return view.featureName;
  }

  // ── Per-item goals ─────────────────────────────────────────────────────────
  // Each queued item can carry, independently: a Maturity % goal, a Built
  // (implementation) % goal, and/or a "Report it's in the code" presence flag.
  // The two % goals each render as a progress bar — filled to the item's CURRENT
  // score (slate) with the goal extension dragged out beyond it (tone-colored).

  // Tone color for a percentage — same low/mid/high scale as the score dials
  // (GameScore), so the goal bar reads red → orange → green as it climbs.
  function goalToneColor(value: number): string {
    if (value >= 80) return '#34d399'; // emerald
    if (value >= 45) return '#fb923c'; // orange
    return '#f43f5e'; // rose
  }

  function storedGoal(view: QueueView, metric: QueueTargetMetric): number | undefined {
    return metric === 'maturity' ? view.item.target?.maturity : view.item.target?.implementation;
  }

  // Merge a patch into the item's goals and persist (an all-empty result clears).
  function patchGoal(view: QueueView, patch: Partial<QueueTarget>): void {
    const merged: QueueTarget = { ...(view.item.target ?? {}), ...patch };
    const cleaned: QueueTarget = {
      ...(typeof merged.maturity === 'number' ? { maturity: merged.maturity } : {}),
      ...(typeof merged.implementation === 'number' ? { implementation: merged.implementation } : {}),
      ...(merged.report ? { report: true } : {})
    };
    void builderModeStore.setQueueTarget(view.item.id, isEmptyTarget(cleaned) ? undefined : cleaned);
  }

  function setMetricGoal(view: QueueView, metric: QueueTargetMetric, value: number | undefined): void {
    patchGoal(view, { [metric]: value });
  }
  function toggleReport(view: QueueView): void {
    patchGoal(view, { report: !view.item.target?.report });
  }
  function clearQueueTargetFor(view: QueueView): void {
    void builderModeStore.setQueueTarget(view.item.id, undefined);
  }

  // Live drag state. While dragging one bar we preview locally and only persist
  // on release, so a drag isn't a burst of saves.
  let dragItemId = $state<string | null>(null);
  let dragMetric = $state<QueueTargetMetric>('implementation');
  let dragValue = $state(0);

  const isDraggingBar = (view: QueueView, metric: QueueTargetMetric): boolean =>
    dragItemId === String(view.item.id) && dragMetric === metric;

  function barValueAt(bar: HTMLElement, clientX: number): number {
    const rect = bar.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return clampPercent(Math.max(0, Math.min(1, ratio)) * 100);
  }

  function onGoalBarDown(event: PointerEvent, view: QueueView, metric: QueueTargetMetric, current: number): void {
    event.preventDefault();
    const bar = event.currentTarget as HTMLElement;
    bar.setPointerCapture(event.pointerId);
    dragItemId = String(view.item.id);
    dragMetric = metric;
    dragValue = Math.max(current, barValueAt(bar, event.clientX));
  }
  function onGoalBarMove(event: PointerEvent, view: QueueView, metric: QueueTargetMetric, current: number): void {
    if (!isDraggingBar(view, metric)) return;
    dragValue = Math.max(current, barValueAt(event.currentTarget as HTMLElement, event.clientX));
  }
  function onGoalBarUp(view: QueueView, metric: QueueTargetMetric, current: number): void {
    if (!isDraggingBar(view, metric)) return;
    const value = dragValue;
    dragItemId = null;
    // Dropping back to (or below) the current score means "no goal" for it.
    setMetricGoal(view, metric, value <= current ? undefined : value);
  }
  function onGoalBarKey(event: KeyboardEvent, view: QueueView, metric: QueueTargetMetric, current: number): void {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowUp'
      ? 5
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? -5
        : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = clampPercent((storedGoal(view, metric) ?? current) + step);
    setMetricGoal(view, metric, next <= current ? undefined : next);
  }

  function queueSubtitle(view: QueueView): string {
    const suffix = view.orphaned ? ' · removed from spec' : '';
    if (view.item.kind === 'feature') return `Whole feature · implement what's missing${suffix}`;
    return `${view.featureName}${suffix}`;
  }

  // Shared button styles (dark theme).
  const ghostPill =
    'inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-brand-500/60 hover:bg-slate-800 hover:text-brand-300';
</script>

<div class="min-h-[calc(100vh-4rem)] bg-[radial-gradient(120%_120%_at_50%_-10%,#101a33_0%,#020617_55%)] text-slate-200">
  <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" use:overscrollBounce>
    <header class="mb-8 border-b border-slate-800 pb-6">
      <p class="text-xs font-semibold uppercase tracking-[0.2em] text-brand-400">Builder</p>
      <div class="mt-2 max-w-3xl">
        <h1 class="text-4xl font-semibold tracking-tight text-white">Your projects</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Browse your projects and features in a simpler view, and discover ideas to improve each one.
        </p>
      </div>
    </header>

    {#if builderModeStore.loading}
      <!-- Minimalist load state: neutral skeleton cards mirroring the projects
           grid, with a soft shimmer and a staggered fade-in. No colored frame. -->
      <ul
        class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        aria-busy="true"
        aria-live="polite"
        aria-label="Loading projects"
      >
        {#each skeletonSlots as slot (slot)}
          <li class="builder-skeleton__card" style="--d: {slot * 80}ms">
            <div class="flex items-center justify-between gap-3">
              <span class="builder-skeleton__shape h-2.5 w-3/5 rounded-full"></span>
              <span class="builder-skeleton__shape h-4 w-14 rounded-full"></span>
            </div>
            <div class="flex justify-center gap-10 pt-5">
              <span class="builder-skeleton__shape size-11 rounded-full"></span>
              <span class="builder-skeleton__shape size-11 rounded-full"></span>
            </div>
          </li>
        {/each}
      </ul>
    {:else if builderModeStore.error}
      <div class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
        {builderModeStore.error}
      </div>
    {:else if builderModeStore.dashboard.projects.length === 0}
      <div class="rounded-xl border border-slate-700/60 bg-linear-to-b from-slate-800/50 to-slate-900 p-8 text-center text-sm text-slate-400">
        No projects yet.
      </div>
    {:else if builderModeStore.searchActive && !builderModeStore.selectedProject && builderModeStore.filteredProjects.length === 0}
      <div class="rounded-xl border border-slate-700/60 bg-linear-to-b from-slate-800/50 to-slate-900 p-8 text-center text-sm text-slate-400">
        No projects, core features, features, or suggestions match your search.
      </div>
    {:else if builderModeStore.selectedProject}
      {@const selectedProject = builderModeStore.selectedProject}
      <div class="space-y-6">
        <button type="button" class={ghostPill} onclick={() => builderModeStore.deselectProject()}>
          ← All projects ({builderModeStore.projectCount})
        </button>

        <section class="overflow-hidden rounded-2xl border border-slate-700/60 bg-linear-to-b from-slate-800/45 to-slate-900 shadow-xl shadow-black/20">
          <div class="flex flex-col gap-5 p-6 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0">
              <div class="flex items-center gap-3">
                <h2 class="truncate text-2xl font-semibold tracking-tight text-white">{selectedProject.name}</h2>
                <span class="project-card__count shrink-0">
                  {selectedProject.coreFeatures.length} core / {projectFeatureCount(selectedProject)} feat
                </span>
              </div>
              <p class="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{selectedProject.description}</p>
            </div>
            <div class="flex shrink-0 items-center gap-6">
              <GameScore label="Maturity" value={selectedProject.maturityPercentage} />
              <GameScore label="Built" value={selectedProject.implementationPercentage} />
            </div>
          </div>
        </section>

        <div
          bind:this={coreFeaturesGrid}
          class="relative grid scroll-mt-20 items-start gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(380px,1.05fr)]"
        >
          <!-- Sentinel at the grid's natural top: when it scrolls above the
               sticky pin line the prompt column is "stuck". -->
          <div bind:this={stickySentinel} class="pointer-events-none absolute inset-x-0 top-0 h-px" aria-hidden="true"></div>
          <section class="flex flex-col gap-3 xl:sticky xl:top-18 xl:self-start">
            <div class="flex items-end justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-white">Core features</h3>
                <p class="text-xs text-slate-500">Each core feature contains smaller features.</p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                {@render ActiveTagFilter()}
                {#if builderModeStore.selectedCoreFeature}
                  <button type="button" class={ghostPill} onclick={() => builderModeStore.deselectCoreFeature()}>
                    ← Show all {selectedProject.coreFeatures.length}
                  </button>
                {:else}
                  <span class="text-xs text-slate-500">
                    {builderModeStore.visibleCoreFeatures.length}{builderModeStore.searchActive || builderModeStore.tagActive ? ` of ${selectedProject.coreFeatures.length}` : ''}
                  </span>
                {/if}
              </div>
            </div>

          {#if selectedProject.coreFeatures.length === 0}
            <div class="rounded-xl border border-slate-700/60 bg-linear-to-b from-slate-800/50 to-slate-900 p-8 text-center text-sm text-slate-400">
              This project has no core features yet.
            </div>
          {:else if builderModeStore.visibleCoreFeatures.length === 0}
            <div class="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
              No core features, features, or suggestions match your search.
            </div>
          {:else}
            <div class="space-y-3">
                {#each builderModeStore.visibleCoreFeatures as coreFeature, i (coreFeature.id)}
                  {@const isSelected = builderModeStore.selectedCoreFeature?.id === coreFeature.id}
                  <article
                    in:fly={{ y: 10, duration: motionMs(300), delay: stagger(i), easing: cubicOut }}
                    out:collapse={{ duration: motionMs(300) }}
                    animate:flip={{ duration: motionMs(320), easing: cubicOut }}
                    class="skeuo-card group relative overflow-hidden {isSelected
                      ? 'skeuo-card--active'
                      : 'skeuo-card--interactive'}"
                  >
                    {#if !isSelected}
                      <button
                        type="button"
                        class="absolute inset-0 z-10 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                        onclick={() => openCoreFeature(coreFeature.id)}
                        aria-label={`Open ${coreFeature.name}`}
                      ></button>
                    {/if}
                    <div class="p-4">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="flex items-center gap-2">
                            <span class="min-w-0 flex-1 truncate text-base font-semibold text-white {isSelected ? '' : 'group-hover:text-brand-300'}">{coreFeature.name}</span>
                            <span class="project-card__count shrink-0" title="Features in this core feature">
                              {coreFeature.features.length} feat
                            </span>
                            {@render QueueFeatureButton(coreFeature.id)}
                          </div>
                          <ClampedDescription text={coreFeature.description} class="mt-1" />
                          <BuilderTagChips
                            tags={coreFeature.tags}
                            onToggle={(tag) => builderModeStore.toggleTag(tag)}
                            isActive={(tag) => builderModeStore.isActiveTag(tag)}
                            onAdd={(type, value) => builderModeStore.addCoreFeatureTag(coreFeature.id, { type, value })}
                            onRemove={(tag) => builderModeStore.removeCoreFeatureTag(coreFeature.id, tag)}
                            onRename={(from, to) => builderModeStore.renameTag(from, to)}
                            typeOptions={builderModeStore.allTagTypes}
                            collapsible
                            class="relative z-20 mt-2"
                          />
                        </div>
                        <div class="flex shrink-0 items-center gap-4">
                          <GameScore label="Maturity" value={coreFeature.maturityPercentage} />
                          <GameScore label="Built" value={coreFeature.implementationPercentage} />
                        </div>
                      </div>
                    </div>
                    {#if isSelected}
                      <div
                        transition:slide={{ duration: motionMs(300), easing: cubicOut }}
                        class="border-t border-slate-800 bg-slate-950/40 px-4 py-3"
                      >
                        {#if coreFeature.suggestions.length > 0}
                          {@render SuggestionList(coreFeature.id, coreFeature.suggestions)}
                        {:else}
                          <p class="text-sm text-slate-500">
                            No suggestions yet. Ask your assistant to propose improvements for this feature.
                          </p>
                        {/if}
                      </div>
                    {/if}
                  </article>
                {/each}
              </div>
            {/if}
          </section>

          <!-- With no core feature picked the column only holds the prompt, so
               pin it under the header (like the Core features column) while the
               long core-feature list scrolls. Once one is picked the feature
               list can be long, so it scrolls normally. -->
          <section
            class="space-y-3 {builderModeStore.selectedCoreFeature
              ? ''
              : 'xl:sticky xl:top-18 xl:flex xl:min-h-[calc(100vh-6rem)] xl:flex-col xl:self-start'}"
          >
            <div class="flex items-end justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-white">Features</h3>
                <p class="text-xs text-slate-500">
                  {builderModeStore.selectedCoreFeature ? builderModeStore.selectedCoreFeature.name : 'Pick a core feature'}
                </p>
              </div>
              {#if builderModeStore.selectedCoreFeature}
                <span class="text-xs text-slate-500">
                  {builderModeStore.visibleSelectedFeatures.length}{builderModeStore.searchActive ? ` of ${builderModeStore.selectedCoreFeature.features.length}` : ''}
                </span>
              {/if}
            </div>

            {#if !builderModeStore.selectedCoreFeature}
              <div
                class="xl:relative xl:flex-1 xl:rounded-2xl xl:transition-colors xl:duration-500 xl:ease-out xl:motion-reduce:transition-none {promptStuck
                  ? 'xl:bg-white/2.5'
                  : 'xl:bg-transparent'}"
              >
                <div
                  in:fade={{ duration: motionMs(200) }}
                  class:is-waiting={promptStuck}
                  class="prompt-card rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-400 xl:absolute xl:inset-x-0 xl:mx-auto xl:max-w-sm xl:overflow-hidden xl:transition-[top,transform] xl:duration-500 xl:ease-out xl:motion-reduce:transition-none {promptStuck
                    ? 'xl:top-1/2 xl:-translate-y-1/2'
                    : 'xl:top-8'}"
                >
                  Pick a core feature to see its features.
                </div>
              </div>
            {:else if builderModeStore.selectedCoreFeature.features.length === 0}
              <div class="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
                This core feature has no features yet.
              </div>
            {:else if builderModeStore.visibleSelectedFeatures.length === 0}
              <div class="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
                No features match your search in this core feature.
              </div>
            {:else}
              {@const coreFeatureId = builderModeStore.selectedCoreFeature.id}
              <div class="space-y-4">
                {#each builderModeStore.visibleSelectedSurfaces as surface (surface.surfaceId)}
                  <div class="space-y-2">
                    <!-- A surface is a higher-level grouping; its features
                         (actions) are the specified leaves listed under it.
                         Always shown so the surface level is visible even when a
                         core feature has a single surface. -->
                    <div class="flex items-center gap-2 px-1 pt-1">
                      <span class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{surface.surfaceName}</span>
                      <span class="h-px flex-1 bg-slate-800" aria-hidden="true"></span>
                      <span class="text-[10px] tabular-nums text-slate-600">{surface.features.length}</span>
                    </div>
                    {#each surface.features as feature, i (feature.id)}
                      {@render FeatureCard(coreFeatureId, feature, i)}
                    {/each}
                  </div>
                {/each}
              </div>
            {/if}
          </section>
        </div>
      </div>
    {:else}
      <section>
        <div class="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-white">Projects</h2>
            <p class="text-sm text-slate-500">Pick a project to open its build map and queue.</p>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            {@render ActiveTagFilter()}
            <p class="text-xs text-slate-500">
              {builderModeStore.filteredProjects.length}{builderModeStore.searchActive || builderModeStore.tagActive ? ` of ${builderModeStore.projectCount}` : ' total'}
            </p>
          </div>
        </div>
        <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {#each builderModeStore.filteredProjects as project, i (project.id)}
            <li
              in:fly={{ y: 10, duration: motionMs(300), delay: stagger(i), easing: cubicOut }}
              class="project-card-shell"
            >
              <article class="project-card group relative h-full min-h-44 overflow-hidden">
                <!-- Full-card select target. Sits above the plain content (z-10)
                     so a click anywhere opens the project; the tag chips poke
                     back above it (z-20) so they stay independently clickable. -->
                <button
                  type="button"
                  class="absolute inset-0 z-10 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                  onclick={() => builderModeStore.selectProject(project.id)}
                  aria-label={`Open ${project.name}`}
                ></button>
                <div class="project-card__button flex h-full w-full flex-col justify-between p-5 text-left">
                  <div class="project-card__top space-y-2">
                    <div class="flex items-start justify-between gap-3">
                      <h3 class="min-w-0 truncate text-base font-semibold text-white">{project.name}</h3>
                      <span class="project-card__count shrink-0">
                        {project.coreFeatures.length} core / {projectFeatureCount(project)} feat
                      </span>
                    </div>
                    <BuilderTagChips
                      tags={project.tags}
                      onToggle={(tag) => builderModeStore.toggleTag(tag)}
                      isActive={(tag) => builderModeStore.isActiveTag(tag)}
                      onAdd={(type, value) => builderModeStore.addProjectTag(project.id, { type, value })}
                      onRemove={(tag) => builderModeStore.removeProjectTag(project.id, tag)}
                      onRename={(from, to) => builderModeStore.renameTag(from, to)}
                      typeOptions={builderModeStore.allTagTypes}
                      collapsible
                      class="relative z-20"
                    />
                  </div>
                  <div class="project-card__scores mt-5 flex items-center justify-center gap-10 pt-5">
                    <GameScore label="Maturity" value={project.maturityPercentage} />
                    <GameScore label="Built" value={project.implementationPercentage} />
                  </div>
                </div>
              </article>
            </li>
          {/each}
          <!-- Placeholders for projects still streaming in (progressive load).
               Only while not searching/filtering, where the visible set equals
               the loaded set. -->
          {#if builderModeStore.pendingProjectCount > 0 && !builderModeStore.searchActive && !builderModeStore.tagActive}
            {#each Array.from({ length: builderModeStore.pendingProjectCount }) as _, i (`pending-${i}`)}
              <li class="builder-skeleton__card" aria-hidden="true">
                <div class="flex items-center justify-between gap-3">
                  <span class="builder-skeleton__shape h-2.5 w-3/5 rounded-full"></span>
                  <span class="builder-skeleton__shape h-4 w-14 rounded-full"></span>
                </div>
                <div class="flex justify-center gap-10 pt-5">
                  <span class="builder-skeleton__shape size-11 rounded-full"></span>
                  <span class="builder-skeleton__shape size-11 rounded-full"></span>
                </div>
              </li>
            {/each}
          {/if}
        </ul>
      </section>
    {/if}
  </div>
</div>

<!-- Floating, always-in-view build queue. Only meaningful while a project is
     selected (the queue is per-project). Minimizes to a bubble. -->
{#if builderModeStore.selectedProject}
  {@render QueueWidget()}
{/if}

{#snippet ActiveTagFilter()}
  {#if builderModeStore.activeTag}
    {@const tag = builderModeStore.activeTag}
    <button
      type="button"
      class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-500/50 bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-200 transition hover:bg-brand-500/20"
      onclick={() => builderModeStore.clearTag()}
      title={`Clear tag filter: ${humanizeTagText(tag.type)} · ${humanizeTagText(tag.value)}`}
    >
      <span class="text-brand-300/70">Tag</span>
      <span class="font-semibold">{humanizeTagText(tag.value)}</span>
      <span aria-hidden="true">✕</span>
    </button>
  {/if}
{/snippet}

{#snippet QueuePositionBadge(position: number)}
  <span
    class="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-white/25 px-1 text-[10px] font-bold leading-none tabular-nums"
    title={`Build queue position #${position}`}
  >{position}</span>
{/snippet}

{#snippet QueueButton(featureId: string, actionId: string)}
  {@const position = builderModeStore.queuePositionForAction(featureId, actionId)}
  {@const queued = position !== null}
  <button
    type="button"
    class="relative z-20 inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition {queued
      ? 'border-brand-400 bg-brand-500 text-white shadow-sm shadow-brand-500/30'
      : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-brand-500 hover:text-brand-300'}"
    onclick={() => builderModeStore.toggleAction(featureId, actionId)}
    aria-pressed={queued}
    title={queued ? `In build queue at position #${position} (click to remove)` : 'Add to build queue'}
  >
    {#if position !== null}
      {@render QueuePositionBadge(position)}
      <span>Queued</span>
    {:else}
      + Implement
    {/if}
  </button>
{/snippet}

{#snippet QueueFeatureButton(featureId: string)}
  {@const position = builderModeStore.queuePositionForFeature(featureId)}
  {@const queued = position !== null}
  <button
    type="button"
    class="relative z-20 inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition {queued
      ? 'border-brand-400 bg-brand-500 text-white shadow-sm shadow-brand-500/30'
      : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-brand-500 hover:text-brand-300'}"
    onclick={() => builderModeStore.toggleFeature(featureId)}
    aria-pressed={queued}
    title={queued
      ? `Whole feature queued at position #${position} — the build implements whatever is still missing (click to remove)`
      : 'Queue the whole feature: implement everything still missing'}
  >
    {#if position !== null}
      {@render QueuePositionBadge(position)}
      <span>Queued</span>
    {:else}
      + Implement all
    {/if}
  </button>
{/snippet}

<style>
  .project-card-shell {
    filter: drop-shadow(0 16px 22px rgba(0, 0, 0, 0.28));
    transition: filter 360ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  /* The cast shadow grows as the panel lifts — sells the raise, not just the offset. */
  .project-card-shell:has(.project-card:hover),
  .project-card-shell:has(.project-card:focus-within) {
    filter: drop-shadow(0 24px 34px rgba(0, 0, 0, 0.44));
  }

  .project-card {
    border: 1px solid rgba(68, 83, 103, 0.78);
    border-radius: 12px;
    background:
      /* faint vertical brushing so the plate reads as machined metal, not flat fill */
      repeating-linear-gradient(
        96deg,
        rgba(255, 255, 255, 0.014) 0,
        rgba(255, 255, 255, 0.014) 1px,
        transparent 1px,
        transparent 4px
      ),
      radial-gradient(circle at 14% 8%, rgba(226, 232, 240, 0.13), transparent 23%),
      radial-gradient(circle at 0% 45%, rgba(96, 165, 250, 0.07), transparent 34%),
      linear-gradient(180deg, rgba(38, 53, 69, 0.82) 0%, rgba(23, 35, 51, 0.76) 48%, rgba(10, 20, 35, 0.82) 100%);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.11) inset,
      0 -1px 0 rgba(2, 6, 23, 0.9) inset,
      1px 0 0 rgba(255, 255, 255, 0.05) inset,
      -1px 0 0 rgba(2, 6, 23, 0.7) inset,
      0 0 0 4px rgba(2, 6, 23, 0.16) inset,
      0 -18px 30px rgba(2, 6, 23, 0.5) inset;
    transform: translateY(0);
    transition:
      transform 280ms cubic-bezier(0.34, 1.4, 0.5, 1),
      box-shadow 360ms cubic-bezier(0.22, 1, 0.36, 1),
      border-color 220ms ease;
    will-change: transform;
  }

  .project-card::before {
    content: "";
    position: absolute;
    inset: 8px;
    z-index: 0;
    border: 1px solid rgba(148, 163, 184, 0.11);
    /* concentric with the 12px outer radius at an 8px inset (12 − 8 ≈ 4) */
    border-radius: 5px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 38%),
      linear-gradient(90deg, rgba(125, 150, 178, 0.08), transparent 34%);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.04) inset,
      0 8px 18px rgba(2, 6, 23, 0.22) inset;
    opacity: 0.88;
    pointer-events: none;
  }

  .project-card::after {
    content: "";
    position: absolute;
    left: 10px;
    right: 10px;
    top: 0;
    height: 1px;
    background:
      linear-gradient(90deg, transparent, rgba(226, 232, 240, 0.24), transparent);
    opacity: 0.72;
    pointer-events: none;
  }

  .project-card:hover,
  .project-card:focus-within {
    border-color: rgba(98, 115, 137, 0.9);
    box-shadow:
      0 0 20px rgba(148, 163, 184, 0.07),
      0 2px 0 rgba(255, 255, 255, 0.11) inset,
      0 -1px 0 rgba(2, 6, 23, 0.9) inset,
      1px 0 0 rgba(255, 255, 255, 0.06) inset,
      -1px 0 0 rgba(2, 6, 23, 0.7) inset,
      0 0 0 4px rgba(2, 6, 23, 0.14) inset,
      0 -18px 30px rgba(2, 6, 23, 0.5) inset;
    transform: translateY(-3px);
  }

  .project-card:active {
    transform: translateY(1px);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.08) inset,
      0 -1px 0 rgba(2, 6, 23, 0.9) inset,
      0 0 0 4px rgba(2, 6, 23, 0.2) inset,
      0 -10px 20px rgba(2, 6, 23, 0.5) inset;
  }

  /*
   * Layout/padding wrapper for the project card body. Intentionally NOT a
   * stacking context (no z-index): the select-overlay button sits at z-10 and
   * the tag chips at z-20 — if this wrapper created a context at z-1 the chips
   * could never rise above the overlay. `position: relative` is still fine; it
   * only establishes a context when paired with a z-index.
   */
  .project-card__button {
    position: relative;
    min-height: inherit;
    color: inherit;
  }

  .project-card__count {
    border: 1px solid rgba(71, 85, 105, 0.88);
    border-radius: 8px;
    background:
      linear-gradient(180deg, rgba(51, 65, 85, 0.9), rgba(15, 23, 42, 0.9));
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.08) inset,
      0 -1px 0 rgba(2, 6, 23, 0.9) inset;
    padding: 2px 8px;
    color: rgb(203, 213, 225);
    font-size: 11px;
    font-weight: 600;
  }

  .project-card__scores {
    border-top: 1px solid rgba(15, 23, 42, 0.92);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.07) inset;
  }

  /* ── Shared engraved-metal card: core features + feature list ──────────────
     Same top-left light model as .project-card, tuned lighter for dense lists. */
  .skeuo-card {
    position: relative;
    border: 1px solid rgba(68, 83, 103, 0.7);
    border-radius: 12px;
    background:
      repeating-linear-gradient(
        96deg,
        rgba(255, 255, 255, 0.012) 0,
        rgba(255, 255, 255, 0.012) 1px,
        transparent 1px,
        transparent 4px
      ),
      radial-gradient(circle at 12% 4%, rgba(226, 232, 240, 0.1), transparent 26%),
      linear-gradient(180deg, rgba(38, 53, 69, 0.7) 0%, rgba(20, 31, 47, 0.72) 52%, rgba(10, 19, 33, 0.78) 100%);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.09) inset,
      0 -1px 0 rgba(2, 6, 23, 0.85) inset,
      1px 0 0 rgba(255, 255, 255, 0.04) inset,
      -1px 0 0 rgba(2, 6, 23, 0.6) inset,
      0 -14px 26px rgba(2, 6, 23, 0.4) inset;
    /* Multi-timing so it feels physical: the panel pops up on a lightly
       overshooting curve while its cast shadow eases a touch slower (lags). */
    transition:
      transform 260ms cubic-bezier(0.34, 1.4, 0.5, 1),
      box-shadow 340ms cubic-bezier(0.22, 1, 0.36, 1),
      border-color 220ms ease,
      background-color 360ms cubic-bezier(0.22, 1, 0.36, 1);
    will-change: transform, box-shadow;
  }

  .skeuo-card::after {
    content: "";
    position: absolute;
    left: 10px;
    right: 10px;
    top: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(226, 232, 240, 0.2), transparent);
    opacity: 0.66;
    pointer-events: none;
  }

  /* Inner "feature" (action) cards get a subtly cooler, indigo-tinted plate so
     they stay distinguishable from the blue-slate core-feature cards — notably
     when the two columns collapse into one vertical stack on small screens. */
  .skeuo-card--feature {
    background:
      repeating-linear-gradient(
        96deg,
        rgba(255, 255, 255, 0.012) 0,
        rgba(255, 255, 255, 0.012) 1px,
        transparent 1px,
        transparent 4px
      ),
      radial-gradient(circle at 12% 4%, rgba(199, 210, 254, 0.09), transparent 26%),
      linear-gradient(180deg, rgba(46, 48, 78, 0.62) 0%, rgba(30, 30, 56, 0.66) 52%, rgba(17, 17, 38, 0.74) 100%);
  }

  /* Clickable cards (core features, features): lift with a cast shadow, press on click. */
  .skeuo-card--interactive:hover,
  .skeuo-card--interactive:focus-within {
    border-color: rgba(98, 115, 137, 0.92);
    box-shadow:
      0 14px 24px rgba(2, 6, 23, 0.5),
      0 0 16px rgba(148, 163, 184, 0.05),
      0 2px 0 rgba(255, 255, 255, 0.1) inset,
      0 -1px 0 rgba(2, 6, 23, 0.85) inset,
      1px 0 0 rgba(255, 255, 255, 0.05) inset,
      -1px 0 0 rgba(2, 6, 23, 0.6) inset,
      0 -14px 26px rgba(2, 6, 23, 0.4) inset;
    transform: translateY(-2px);
  }

  .skeuo-card--interactive:active {
    transform: translateY(0);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.07) inset,
      0 -1px 0 rgba(2, 6, 23, 0.85) inset,
      0 -8px 16px rgba(2, 6, 23, 0.45) inset;
  }

  /* Selected core feature: same metal, brand (cyan) tint + halo.
     The tint rides background-color (not the gradient) so it can transition;
     the cyan shows through the semi-opaque metal gradient above it. */
  .skeuo-card--active {
    border-color: rgba(6, 182, 212, 0.55);
    background-color: rgba(6, 182, 212, 0.38);
    box-shadow:
      0 0 0 1px rgba(6, 182, 212, 0.32),
      0 0 24px rgba(6, 182, 212, 0.12),
      0 1px 0 rgba(255, 255, 255, 0.12) inset,
      0 -1px 0 rgba(2, 6, 23, 0.85) inset,
      0 -14px 26px rgba(2, 6, 23, 0.38) inset;
  }

  /* "Waiting for content" sheen on the pinned prompt: a soft metallic light
     passes across the dashed placeholder, in the same engraved-metal language.
     Only while pinned + centred (xl); the reduce-motion block below stops it. */
  @media (min-width: 1280px) {
    .prompt-card::after {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 1;
      border-radius: inherit;
      background: linear-gradient(
        105deg,
        transparent 28%,
        rgba(226, 232, 240, 0.1) 46%,
        rgba(255, 255, 255, 0.06) 54%,
        transparent 72%
      );
      transform: translateX(-120%);
      opacity: 0;
      pointer-events: none;
    }

    .prompt-card.is-waiting::after {
      animation: prompt-sheen 2.6s ease-in-out infinite;
    }
  }

  @keyframes prompt-sheen {
    0% {
      transform: translateX(-120%);
      opacity: 0;
    }

    14% {
      opacity: 1;
    }

    60% {
      opacity: 1;
    }

    100% {
      transform: translateX(120%);
      opacity: 0;
    }
  }

  /* Minimalist load state — neutral skeleton cards, no accent color or frame. */
  .builder-skeleton__card {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 11rem;
    padding: 1.25rem;
    border-radius: 12px;
    border: 1px solid rgba(51, 65, 85, 0.35);
    background: rgba(148, 163, 184, 0.025);
    opacity: 0;
    transform: translateY(6px);
    animation: builder-skeleton-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: var(--d, 0ms);
  }

  /* A single soft light sweeps across every placeholder — low-contrast, slate
     only, so the load reads as calm rather than decorative. */
  .builder-skeleton__shape {
    background: linear-gradient(
      100deg,
      rgba(148, 163, 184, 0.06) 30%,
      rgba(148, 163, 184, 0.16) 50%,
      rgba(148, 163, 184, 0.06) 70%
    );
    background-size: 220% 100%;
    animation: builder-shimmer 1.5s ease-in-out infinite;
  }

  @keyframes builder-skeleton-in {
    to {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes builder-shimmer {
    from {
      background-position: 180% 0;
    }

    to {
      background-position: -40% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .builder-skeleton__card {
      animation: none;
      opacity: 1;
      transform: none;
    }

    .builder-skeleton__shape {
      animation: none;
    }

    .project-card,
    .project-card-shell,
    .skeuo-card {
      transition: none;
    }

    .project-card:hover,
    .project-card:focus-within,
    .project-card:active,
    .skeuo-card--interactive:hover,
    .skeuo-card--interactive:focus-within,
    .skeuo-card--interactive:active {
      transform: none;
    }

    .prompt-card.is-waiting::after {
      animation: none;
    }
  }
</style>

{#snippet SuggestionList(featureId: string, suggestions: readonly BuilderModeSuggestion[])}
  <ul class="space-y-2">
    {#each suggestions as suggestion, i (suggestion.id)}
      <li
        in:fly={{ y: 6, duration: motionMs(240), delay: stagger(i), easing: cubicOut }}
        class="flex items-start gap-2 text-sm leading-5 text-slate-300"
      >
        <span
          class="mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide {suggestion.tone === 'urgent'
            ? 'bg-rose-500/15 text-rose-300'
            : 'bg-violet-500/15 text-violet-300'}"
        >
          {suggestionLabel(suggestion)}
        </span>
        <span class="min-w-0 flex-1">{suggestion.text}</span>
        {#if builderModeStore.isBusy(suggestion.id)}
          <svg class="h-4 w-4 shrink-0 animate-spin text-brand-400" viewBox="0 0 24 24" fill="none" aria-label="Working" role="status">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
            <path class="opacity-90" fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z" />
          </svg>
        {:else}
          <button
            type="button"
            class="relative z-20 shrink-0 rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-brand-500 hover:bg-brand-500 hover:text-white"
            onclick={() => builderModeStore.acceptSuggestion(featureId, suggestion.id)}
            title="Accept this idea (turn it into a feature) and add it to the build queue"
          >
            + Implement
          </button>
          <button
            type="button"
            class="shrink-0 rounded-md p-1 text-slate-500 transition hover:bg-slate-700 hover:text-rose-300"
            onclick={() => builderModeStore.dismissSuggestion(featureId, suggestion.id)}
            aria-label="Dismiss suggestion"
            title="Dismiss this suggestion (the assistant won't suggest it again)"
          >
            ✕
          </button>
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet FeatureCard(coreFeatureId: string, feature: BuilderModeFeature, index: number)}
  <article
    in:fly={{ y: 10, duration: motionMs(280), delay: stagger(index), easing: cubicOut }}
    class="skeuo-card skeuo-card--interactive skeuo-card--feature p-4"
  >
    <div class="flex items-center gap-2">
      <h4 class="truncate text-base font-semibold text-white">{feature.name}</h4>
      {@render QueueButton(coreFeatureId, feature.id)}
    </div>
    <ClampedDescription text={feature.description} class="mt-1" />
    <div class="mt-3 flex items-center gap-6 border-t border-slate-800 pt-3">
      <GameScore label="Maturity" value={feature.maturityPercentage} />
      <GameScore label="Built" value={feature.implementationPercentage} />
    </div>
  </article>
{/snippet}

<!-- One labelled goal bar for a metric: filled to the item's CURRENT score
     (slate), the user drags the thumb beyond it to set a goal (tone-colored). -->
{#snippet GoalBar(view: QueueView, metric: QueueTargetMetric, label: string)}
  {@const current = builderModeStore.currentScoreFor(view, metric)}
  {@const goal = isDraggingBar(view, metric) ? dragValue : (storedGoal(view, metric) ?? current)}
  {@const hasGoal = goal > current}
  <div class="flex items-center gap-2">
    <span class="w-12 shrink-0 text-slate-400">{label}</span>
    <div
      role="slider"
      tabindex="0"
      aria-label={`${label} goal for ${queueTitle(view)}`}
      aria-valuemin={current}
      aria-valuemax={100}
      aria-valuenow={goal}
      class="relative h-2.5 flex-1 cursor-pointer touch-none rounded-full bg-slate-800 select-none"
      onpointerdown={(e) => onGoalBarDown(e, view, metric, current)}
      onpointermove={(e) => onGoalBarMove(e, view, metric, current)}
      onpointerup={() => onGoalBarUp(view, metric, current)}
      onkeydown={(e) => onGoalBarKey(e, view, metric, current)}
      title="Drag beyond the current score to set how far to take it (up to 100%)"
    >
      <div class="absolute inset-y-0 left-0 rounded-full bg-slate-500" style="width: {current}%"></div>
      {#if hasGoal}
        <div
          class="absolute inset-y-0 rounded-full"
          style="left: {current}%; width: {goal - current}%; background-color: {goalToneColor(goal)}"
        ></div>
      {/if}
      <div
        class="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 shadow shadow-black/30"
        style="left: {goal}%; background-color: {goalToneColor(goal)}"
      ></div>
    </div>
    <span class="w-14 shrink-0 text-right tabular-nums text-slate-400">
      {current}%{hasGoal ? ` → ${goal}%` : ''}
    </span>
  </div>
{/snippet}

<!-- Per-item goals: a Maturity bar, a Built bar, and a "report it's in the
     code" presence flag — each independent. Ride along to the assistant via
     the MCP queue tools. -->
{#snippet QueueTargetControl(view: QueueView)}
  {@const target = view.item.target}
  <div class="mt-1.5 space-y-1 pl-8 text-[10px]">
    {@render GoalBar(view, 'maturity', 'Maturity')}
    {@render GoalBar(view, 'implementation', 'Built')}
    <div class="flex items-center justify-between gap-2 pt-0.5">
      <label class="inline-flex cursor-pointer items-center gap-1.5 text-slate-400">
        <input
          type="checkbox"
          checked={Boolean(target?.report)}
          onchange={() => toggleReport(view)}
          class="h-3 w-3 rounded border-slate-600 bg-slate-900 accent-brand-500"
        />
        Report it's in the code
      </label>
      {#if target}
        <button
          type="button"
          class="shrink-0 rounded px-1 text-slate-500 transition hover:text-slate-200"
          onclick={() => clearQueueTargetFor(view)}
          title="Clear all goals for this item"
        >Clear</button>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet QueueWidget()}
  {#if queueOpen}
    <section class="fixed bottom-5 right-5 z-40 flex max-h-[70vh] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/95 shadow-2xl shadow-black/50 ring-1 ring-black/20 backdrop-blur">
      <header class="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 bg-linear-to-b from-slate-800/70 to-slate-800/30 px-4 py-3">
        <div class="flex items-center gap-2">
          <span class="text-brand-400" aria-hidden="true">▶</span>
          <span class="text-sm font-semibold text-white">Build queue</span>
          <span class="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-bold tabular-nums text-white">
            {builderModeStore.queue.length}
          </span>
        </div>
        <button
          type="button"
          class="rounded-md p-1 text-slate-400 transition hover:bg-slate-700 hover:text-white"
          onclick={() => (queueOpen = false)}
          aria-label="Minimize build queue"
          title="Minimize"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        {#if builderModeStore.queue.length === 0}
          <p class="text-sm leading-6 text-slate-400">
            Nothing queued yet. Hit <span class="font-semibold text-brand-300">+ Implement</span> on a suggestion or feature to plan the build.
          </p>
        {:else}
          <ol class="space-y-2">
            {#each builderModeStore.queue as view, index (String(view.item.id))}
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <!-- Only the ⠿ handle is draggable. A draggable="true" on the whole
                   row makes its buttons/inputs (the Goal controls) ignore clicks
                   and refuse focus, so dragging is scoped to the handle. -->
              <li
                ondragover={(e) => onQueueDragOver(e, index)}
                ondrop={() => onQueueDrop(index)}
                ondragend={onQueueDragEnd}
                class="rounded-lg border bg-slate-800/40 px-3 py-2 transition {view.orphaned
                  ? 'opacity-60'
                  : ''} {dragIndex === index ? 'opacity-40' : ''} {dragOverIndex === index && dragIndex !== null && dragIndex !== index
                  ? 'border-brand-400 ring-1 ring-brand-400'
                  : 'border-slate-800'}"
              >
                <div class="flex items-center gap-2">
                  <span
                    draggable="true"
                    ondragstart={() => onQueueDragStart(index)}
                    ondragend={onQueueDragEnd}
                    class="shrink-0 cursor-grab select-none px-0.5 text-slate-500"
                    title="Drag to reorder"
                    aria-hidden="true"
                  >⠿</span>
                  <span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500 text-xs font-bold tabular-nums text-white">
                    {index + 1}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium text-white">{queueTitle(view)}</span>
                    <span class="block truncate text-xs text-slate-400">
                      {queueSubtitle(view)}
                    </span>
                  </span>
                  <button
                    type="button"
                    class="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-700 hover:text-white"
                    onclick={() => builderModeStore.dequeue(view.item.id)}
                    aria-label="Remove from build queue"
                    title="Remove from queue"
                  >
                    ✕
                  </button>
                </div>
                {@render QueueTargetControl(view)}
              </li>
            {/each}
          </ol>
        {/if}
      </div>
    </section>
  {:else}
    <button
      type="button"
      class="group fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/95 py-2.5 pl-4 pr-3 text-sm font-semibold text-white shadow-2xl shadow-black/40 ring-1 ring-black/20 backdrop-blur transition hover:border-brand-500 hover:shadow-brand-500/20"
      onclick={() => (queueOpen = true)}
      aria-label="Open build queue"
      title="Build queue"
    >
      <span class="text-brand-400 transition group-hover:translate-x-0.5" aria-hidden="true">▶</span>
      Build queue
      <span class="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-bold tabular-nums text-white">
        {builderModeStore.queue.length}
      </span>
    </button>
  {/if}
{/snippet}
