<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Project } from '$features/projects/domain/entities/Project';
  import BehaviorGraph from '$features/behavior-model/presentation/components/BehaviorGraph.svelte';
  import {
    diagramHasContent,
    type DiagramFormat,
    type DiagramNode,
    type DiagramSpec
  } from '$features/diagram-projection/domain/DiagramSpec';
  import type { ProjectionScope } from '$features/diagram-projection/domain/ports/ProjectionEvents';
  import type { ProjectionSource } from '$features/diagram-projection/domain/ports/Projector';
  import { sourceFacts } from '$features/diagram-projection/domain/services/sourceFacts';
  import { graphToDiagramSpec } from '$features/diagram-projection/domain/services/projections/graphToDiagramSpec';
  import {
    mermaidTextExporter,
    projectorRegistry
  } from '$features/diagram-projection/application/projectionComposition';
  import { renderMindmapSvg } from '$features/diagram-projection/infrastructure/render/mindmapSvg';
  import { projectionEvents } from '$features/diagram-projection/application/projectionEvents';
  import ExportPanel from './ExportPanel.svelte';
  import MermaidDiagram from './MermaidDiagram.svelte';

  type Props = {
    feature?: Feature;
    features?: readonly Feature[];
    project?: Project;
  };
  let { feature, features, project }: Props = $props();

  const baseFeatures = $derived(features ?? (feature ? [feature] : []));
  const inProjectView = $derived(project != null);

  // Compact names + glyphs for the segmented format switcher; the registry
  // label stays the long human name shown in the diagram header.
  const FORMAT_NAMES: Record<DiagramFormat, string> = {
    graph: 'Graph',
    statechart: 'Statechart',
    sequence: 'Sequence',
    er: 'ER',
    flowchart: 'Flowchart',
    mindmap: 'Mindmap'
  };

  const formatOptions = $derived<readonly DiagramFormat[]>([
    'graph',
    ...projectorRegistry.list().map((p) => p.format)
  ]);

  // Element chips take the same palette as the behavior graph + flowchart
  // classDefs, so a kind keeps one color across every representation.
  const KIND_COLORS: Record<string, string> = {
    feature: '#0f172a',
    root: '#0f172a',
    surface: '#0e7490',
    action: '#2563eb',
    entity: '#9333ea'
  };
  const kindColor = (kind?: string): string => KIND_COLORS[kind ?? ''] ?? '#64748b';
  // Kinds arrive raw from the model (e.g. a surface type like DIALOG_AREA);
  // show them as friendly words.
  const kindLabel = (kind: string): string => {
    const words = kind.replace(/[_-]+/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
  const KIND_ORDER = ['root', 'feature', 'surface', 'action', 'entity'];

  // --- projection state machine (mirrors the feature spec's state paths) ---
  let format = $state<DiagramFormat>('graph');
  let scope = $state<ProjectionScope>('project');
  let selectedFeatureId = $state<string>('');
  let renderStatus = $state<'idle' | 'rendering' | 'rendered' | 'error'>('idle');
  let hasContent = $state(false);
  let selectedElementId = $state('');
  let renderedSpec = $state<DiagramSpec | null>(null);
  let exportOpen = $state(false);
  let diagramView = $state<'diagram' | 'source'>('diagram');
  let sourceCopied = $state(false);

  const effectiveSource = $derived.by<ProjectionSource>(() => {
    if (!project) return { features: baseFeatures, project: undefined };
    if (scope === 'project') return { features: baseFeatures, project };
    const picked = baseFeatures.find((f) => String(f.id) === selectedFeatureId) ?? baseFeatures[0];
    return { features: picked ? [picked] : [], project: undefined };
  });

  const facts = $derived(sourceFacts(effectiveSource));
  const loaded = $derived(facts.loaded);
  const currentProjector = $derived(format === 'graph' ? null : projectorRegistry.get(format) ?? null);

  const emit = (): void =>
    projectionEvents.emit({ type: 'projection.rendered', format, scope: project ? scope : 'feature' });

  // Projections render reactively: picking a format / scope / feature reprojects
  // in real time — no explicit Render step. The interactive graph draws itself,
  // so we only keep its export spec in sync; every other format runs its
  // projector here. Compute into a local first — reading `renderedSpec` back
  // inside this effect would make it depend on state it writes and loop
  // (effect_update_depth_exceeded).
  $effect(() => {
    if (!loaded) {
      renderedSpec = null;
      hasContent = false;
      renderStatus = 'idle';
      return;
    }
    if (format === 'graph') {
      const spec = graphToDiagramSpec(effectiveSource);
      renderedSpec = spec;
      hasContent = diagramHasContent(spec);
      renderStatus = 'rendered';
      return;
    }
    const projector = currentProjector;
    if (!projector) {
      renderedSpec = null;
      hasContent = false;
      renderStatus = 'idle';
      return;
    }
    try {
      const spec = projector.project(effectiveSource);
      renderedSpec = spec;
      hasContent = diagramHasContent(spec);
      renderStatus = 'rendered';
      emit();
    } catch {
      renderedSpec = null;
      hasContent = false;
      renderStatus = 'error';
    }
  });

  // Switching the source of the projection clears the per-render view state; the
  // effect above reprojects the new selection automatically.
  const clearView = (): void => {
    selectedElementId = '';
    exportOpen = false;
  };
  const selectFormat = (next: DiagramFormat): void => {
    format = next;
    clearView();
  };
  const selectScope = (next: ProjectionScope): void => {
    scope = next;
    clearView();
  };
  const selectFeature = (id: string): void => {
    selectedFeatureId = id;
    clearView();
  };

  // Clicking an element (chip or drawn node) spotlights it; clicking it again
  // releases the spotlight.
  const focus = (id: string): void => {
    if (!hasContent) return; // nothing to drill into on an empty canvas
    selectedElementId = selectedElementId === id ? '' : id;
  };
  const resetView = (): void => {
    selectedElementId = '';
  };

  const openExport = (): void => {
    if (renderStatus !== 'rendered') return; // gated on a successful render
    exportOpen = true;
  };

  // Guard on `renderedSpec.format === format`: on a format switch this derived
  // re-evaluates before the projection effect writes the new spec, and
  // exporting the stale spec would flash (and possibly fail) a wrong render.
  const mermaidText = $derived(
    renderedSpec && renderedSpec.format === format && format !== 'graph'
      ? mermaidTextExporter.export(renderedSpec)
      : ''
  );
  // Mindmaps are drawn by the dashboard's own tidy-tree layout: Mermaid's
  // force layout collapses on wide fan-outs (a surface with dozens of
  // actions). The Source view and exports still use the Mermaid text above.
  const overrideSvg = $derived(
    format === 'mindmap' && renderedSpec?.format === 'mindmap' && hasContent
      ? renderMindmapSvg(renderedSpec)
      : ''
  );
  const selectedNode = $derived(
    renderedSpec?.nodes.find((node) => node.id === selectedElementId) ?? null
  );
  // The exporter aliases nodes as `s{index}` in spec order; that index is the
  // bridge from a spec node to its drawn shape (spotlight + click-to-pick).
  const selectedIndex = $derived(
    renderedSpec?.nodes.findIndex((node) => node.id === selectedElementId) ?? -1
  );
  const focusKey = $derived(selectedIndex >= 0 ? `s${selectedIndex}` : null);

  const pickNodeByIndex = (index: number): void => {
    const node = renderedSpec?.nodes[index];
    if (node) focus(node.id);
  };

  const groupedNodes = $derived.by<readonly [string, DiagramNode[]][]>(() => {
    const groups = new Map<string, DiagramNode[]>();
    for (const node of renderedSpec?.nodes ?? []) {
      const kind = node.kind ?? 'element';
      const list = groups.get(kind) ?? [];
      list.push(node);
      groups.set(kind, list);
    }
    return [...groups.entries()].sort((a, b) => {
      const ia = KIND_ORDER.indexOf(a[0]);
      const ib = KIND_ORDER.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a[0].localeCompare(b[0]);
    });
  });

  type Connection = { readonly dir: 'in' | 'out'; readonly other: string; readonly label?: string };
  const selectedConnections = $derived.by<readonly Connection[]>(() => {
    const spec = renderedSpec;
    const node = selectedNode;
    if (!spec || !node) return [];
    const out: Connection[] = [];
    for (const edge of spec.edges) {
      if (edge.from === node.id) {
        const other = spec.nodes.find((candidate) => candidate.id === edge.to);
        if (other) out.push({ dir: 'out', other: other.label, label: edge.label });
      } else if (edge.to === node.id) {
        const other = spec.nodes.find((candidate) => candidate.id === edge.from);
        if (other) out.push({ dir: 'in', other: other.label, label: edge.label });
      }
    }
    return out;
  });

  const copySource = async (): Promise<void> => {
    if (!mermaidText) return;
    try {
      await navigator.clipboard.writeText(mermaidText);
      sourceCopied = true;
      setTimeout(() => (sourceCopied = false), 1600);
    } catch {
      sourceCopied = false;
    }
  };

  const emptyMessage = $derived(
    format === 'er'
      ? 'No entities to project yet. Add entities to your model to see an ER diagram.'
      : format === 'statechart'
        ? 'No transitions yet. Add surface transitions to your model to see a statechart.'
        : format === 'sequence'
          ? 'No event handlers to sequence yet. Wire an action to an emitted event.'
          : 'Nothing to project for this format yet.'
  );
</script>

{#snippet formatIcon(value: DiagramFormat)}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="h-4 w-4 shrink-0"
    aria-hidden="true"
  >
    {#if value === 'graph'}
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M7 7.2 10.6 16M17 7.2 13.4 16M7.2 6h9.6" />
    {:else if value === 'statechart'}
      <rect x="3" y="3.5" width="9" height="6" rx="2" />
      <rect x="12" y="14.5" width="9" height="6" rx="2" />
      <path d="M7.5 9.5v4a2 2 0 0 0 2 2h1" />
      <path d="m9 14 1.5 1.5L9 17" />
    {:else if value === 'sequence'}
      <path d="M6 4v16M18 4v16" />
      <path d="M6 9h12" />
      <path d="m15 6.5 3 2.5-3 2.5" />
      <path d="M18 16H6" />
      <path d="m9 13.5-3 2.5 3 2.5" />
    {:else if value === 'er'}
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M3 9.5h18" />
      <path d="M11 9.5V19.5" />
    {:else if value === 'flowchart'}
      <rect x="8" y="3" width="8" height="5" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
      <rect x="14" y="16" width="7" height="5" rx="1.5" />
      <path d="M12 8v4M12 12H6.5V16M12 12h5v4" />
    {:else}
      <circle cx="12" cy="12" r="2.4" />
      <circle cx="4.5" cy="5" r="1.7" />
      <circle cx="19.5" cy="5" r="1.7" />
      <circle cx="4.5" cy="19" r="1.7" />
      <circle cx="19.5" cy="19" r="1.7" />
      <path d="M10.2 10.4 5.8 6.2M13.8 10.4l4.4-4.2M10.2 13.6l-4.4 4.2M13.8 13.6l4.4 4.2" />
    {/if}
  </svg>
{/snippet}

<section class="w-full lg:flex lg:h-full lg:min-h-0 lg:flex-col">
  {#if !loaded}
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
      <p class="text-sm font-medium text-slate-700">No model open</p>
      <p class="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
        Open a feature or project to project it into a diagram.
      </p>
    </div>
  {:else}
    <!-- Toolbar: format, scope, export (projections render on selection) -->
    <div class="mb-4 flex shrink-0 flex-wrap items-center gap-3">
      <div
        role="group"
        aria-label="Diagram format"
        class="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
      >
        {#each formatOptions as option, index}
          <button
            type="button"
            aria-pressed={format === option}
            title={FORMAT_NAMES[option]}
            onclick={() => selectFormat(option)}
            class="flex h-9 items-center gap-1.5 px-2.5 text-sm font-medium transition sm:px-3 {format === option
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'} {index > 0
              ? 'border-l border-slate-200'
              : ''}"
          >
            {@render formatIcon(option)}
            <span class="hidden md:inline">{FORMAT_NAMES[option]}</span>
          </button>
        {/each}
      </div>

      {#if inProjectView}
        <div class="inline-flex overflow-hidden rounded-lg border border-slate-200">
          <button
            type="button"
            onclick={() => selectScope('project')}
            class="h-9 px-3 text-sm font-medium transition {scope === 'project'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-50'}"
          >
            Whole project
          </button>
          <button
            type="button"
            onclick={() => selectScope('feature')}
            class="h-9 px-3 text-sm font-medium transition {scope === 'feature'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-50'}"
          >
            Per feature
          </button>
        </div>
        {#if scope === 'feature'}
          <select
            value={selectedFeatureId}
            onchange={(e) => selectFeature(e.currentTarget.value)}
            class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15"
          >
            <option value="">{baseFeatures[0]?.name ?? 'First feature'}</option>
            {#each baseFeatures as f}
              <option value={String(f.id)}>{f.name}</option>
            {/each}
          </select>
        {/if}
      {/if}

      <div class="ml-auto flex items-center gap-2">
        {#if selectedElementId}
          <button
            type="button"
            onclick={resetView}
            class="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Reset view
          </button>
        {/if}
        <button
          type="button"
          disabled={renderStatus !== 'rendered'}
          onclick={openExport}
          class="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export
        </button>
      </div>
    </div>

    {#if exportOpen}
      <div class="mb-4 shrink-0">
        <ExportPanel
          spec={renderedSpec}
          {format}
          {loaded}
          onClose={() => (exportOpen = false)}
        />
      </div>
    {/if}

    {#if format === 'graph'}
      <BehaviorGraph {feature} {features} {project} />
    {:else if renderStatus === 'error'}
      <div class="rounded-lg border border-red-200 bg-red-50 px-6 py-16 text-center text-sm text-red-600">
        Something went wrong projecting this diagram.
      </div>
    {:else if !hasContent}
      <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
        <p class="text-sm font-medium text-slate-700">{renderedSpec?.title ?? 'Diagram'}</p>
        <p class="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{emptyMessage}</p>
      </div>
    {:else}
      <!-- At lg the grid takes exactly the section's remaining height (flex-1 +
           a minmax(0,1fr) row), the diagram canvas stretches to fill it, and
           the aside scrolls its own overflow. -->
      <div
        class="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-[minmax(0,1fr)]"
      >
        <div
          class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-950/5 lg:flex lg:min-h-0 lg:flex-col"
        >
          <div
            class="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-slate-950 px-4 py-3 text-white"
          >
            <div class="min-w-0">
              <p class="text-xs font-semibold uppercase tracking-wide text-cyan-200">
                {currentProjector?.label}
              </p>
              <h2 class="mt-1 truncate text-lg font-semibold">{renderedSpec?.title}</h2>
              <p class="mt-0.5 text-xs text-slate-400">
                {renderedSpec?.nodes.length ?? 0} element{(renderedSpec?.nodes.length ?? 0) === 1
                  ? ''
                  : 's'} · {renderedSpec?.edges.length ?? 0} link{(renderedSpec?.edges.length ?? 0) === 1
                  ? ''
                  : 's'}
              </p>
            </div>
            <div class="inline-flex shrink-0 overflow-hidden rounded-md border border-white/20">
              <button
                type="button"
                onclick={() => (diagramView = 'diagram')}
                class="px-2.5 py-1 text-xs font-medium transition {diagramView === 'diagram'
                  ? 'bg-white text-slate-900'
                  : 'text-slate-300 hover:bg-white/10'}"
              >
                Diagram
              </button>
              <button
                type="button"
                onclick={() => (diagramView = 'source')}
                class="px-2.5 py-1 text-xs font-medium transition {diagramView === 'source'
                  ? 'bg-white text-slate-900'
                  : 'text-slate-300 hover:bg-white/10'}"
              >
                Source
              </button>
            </div>
          </div>
          {#if diagramView === 'diagram'}
            <MermaidDiagram
              code={mermaidText}
              svgOverride={overrideSvg}
              {focusKey}
              focusLabel={selectedNode?.label ?? ''}
              onNodePick={pickNodeByIndex}
            />
          {:else}
            <div class="relative lg:min-h-0 lg:flex-1">
              <button
                type="button"
                onclick={copySource}
                class="absolute right-3 top-3 inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                {sourceCopied ? 'Copied' : 'Copy'}
              </button>
              <pre class="max-h-[60vh] overflow-auto bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-800 lg:h-full lg:max-h-full"><code
                  >{mermaidText}</code
                ></pre>
            </div>
          {/if}
        </div>

        <aside class="space-y-3 lg:min-h-0 lg:overflow-y-auto">
          <div>
            <h3 class="text-sm font-semibold text-slate-900">Elements</h3>
            <p class="mt-1 text-xs text-slate-500">
              Click an element, here or in the diagram, to spotlight it.
            </p>
            {#each groupedNodes as [kind, nodes]}
              <div class="mt-3">
                <p class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <span class="h-2 w-2 rounded-full" style={`background:${kindColor(kind)}`}></span>
                  {kindLabel(kind)}
                  <span class="font-normal text-slate-400">{nodes.length}</span>
                </p>
                <div class="mt-1.5 flex flex-wrap gap-1.5">
                  {#each nodes as node}
                    <button
                      type="button"
                      aria-pressed={selectedElementId === node.id}
                      onclick={() => focus(node.id)}
                      class="inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs transition {selectedElementId ===
                      node.id
                        ? 'border-brand-400 bg-brand-50 text-brand-800'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}"
                    >
                      <span class="truncate">{node.label}</span>
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>

          {#if selectedNode}
            <div class="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span
                  class="h-2 w-2 rounded-full"
                  style={`background:${kindColor(selectedNode.kind)}`}
                ></span>
                {selectedNode.kind ? kindLabel(selectedNode.kind) : 'Element'}
              </p>
              <h4 class="mt-1 text-sm font-semibold text-slate-900">{selectedNode.label}</h4>
              {#if selectedNode.fields?.length}
                <dl class="mt-2 space-y-0.5">
                  {#each selectedNode.fields as field}
                    <div class="flex items-baseline justify-between gap-2 text-xs">
                      <dt class="truncate text-slate-700">{field.name}</dt>
                      <dd class="shrink-0 font-mono text-[11px] text-slate-400">{field.type}</dd>
                    </div>
                  {/each}
                </dl>
              {/if}
              {#if selectedConnections.length > 0}
                <p class="mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Connections
                </p>
                <ul class="mt-1 space-y-1">
                  {#each selectedConnections.slice(0, 8) as connection}
                    <li class="flex items-baseline gap-1.5 text-xs text-slate-600">
                      <span class="shrink-0 font-semibold {connection.dir === 'out' ? 'text-brand-700' : 'text-slate-400'}">
                        {connection.dir === 'out' ? '→' : '←'}
                      </span>
                      <span class="truncate">{connection.other}</span>
                      {#if connection.label}
                        <span class="truncate text-[11px] text-slate-400">({connection.label})</span>
                      {/if}
                    </li>
                  {/each}
                  {#if selectedConnections.length > 8}
                    <li class="text-[11px] text-slate-400">
                      +{selectedConnections.length - 8} more
                    </li>
                  {/if}
                </ul>
              {/if}
            </div>
          {/if}
        </aside>
      </div>
    {/if}
  {/if}
</section>
