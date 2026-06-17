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
    contains: true,
    reads: true,
    writes: true,
    emits: true,
    transitions: true,
    asserts: true,
    uses: true,
    handles: true
  });

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

<section class="space-y-4">
  <div class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
    <div class="border-b border-slate-200 bg-slate-950 px-4 py-4 text-white">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wide text-cyan-200">Behavior Graph</p>
          <h2 class="mt-1 truncate text-2xl font-semibold">{graphTitle}</h2>
          <p class="mt-1 max-w-3xl text-sm leading-6 text-slate-300">{graphSubtitle}</p>
        </div>
        <a
          href={backHref}
          class="rounded-md border border-white/20 px-3 py-2 text-sm font-medium text-white hover:bg-white/10"
        >
          {backLabel}
        </a>
      </div>
    </div>

    <div class="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div class="min-w-0 border-b border-slate-200 lg:border-b-0 lg:border-r">
        <div class="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <input
            type="search"
            bind:value={search}
            placeholder="Search nodes"
            class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-700 sm:w-64"
          />
          <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white"
            onclick={() => renderer?.relayout(filteredGraph.nodes.length)}
          >
            Re-layout
          </button>
          <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white"
            onclick={() => renderer?.fit()}
          >
            Fit
          </button>
          <div class="flex rounded-md border border-slate-300 bg-white p-1">
            <button
              type="button"
              class="rounded px-2.5 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              aria-label="Zoom out"
              onclick={() => renderer?.zoomBy(0.72)}
            >
              -
            </button>
            <button
              type="button"
              class="rounded px-2.5 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              aria-label="Zoom in"
              onclick={() => renderer?.zoomBy(1.38)}
            >
              +
            </button>
          </div>
          <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white"
            onclick={resetView}
          >
            Reset
          </button>
          <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium {labelsVisible ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-white'}"
            onclick={() => (labelsVisible = !labelsVisible)}
          >
            Labels
          </button>
          <div class="flex flex-wrap gap-1">
            {#each ALL_BEHAVIOR_GRAPH_EDGE_KINDS as kind}
              <button
                type="button"
                class="rounded-full border px-2.5 py-1 text-xs font-medium {enabledKinds[kind]
                  ? 'border-slate-300 bg-white text-slate-800'
                  : 'border-slate-200 bg-slate-100 text-slate-400'}"
                onclick={() => toggleKind(kind)}
              >
                {behaviorGraphEdgeTheme[kind].label}
              </button>
            {/each}
          </div>
        </div>

        <div class="graph-canvas relative">
          <div
            bind:this={graphContainer}
            class="h-[76vh] min-h-[720px] w-full"
            aria-label={`Interactive behavior graph for ${graphTitle}`}
          ></div>
          <div class="pointer-events-none absolute bottom-3 left-3 rounded-md border border-slate-200 bg-white/88 px-3 py-2 text-xs text-slate-600 shadow-sm backdrop-blur">
            ForceAtlas2 settles the graph, then physics stops for smooth panning. Wheel, pinch, or +/- to zoom.
          </div>
          {#if !physicsSettled && stabilizationProgress < 100}
            <div class="pointer-events-none absolute left-1/2 top-3 w-64 -translate-x-1/2 rounded-md border border-slate-200 bg-white/90 p-3 text-xs text-slate-600 shadow-sm backdrop-blur">
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
