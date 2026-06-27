<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Project } from '$features/projects/domain/entities/Project';
  import BehaviorGraph from '$features/behavior-model/presentation/components/BehaviorGraph.svelte';
  import {
    diagramHasContent,
    type DiagramFormat,
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

  const formatOptions = [
    { value: 'graph' as DiagramFormat, label: 'Behavior graph (interactive)' },
    ...projectorRegistry.list().map((p) => ({ value: p.format, label: p.label }))
  ];

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

  const focus = (id: string): void => {
    if (!hasContent) return; // nothing to drill into on an empty canvas
    selectedElementId = id;
  };
  const resetView = (): void => {
    selectedElementId = '';
  };

  const openExport = (): void => {
    if (renderStatus !== 'rendered') return; // gated on a successful render
    exportOpen = true;
  };

  const mermaidText = $derived(
    renderedSpec && format !== 'graph' ? mermaidTextExporter.export(renderedSpec) : ''
  );
  const selectedNode = $derived(
    renderedSpec?.nodes.find((node) => node.id === selectedElementId) ?? null
  );

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
      <label for="projection-format" class="text-sm font-medium text-slate-700">Diagram</label>
      <select
        id="projection-format"
        value={format}
        onchange={(e) => selectFormat(e.currentTarget.value as DiagramFormat)}
        class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15"
      >
        {#each formatOptions as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>

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
      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
          <div class="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
            <div class="min-w-0">
              <p class="text-xs font-semibold uppercase tracking-wide text-cyan-200">
                {currentProjector?.label}
              </p>
              <h2 class="mt-1 truncate text-lg font-semibold">{renderedSpec?.title}</h2>
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
            <MermaidDiagram code={mermaidText} />
          {:else}
            <pre class="max-h-[60vh] overflow-auto bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-800"><code
                >{mermaidText}</code
              ></pre>
          {/if}
        </div>

        <aside class="space-y-3">
          <div>
            <h3 class="text-sm font-semibold text-slate-900">Elements</h3>
            <p class="mt-1 text-xs text-slate-500">Click to focus an element.</p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              {#each renderedSpec?.nodes ?? [] as node}
                <button
                  type="button"
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

          {#if selectedNode}
            <div class="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {selectedNode.kind ?? 'Element'}
              </p>
              <h4 class="mt-1 text-sm font-semibold text-slate-900">{selectedNode.label}</h4>
            </div>
          {/if}
        </aside>
      </div>
    {/if}
  {/if}
</section>
