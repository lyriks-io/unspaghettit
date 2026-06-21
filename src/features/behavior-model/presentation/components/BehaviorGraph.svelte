<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import {
    ALL_BEHAVIOR_GRAPH_EDGE_KINDS,
    ALL_BEHAVIOR_GRAPH_NODE_TYPES,
    buildBehaviorGraph,
    deriveBehaviorGraphView,
    filterBehaviorGraphView,
    type BehaviorGraphEdgeKind
  } from '$features/behavior-model/domain/services/BehaviorGraphModel';
  import {
    behaviorGraphEdgeTheme,
    behaviorGraphNodeTheme
  } from '$features/behavior-model/presentation/view-models/BehaviorGraphTheme';
  import {
    VisBehaviorGraphRenderer,
    type VisNetworkRuntime
  } from '$features/behavior-model/presentation/adapters/VisBehaviorGraphRenderer';
  import type { Project } from '$features/projects/domain/entities/Project';

  type Props = {
    feature?: Feature;
    features?: readonly Feature[];
    project?: Project;
  };
  let { feature, features, project }: Props = $props();

  let search = $state('');
  let selectedId = $state<string | null>(null);
  let selectedEdgeId = $state<string | null>(null);
  let labelsVisible = $state(false);
  let physicsSettled = $state(false);
  let stabilizationProgress = $state(0);
  let graphContainer = $state<HTMLDivElement | null>(null);
  let renderer: VisBehaviorGraphRenderer | null = null;

  let enabledKinds = $state<Record<BehaviorGraphEdgeKind, boolean>>({
    // `contains` is the structural skeleton (project → feature → surface →
    // action) and dominates the canvas; start it OFF so the behavioral edges
    // (reads/writes/emits/…) read clearly. Users can toggle it back on.
    contains: false,
    reads: true,
    writes: true,
    emits: true,
    transitions: true,
    asserts: true,
    uses: true,
    handles: true
  });

  // Floating "smart" filter menu over the map.
  let filtersOpen = $state(false);
  let filtersMenuRef = $state<HTMLDivElement | null>(null);

  const totalKindCount = ALL_BEHAVIOR_GRAPH_EDGE_KINDS.length;
  const activeKindCount = $derived(
    ALL_BEHAVIOR_GRAPH_EDGE_KINDS.filter((kind) => enabledKinds[kind]).length
  );

  const setAllKinds = (value: boolean): void => {
    enabledKinds = Object.fromEntries(
      ALL_BEHAVIOR_GRAPH_EDGE_KINDS.map((kind) => [kind, value])
    ) as Record<BehaviorGraphEdgeKind, boolean>;
  };

  const handleWindowMouseDown = (event: MouseEvent): void => {
    if (filtersOpen && filtersMenuRef && !filtersMenuRef.contains(event.target as Node)) {
      filtersOpen = false;
    }
  };

  const sourceFeatures = $derived(features ?? (feature ? [feature] : []));
  const graphTitle = $derived(project?.name ?? feature?.name ?? 'Behavior graph');
  const graphSubtitle = $derived(
    project
      ? `The whole project behavior map across ${sourceFeatures.length} feature${sourceFeatures.length === 1 ? '' : 's'} from the shared Unspa hub.`
      : 'A connected map of the executable behavior model from the shared Unspa hub.'
  );
  const backHref = $derived(project ? `/projects/${project.id}` : feature ? `/features/${feature.id}` : '/projects');
  const backLabel = $derived(project ? 'Back to project' : 'Back to editor');

  const rawGraph = $derived(buildBehaviorGraph(sourceFeatures, project));
  const graph = $derived(deriveBehaviorGraphView(rawGraph));
  const filteredGraph = $derived(
    filterBehaviorGraphView(graph, {
      search,
      enabledKinds
    })
  );

  const selectedNode = $derived(selectedId ? graph.nodeById.get(selectedId) ?? null : null);
  const selectedEdge = $derived(
    selectedEdgeId ? filteredGraph.edges.find((edge) => edge.id === selectedEdgeId) ?? null : null
  );
  const selectedEdgeFrom = $derived(selectedEdge ? graph.nodeById.get(selectedEdge.from) ?? null : null);
  const selectedEdgeTo = $derived(selectedEdge ? graph.nodeById.get(selectedEdge.to) ?? null : null);
  const centralNodes = $derived([...graph.nodes].sort((a, b) => b.degree - a.degree).slice(0, 6));
  const countsByType = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const node of graph.nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    return counts;
  });

  const renderGraph = (): void => {
    renderer?.render({
      graph: filteredGraph,
      selectedId,
      selectedEdgeId,
      labelsVisible,
      nodeTheme: behaviorGraphNodeTheme,
      edgeTheme: behaviorGraphEdgeTheme
    });
  };

  const toggleKind = (kind: BehaviorGraphEdgeKind): void => {
    enabledKinds = { ...enabledKinds, [kind]: !enabledKinds[kind] };
  };

  const resetView = (): void => {
    selectedId = null;
    selectedEdgeId = null;
    search = '';
    renderer?.fit();
  };

  const focusNode = (nodeId: string): void => {
    selectedId = nodeId;
    selectedEdgeId = null;
    renderer?.select(nodeId, null);
  };

  $effect(() => {
    filteredGraph.nodes;
    filteredGraph.edges;
    labelsVisible;
    selectedId;
    selectedEdgeId;
    renderGraph();
  });

  onMount(() => {
    let disposed = false;
    const handleResize = (): void => renderer?.fit();
    void (async () => {
      const runtime = (await import('vis-network/standalone')) as VisNetworkRuntime;
      if (disposed || !graphContainer) return;
      renderer = new VisBehaviorGraphRenderer(runtime, graphContainer, {
        onSelectedNodeChange: (id) => {
          selectedId = id;
        },
        onSelectedEdgeChange: (id) => {
          selectedEdgeId = id;
        },
        onStabilizationProgress: (progress) => {
          stabilizationProgress = progress;
        },
        onSettledChange: (settled) => {
          physicsSettled = settled;
        }
      });
      renderGraph();
      window.addEventListener('resize', handleResize);
    })();
    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
    };
  });

  onDestroy(() => {
    renderer?.destroy();
    renderer = null;
  });
</script>

<svelte:window
  onmousedown={handleWindowMouseDown}
  onkeydown={(e) => {
    if (e.key === 'Escape') filtersOpen = false;
  }}
/>

<section class="space-y-4">
  <div class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
    <div class="border-b border-slate-200 bg-slate-950 px-4 py-4 text-white">
      <!-- Back link: top-left, no box — it sits directly on the header so its
           background is the header's own colour (blends in any theme). -->
      <a
        href={backHref}
        class="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 transition hover:text-white"
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
          <path d="M15 18l-6-6 6-6" />
        </svg>
        {backLabel}
      </a>
      <div class="mt-3 min-w-0">
        <p class="text-xs font-semibold uppercase tracking-wide text-cyan-200">Behavior Graph</p>
        <h2 class="mt-1 truncate text-2xl font-semibold">{graphTitle}</h2>
        <p class="mt-1 max-w-3xl text-sm leading-6 text-slate-300">{graphSubtitle}</p>
      </div>
    </div>

    <div class="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div class="min-w-0 border-b border-slate-200 lg:border-b-0 lg:border-r">
        <div class="graph-canvas relative">
          <div
            bind:this={graphContainer}
            class="h-[76vh] min-h-[720px] w-full"
            aria-label={`Interactive behavior graph for ${graphTitle}`}
          ></div>

          <!-- Top-right: search + the smart filter menu, floated over the map. -->
          <div class="absolute right-3 top-3 z-10 flex items-start gap-2">
            <div class="relative">
              <label for="graph-search" class="sr-only">Search nodes</label>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                id="graph-search"
                type="search"
                bind:value={search}
                placeholder="Search nodes"
                class="h-9 w-44 rounded-lg border border-slate-200 bg-white/95 pl-8 pr-3 text-sm shadow-sm outline-none backdrop-blur transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15 sm:w-60"
              />
            </div>
            <div class="relative" bind:this={filtersMenuRef}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={filtersOpen}
                onclick={() => (filtersOpen = !filtersOpen)}
                class="flex h-9 items-center gap-1.5 rounded-lg border bg-white/95 px-2.5 text-sm font-medium shadow-sm backdrop-blur transition {filtersOpen
                  ? 'border-brand-400 text-slate-900'
                  : 'border-slate-200 text-slate-700 hover:bg-white'}"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.9"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M3 5h18l-7 8v6l-4-2v-4z" />
                </svg>
                <span class="hidden sm:inline">Filters</span>
                <span class="rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600">
                  {activeKindCount}/{totalKindCount}
                </span>
              </button>
              {#if filtersOpen}
                <div
                  role="menu"
                  class="absolute right-0 top-11 z-20 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-950/10"
                >
                  <div class="flex items-center justify-between px-2 pb-1 pt-1">
                    <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Connections
                    </span>
                    <div class="flex gap-1">
                      <button
                        type="button"
                        onclick={() => setAllKinds(true)}
                        class="rounded px-1.5 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-50"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onclick={() => setAllKinds(false)}
                        class="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  {#each ALL_BEHAVIOR_GRAPH_EDGE_KINDS as kind}
                    {@const on = enabledKinds[kind]}
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onclick={() => toggleKind(kind)}
                      class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-slate-50"
                    >
                      <span
                        class="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={`background:${behaviorGraphEdgeTheme[kind].color};opacity:${on ? 1 : 0.3}`}
                      ></span>
                      <span class="flex-1 truncate {on ? 'text-slate-800' : 'text-slate-400'}">
                        {behaviorGraphEdgeTheme[kind].label}
                      </span>
                      {#if on}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.2"
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
                  <div class="my-1 h-px bg-slate-100"></div>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={labelsVisible}
                    onclick={() => (labelsVisible = !labelsVisible)}
                    class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-slate-50"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="h-4 w-4 shrink-0 text-slate-400"
                      aria-hidden="true"
                    >
                      <path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L3 13V4h9z" />
                      <path d="M7.5 7.5h.01" />
                    </svg>
                    <span class="flex-1 {labelsVisible ? 'text-slate-800' : 'text-slate-600'}">Labels</span>
                    {#if labelsVisible}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="h-4 w-4 shrink-0 text-brand-600"
                        aria-hidden="true"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    {/if}
                  </button>
                  <div class="my-1 h-px bg-slate-100"></div>
                  <div class="flex gap-1.5 px-1 pb-1 pt-0.5">
                    <button
                      type="button"
                      onclick={() => renderer?.relayout(filteredGraph.nodes.length)}
                      class="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Re-layout
                    </button>
                    <button
                      type="button"
                      onclick={() => {
                        resetView();
                        filtersOpen = false;
                      }}
                      class="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          </div>

          <!-- Bottom-right: Google-Maps-style zoom + fit control. -->
          <div
            class="absolute bottom-3 right-3 z-10 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-sm backdrop-blur"
          >
            <button
              type="button"
              aria-label="Zoom in"
              onclick={() => renderer?.zoomBy(1.38)}
              class="grid h-9 w-9 place-items-center text-lg font-semibold leading-none text-slate-700 transition hover:bg-slate-100"
            >
              +
            </button>
            <div class="h-px bg-slate-200"></div>
            <button
              type="button"
              aria-label="Zoom out"
              onclick={() => renderer?.zoomBy(0.72)}
              class="grid h-9 w-9 place-items-center text-lg font-semibold leading-none text-slate-700 transition hover:bg-slate-100"
            >
              −
            </button>
            <div class="h-px bg-slate-200"></div>
            <button
              type="button"
              aria-label="Fit graph to view"
              onclick={() => renderer?.fit()}
              class="grid h-9 w-9 place-items-center text-slate-700 transition hover:bg-slate-100"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M4 9V5a1 1 0 0 1 1-1h4" />
                <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
                <path d="M4 15v4a1 1 0 0 0 1 1h4" />
                <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
              </svg>
            </button>
          </div>

          {#if !physicsSettled && stabilizationProgress < 100}
            <div class="pointer-events-none absolute left-3 top-3 z-10 w-56 rounded-md border border-slate-200 bg-white/90 p-3 text-xs text-slate-600 shadow-sm backdrop-blur">
              <div class="flex justify-between font-medium text-slate-800">
                <span>Stabilizing layout</span>
                <span>{stabilizationProgress}%</span>
              </div>
              <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div class="h-full rounded-full bg-brand-500 transition-all" style={`width:${stabilizationProgress}%`}></div>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <aside class="space-y-4 p-4">
        <div>
          <h3 class="text-sm font-semibold text-slate-950">Graph Summary</h3>
          <div class="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div class="rounded-md bg-slate-100 p-3">
              <div class="text-2xl font-semibold text-slate-950">{graph.nodes.length}</div>
              <div class="text-xs text-slate-500">nodes</div>
            </div>
            <div class="rounded-md bg-slate-100 p-3">
              <div class="text-2xl font-semibold text-slate-950">{graph.edges.length}</div>
              <div class="text-xs text-slate-500">edges</div>
            </div>
          </div>
        </div>

        <div>
          <h3 class="text-sm font-semibold text-slate-950">Node Types</h3>
          <div class="mt-2 flex flex-wrap gap-1.5">
            {#each ALL_BEHAVIOR_GRAPH_NODE_TYPES as type}
              {#if countsByType.get(type)}
                <span
                  class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                >
                  <span
                    class="h-2 w-2 rounded-full"
                    style={`background:${behaviorGraphNodeTheme[type].fill}`}
                  ></span>
                  {behaviorGraphNodeTheme[type].label} {countsByType.get(type)}
                </span>
              {/if}
            {/each}
          </div>
        </div>

        <div>
          <h3 class="text-sm font-semibold text-slate-950">Central Nodes</h3>
          <div class="mt-2 space-y-2">
            {#each centralNodes as node}
              <button
                type="button"
                class="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left hover:border-brand-300 hover:bg-brand-50"
                onclick={() => focusNode(node.id)}
              >
                <span class="block truncate text-sm font-medium text-slate-900">{node.label}</span>
                <span class="text-xs text-slate-500">{behaviorGraphNodeTheme[node.type].label} / {node.degree} links</span>
              </button>
            {/each}
          </div>
        </div>

        <div class="rounded-md border border-slate-200 bg-slate-50 p-3">
          {#if selectedNode}
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {behaviorGraphNodeTheme[selectedNode.type].label}
            </p>
            <h3 class="mt-1 text-base font-semibold text-slate-950">{selectedNode.label}</h3>
            {#if selectedNode.detail}
              <p class="mt-2 text-sm leading-6 text-slate-600">{selectedNode.detail}</p>
            {/if}
            <p class="mt-2 text-xs text-slate-500">{selectedNode.degree} graph links</p>
            {#if selectedNode.href}
              <a class="mt-3 inline-flex text-sm font-medium text-brand-700 hover:underline" href={selectedNode.href}>
                Open in editor
              </a>
            {/if}
          {:else if selectedEdge}
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {behaviorGraphEdgeTheme[selectedEdge.kind].label}
            </p>
            <h3 class="mt-1 text-base font-semibold text-slate-950">{selectedEdge.label ?? 'Behavior link'}</h3>
            <p class="mt-2 text-sm leading-6 text-slate-600">
              {selectedEdgeFrom?.label ?? selectedEdge.from} -> {selectedEdgeTo?.label ?? selectedEdge.to}
            </p>
            <p class="mt-2 text-xs text-slate-500">Click another node or edge to move the highlighted neighborhood.</p>
          {:else}
            <h3 class="text-sm font-semibold text-slate-950">Explore the Map</h3>
            <p class="mt-2 text-sm leading-6 text-slate-600">
              Click a node or edge to highlight its linked behavior. Hover highlighting is disabled so
              the canvas stays lighter on slower laptops.
            </p>
          {/if}
        </div>
      </aside>
    </div>
  </div>
</section>

<style>
  .graph-canvas {
    background:
      radial-gradient(circle at 50% 45%, rgba(34, 211, 238, 0.12), transparent 34rem),
      radial-gradient(circle at 15% 20%, rgba(14, 116, 144, 0.08), transparent 22rem),
      linear-gradient(#f8fafc, #eef6fb);
  }

  .graph-canvas::before {
    position: absolute;
    inset: 0;
    pointer-events: none;
    content: '';
    background-image:
      linear-gradient(rgba(15, 23, 42, 0.045) 1px, transparent 1px),
      linear-gradient(90deg, rgba(15, 23, 42, 0.045) 1px, transparent 1px);
    background-size: 28px 28px;
    mask-image: radial-gradient(circle at center, black 0, black 55%, transparent 100%);
  }
</style>
