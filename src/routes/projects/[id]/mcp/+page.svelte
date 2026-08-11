<script lang="ts">
  import { pageTitle } from '$features/app-shell/presentation/pageTitle';
  import { withBase } from '$shared/routing/appBase';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { featuresStore } from '$features/behavior-model/presentation/stores/featuresStore.svelte';
  import { projectsStore } from '$features/projects/presentation/stores/projectsStore.svelte';
  import { getBrowserContainer } from '$shared/infrastructure/browserContainer';
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Action } from '$features/behavior-model/domain/entities/Action';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import type { Project } from '$features/projects/domain/entities/Project';
  import type { ProjectAggregateRead } from '$features/projects/application/use-cases/GetProjectAggregate';
  import { asProjectId } from '$features/projects/domain/value-objects/ids';
  import {
    asFeatureId,
    asActionId,
    asSurfaceId
  } from '$features/behavior-model/domain/value-objects/ids';
  import {
    asStatePath,
    writePath,
    type StatePath,
    type StateSnapshot
  } from '$features/behavior-model/domain/value-objects/StatePath';
  import { exportFeatureToJson } from '$features/behavior-model/infrastructure/io/FeatureJson';
  import type { ParameterValues } from '$features/behavior-model/domain/services/ParameterValidator';
  import {
    estimateTokens,
    listFeaturesTool,
    getFeatureIndexTool,
    listActionsTool,
    getActionTool,
    findStateReferencesTool,
    dryRunSimulateTool,
    scoreFeatureTool
  } from '$features/mcp-tools/application/tools';
  import { runScenariosUseCase } from '$features/simulator/application/use-cases/RunScenarios';

  // Project-scoped MCP playground. The project comes from the route
  // (/projects/[id]/mcp), so unlike the old global /mcp page there is no
  // project dropdown: everything on the page (feature select, live tool
  // outputs, aggregate cards) is filtered to this one project.
  const projectId = $derived(page.params.id ?? '');

  let selectedId = $state<string>('');
  let feature = $state<Feature | null>(null);
  let loadingFeature = $state(false);
  let loadError = $state<string | null>(null);

  // Action: Show Tool Examples. Tracks which MCP tool examples are
  // expanded on the page. Toggled by clicking a tool header. State path:
  // mcpPlayground.shownTool. Defaults to "get_feature" so users land on a
  // useful example.
  // Mirrors the modeled "Show Tool Examples" action / mcpPlayground.shownTool
  // state; retained as dogfooded spec scaffolding ahead of the template wiring.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let shownTool = $state<string>('get_feature');

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function showToolExamples(tool: string): void {
    shownTool = tool;
  }

  // The routed project. Also feeds the get_project / get_project_aggregate
  // demo cards so the page is internally consistent.
  let currentProject = $state<Project | null>(null);
  let currentProjectAggregate = $state<ProjectAggregateRead | null>(null);
  let loadingProject = $state(true);
  let loadingAggregate = $state(true);
  let projectLoadRun = 0;

  onMount(() => {
    void (async () => {
      await Promise.all([featuresStore.refresh(), projectsStore.refresh()]);
    })();
  });

  // (Re)load the project whenever the route param changes. The aggregate is
  // fetched in the same pass but NEVER gates the header or the feature
  // selector: it loads every feature of the project, so it's the slowest
  // call on the page. Its demo card slot shows a skeleton until it lands.
  $effect(() => {
    if (!projectId) return;
    const id = asProjectId(projectId);
    projectLoadRun += 1;
    const run = projectLoadRun;
    loadingProject = true;
    loadingAggregate = true;
    currentProjectAggregate = null;
    void (async () => {
      const container = await getBrowserContainer();
      void (async () => {
        try {
          const project = await container.useCases.getProject(id);
          if (run === projectLoadRun) currentProject = project;
        } finally {
          if (run === projectLoadRun) loadingProject = false;
        }
      })();
      void (async () => {
        try {
          const aggregate = await container.useCases.getProjectAggregate(id);
          if (run === projectLoadRun) currentProjectAggregate = aggregate;
        } finally {
          if (run === projectLoadRun) loadingAggregate = false;
        }
      })();
    })();
  });

  // This project's features, in the project's own order.
  const projectFeatures = $derived.by(() => {
    if (!currentProject) return [];
    const byId = new Map(featuresStore.summaries.map((s) => [String(s.id), s]));
    return currentProject.featureIds
      .map((fid) => byId.get(String(fid)))
      .filter((s) => s !== undefined);
  });

  // Auto-pick the first feature in the project, and switch when the current
  // selection no longer belongs to it.
  $effect(() => {
    if (projectFeatures.length === 0) {
      selectedId = '';
      return;
    }
    const stillVisible = projectFeatures.some((summary) => String(summary.id) === selectedId);
    if (!stillVisible) {
      selectedId = String(projectFeatures[0]!.id);
    }
  });

  $effect(() => {
    if (!selectedId) {
      feature = null;
      return;
    }
    loadingFeature = true;
    loadError = null;
    void (async () => {
      try {
        const container = await getBrowserContainer();
        feature = await container.useCases.getFeature(asFeatureId(selectedId));
      } catch (e) {
        loadError = (e as Error).message;
        feature = null;
      } finally {
        loadingFeature = false;
      }
    })();
  });

  const firstCapability = (feature: Feature): { surface: Surface; action: Action } | null => {
    for (const surface of feature.surfaces) {
      const action = surface.actions[0];
      if (action) return { surface, action };
    }
    return null;
  };

  const buildSnapshot = (surface: Surface): StateSnapshot => {
    let snapshot: StateSnapshot = {};
    for (const def of surface.stateDefinitions) {
      snapshot = writePath(snapshot, def.path, def.defaultValue);
    }
    return snapshot;
  };

  const buildParameters = (action: Action): ParameterValues => {
    const params: { [key: string]: unknown } = {};
    for (const p of action.parameters) {
      if (p.defaultValue !== undefined) {
        params[p.name] = p.defaultValue;
      } else {
        switch (p.type) {
          case 'string': params[p.name] = ''; break;
          case 'number': params[p.name] = 0; break;
          case 'boolean': params[p.name] = false; break;
          case 'enum': params[p.name] = p.enumValues?.[0] ?? ''; break;
          default: params[p.name] = null;
        }
      }
    }
    return params as ParameterValues;
  };

  type ReadToolCard = {
    name: string;
    callSignature: string;
    description: string;
    /** Raw tool output. Pretty-printed lazily, on first expand. */
    output: unknown;
    /** Estimated tokens of the compact payload an agent would receive. */
    tokens: number;
  };

  const makeCard = (
    name: string,
    callSignature: string,
    description: string,
    output: unknown
  ): ReadToolCard => ({ name, callSignature, description, output, tokens: estimateTokens(output) });

  const runScenarios = runScenariosUseCase();

  // The live examples are CPU-bound (a dry-run simulation, two maturity
  // scorings, run_all_scenarios simulating every scenario). Computing them
  // all inside one synchronous $derived froze the tab with no paint until
  // everything finished. Instead they're built one card at a time in an
  // async pipeline that yields to the event loop between steps, so the
  // page paints immediately and cards stream in top-down.
  let baseline = $state<{ json: string; tokens: number } | null>(null);
  let featureCards = $state<readonly ReadToolCard[]>([]);
  let buildingCards = $state(false);
  let cardBuildRun = 0;

  // Pretty JSON is generated the first time a card is expanded. Rendering
  // every output into collapsed <pre> blocks up front is a large hidden
  // DOM + stringify cost (the baseline alone can be hundreds of KB).
  let expandedJson = $state<Record<string, string>>({});
  function revealOutput(card: ReadToolCard, open: boolean): void {
    if (!open || expandedJson[card.name]) return;
    expandedJson = { ...expandedJson, [card.name]: JSON.stringify(card.output, null, 2) };
  }
  let baselineOpen = $state(false);

  const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  $effect(() => {
    const selectedFeature = feature;
    const siblingSummaries = projectFeatures;
    cardBuildRun += 1;
    const run = cardBuildRun;
    featureCards = [];
    baseline = null;
    expandedJson = {};
    if (!selectedFeature) {
      buildingCards = false;
      return;
    }
    buildingCards = true;

    const alive = () => run === cardBuildRun;
    const push = (card: ReadToolCard) => {
      if (alive()) featureCards = [...featureCards, card];
    };

    const steps: (() => void)[] = [
      () =>
        push(
          makeCard(
            'list_features',
            'list_features()',
            'Compact index of all features. Discovery entry point.',
            listFeaturesTool(siblingSummaries)
          )
        ),
      () =>
        push(
          makeCard(
            'get_feature',
            `get_feature(featureId: "${selectedFeature.id}")`,
            'Structured index. Surfaces, actions, state counts, devContext. Pass verbose:true only when you need the full blob.',
            getFeatureIndexTool(selectedFeature)
          )
        ),
      () =>
        push(
          makeCard(
            'list_actions',
            `list_actions(featureId: "${selectedFeature.id}")`,
            'Flat list of all actions across surfaces with id, name, intent, rule/effect counts.',
            listActionsTool(selectedFeature)
          )
        ),
      () => {
        const firstCap = firstCapability(selectedFeature);
        if (!firstCap) return;
        push(
          makeCard(
            'get_action',
            `get_action(featureId: "${selectedFeature.id}", actionId: "${firstCap.action.id}")`,
            'Single action with its rules, parameters, linked state defs, and implementation guidance. The primary focused query.',
            getActionTool(selectedFeature, asActionId(firstCap.action.id))
          )
        );
      },
      () => {
        const firstStateDef = selectedFeature.surfaces.find(
          (s) => s.stateDefinitions.length > 0
        )?.stateDefinitions[0];
        if (!firstStateDef) return;
        push(
          makeCard(
            'find_state_references',
            `find_state_references(featureId: "${selectedFeature.id}", statePath: "${firstStateDef.path}")`,
            'Count refs to a state path across rules, effects, invariants, requiredStates, and parameter bindings. Run before editing or removing state.',
            findStateReferencesTool(
              selectedFeature,
              asStatePath(String(firstStateDef.path)) as StatePath
            )
          )
        );
      },
      () => {
        const firstCap = firstCapability(selectedFeature);
        if (!firstCap) return;
        const snapshot = buildSnapshot(firstCap.surface);
        const parameters = buildParameters(firstCap.action);
        try {
          push(
            makeCard(
              'dry_run_simulate',
              `dry_run_simulate(${firstCap.surface.name} ▸ ${firstCap.action.name}, default snapshot)`,
              'Pure simulation. Runs the deterministic engine on proposed state without writing to disk. Validate changes before committing.',
              dryRunSimulateTool({
                feature: selectedFeature,
                surfaceId: asSurfaceId(firstCap.surface.id),
                actionId: asActionId(firstCap.action.id),
                snapshot,
                parameters
              })
            )
          );
        } catch (e) {
          push(
            makeCard(
              'dry_run_simulate',
              `dry_run_simulate(${firstCap.surface.name} ▸ ${firstCap.action.name})`,
              'Simulation failed with default snapshot.',
              { error: (e as Error).message }
            )
          );
        }
      },
      () =>
        push(
          makeCard(
            'score_feature',
            `score_feature(featureId: "${selectedFeature.id}")`,
            'Compact summary. Score, percentage, issue counts, top failing areas, worst surfaces. Pass includeIssues:true (next card) when you need the actual issues.',
            scoreFeatureTool(selectedFeature)
          )
        ),
      () => {
        const worstSurface = selectedFeature.surfaces.reduce<Surface | null>((worst, s) => {
          // Pick the surface most likely to surface issues so the demo card
          // has something to show. Falls back to the first surface if all
          // are clean.
          const issueProxy = s.actions.length + s.stateDefinitions.length;
          const worstProxy =
            worst === null ? -1 : worst.actions.length + worst.stateDefinitions.length;
          return issueProxy > worstProxy ? s : worst;
        }, null);
        if (!worstSurface) return;
        push(
          makeCard(
            'score_feature (issues)',
            `score_feature(featureId: "${selectedFeature.id}", surfaceId: "${worstSurface.id}", includeIssues: true)`,
            `Same tool, asked to return the actual issue list (includeIssues:true) for ${worstSurface.name}. The surfaceId / area / severity filters exist to keep the issue array bounded. Typical payload stays under 10 KB instead of dumping every issue across the whole feature.`,
            scoreFeatureTool(selectedFeature, {
              surfaceId: String(worstSurface.id),
              includeIssues: true
            })
          )
        );
      },
      () => {
        try {
          push(
            makeCard(
              'run_all_scenarios',
              `run_all_scenarios(featureId: "${selectedFeature.id}")`,
              'Run every Scenario through the simulator and assert against expectedStatus + expectedAssertions. Per-result parameterErrors[] and invariantViolations[] surface the cause when a scenario unexpectedly blocks.',
              runScenarios({ feature: selectedFeature })
            )
          );
        } catch (e) {
          push(
            makeCard(
              'run_all_scenarios',
              `run_all_scenarios(featureId: "${selectedFeature.id}")`,
              'Run all scenarios.',
              { error: (e as Error).message }
            )
          );
        }
      }
    ];

    void (async () => {
      await breathe();
      if (!alive()) return;
      const json = exportFeatureToJson(selectedFeature);
      if (!alive()) return;
      baseline = { json, tokens: estimateTokens(json) };
      for (const step of steps) {
        await breathe();
        if (!alive()) return;
        try {
          step();
        } catch {
          // A failing demo card is dropped rather than wedging the page.
        }
      }
      if (alive()) buildingCards = false;
    })();
  });

  // get_project / get_project_aggregate demo cards. Kept out of the feature
  // pipeline: they arrive on their own network schedule (the aggregate is
  // the slowest call on the page) and are cheap to build once loaded.
  const projectCards = $derived.by((): readonly ReadToolCard[] => {
    const out: ReadToolCard[] = [];
    if (currentProject) {
      out.push(
        makeCard(
          'get_project',
          `get_project(projectId: "${currentProject.id}")`,
          'Full Project document (id, name, description, featureIds[], timestamps). Use list_projects for discovery first.',
          currentProject
        )
      );
    }
    if (currentProjectAggregate) {
      out.push(
        makeCard(
          'get_project_aggregate',
          `get_project_aggregate(projectId: "${currentProjectAggregate.projectId}")`,
          'Cross-feature view of a project: flat list of resources, data namespaces, registered events, and transitions, each tagged with the source feature. Use this to reason about a project as one logical surface.',
          currentProjectAggregate
        )
      );
    }
    return out;
  });

  const readCards = $derived([...featureCards, ...projectCards]);

  const fmtPercent = (tokens: number, of: number): string =>
    of === 0 ? '-' : `${((tokens / of) * 100).toFixed(1)}% of baseline`;

  type ToolGroup = { label: string; description: string; tools: string[] };

  const writeGroups: ToolGroup[] = [
    {
      label: 'Feature lifecycle',
      description: 'Create, update, delete and save features to disk.',
      tools: ['create_feature', 'update_feature', 'delete_feature', 'save_feature']
    },
    {
      label: 'Surface & state',
      description: 'Manage surfaces, state definitions, surface-level rules, invariants, and transitions.',
      tools: [
        'add_surface', 'remove_surface', 'update_surface', 'move_surface',
        'add_state_definition', 'remove_state_definition', 'update_state_definition', 'move_state_definition',
        'add_surface_rule', 'remove_surface_rule', 'update_surface_rule',
        'add_surface_invariant', 'remove_surface_invariant', 'update_surface_invariant',
        'add_transition', 'remove_transition', 'update_transition'
      ]
    },
    {
      label: 'Actions',
      description: 'Add, remove, reorder, and edit actions and their rules, effects, parameters, invariants, and scenarios.',
      tools: [
        'add_action', 'remove_action', 'update_action', 'move_action',
        'add_action_rule', 'remove_action_rule', 'update_action_rule',
        'add_effect', 'remove_effect', 'update_effect',
        'add_parameter', 'remove_parameter', 'update_parameter', 'move_parameter',
        'add_action_invariant', 'remove_action_invariant', 'update_action_invariant',
        'add_scenario', 'remove_scenario', 'update_scenario'
      ]
    },
    {
      label: 'Feature-level: invariants & liveness',
      description: 'Cross-surface invariants (safety - "nothing bad happens") and reachability goals (liveness - "good stays reachable": reachable / always_reachable). Checked over the whole feature by model_check and verify.',
      tools: [
        'add_feature_invariant', 'remove_feature_invariant', 'update_feature_invariant',
        'add_reachability_goal', 'remove_reachability_goal', 'update_reachability_goal'
      ]
    },
    {
      label: 'Events, personas, resources & entities',
      description: 'Manage first-class events, personas, external resources, and entity schemas.',
      tools: [
        'add_event', 'remove_event', 'update_event',
        'add_persona', 'remove_persona', 'update_persona',
        'add_resource', 'remove_resource', 'update_resource',
        'add_entity', 'remove_entity', 'update_entity',
        'add_entity_field', 'remove_entity_field', 'update_entity_field'
      ]
    },
    {
      label: 'Batch',
      description: 'Apply multi-step mutations atomically.',
      tools: ['apply_batch']
    },
    {
      label: 'Projects',
      description: 'Manage projects. A Project is the umbrella for one product or codebase; it groups many Features, where each Feature is one LLM-sized slice of behavior. Read with list_projects / get_project / get_project_aggregate (cross-feature view of resources, entities, events, transitions).',
      tools: [
        'list_projects',
        'get_project',
        'get_project_aggregate',
        'create_project',
        'update_project',
        'replace_project',
        'delete_project',
        'add_feature_to_project',
        'remove_feature_from_project',
        'move_feature_in_project',
        'add_project_invariant',
        'update_project_invariant',
        'remove_project_invariant'
      ]
    },
    {
      label: 'Behavioral index & status',
      description: 'Read the behavioral index (.unspa.json) and sync implementation status into the dashboard.',
      tools: [
        'get_behavioral_index',
        'get_implementation_gaps',
        'report_implementation_status',
        'report_implementation_status_batch',
        'get_implementation_status'
      ]
    },
    {
      label: 'Repo context',
      description: 'Read the .unspa.json file linking the current repo to a feature.',
      tools: ['get_repo_context']
    }
  ];
</script>

<svelte:head>
  <title>{pageTitle(page.url, currentProject?.name, 'MCP')}</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
  {#if !loadingProject && !currentProject}
    <div class="py-10 text-sm text-slate-500">
      Project not found. <a href={withBase('/projects')} class="text-brand-700 underline">Back to projects</a>.
    </div>
  {:else}
    <header class="mb-6 border-b border-slate-200 pb-6">
      <a
        href={withBase(`/projects/${projectId}`)}
        class="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900"
      >
        <span aria-hidden="true">←</span>
        Back to {currentProject ? currentProject.name : 'project'}
      </a>
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div class="max-w-3xl">
          <p class="text-xs font-semibold uppercase tracking-wide text-brand-700">
            Agent integration{currentProject ? ` · ${currentProject.name}` : ''}
          </p>
          <h1 class="mt-2 text-4xl font-semibold tracking-tight text-slate-950">MCP server</h1>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            The MCP server lets AI coding agents read and edit this project's Features without
            pasting the full JSON blob into a prompt. A Feature is one LLM-sized slice of behavior
            (a flow, a screen, a capability). The read tools below run live against the selected
            Feature of this project. Compare their token cost to the raw JSON baseline on the right.
          </p>
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:w-136">
          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
            <p class="text-xs font-medium uppercase tracking-wide text-brand-700">Read tools</p>
            <p class="mt-2 text-2xl font-semibold text-slate-950">{readCards.length}</p>
            <p class="mt-1 text-xs text-slate-500">Live examples</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
            <p class="text-xs font-medium uppercase tracking-wide text-violet-700">Groups</p>
            <p class="mt-2 text-2xl font-semibold text-slate-950">{writeGroups.length}</p>
            <p class="mt-1 text-xs text-slate-500">Mutation areas</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
            <p class="text-xs font-medium uppercase tracking-wide text-emerald-700">Baseline</p>
            <p class="mt-2 text-2xl font-semibold text-slate-950">{baseline ? baseline.tokens.toLocaleString() : '-'}</p>
            <p class="mt-1 text-xs text-slate-500">JSON tokens</p>
          </div>
        </div>
      </div>
    </header>

    <div class="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-950/5">
      {#if loadingProject || (featuresStore.loading && projectFeatures.length === 0)}
        <div
          class="flex animate-pulse items-center gap-3"
          role="status"
          aria-label="Loading project"
        >
          <div class="h-4 w-16 rounded bg-slate-200"></div>
          <div class="h-10 w-56 rounded-md bg-slate-100"></div>
          <span class="text-xs text-slate-400">Loading project...</span>
        </div>
      {:else}
        <label for="feature-select" class="text-sm font-medium text-slate-700">Feature:</label>
        <select
          id="feature-select"
          bind:value={selectedId}
          disabled={projectFeatures.length === 0}
          class="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {#each projectFeatures as summary (summary.id)}
            <option value={String(summary.id)}>{summary.name}</option>
          {/each}
        </select>
        <span class="text-xs text-slate-500">
          {projectFeatures.length} feature{projectFeatures.length === 1 ? '' : 's'} in this project
        </span>
        {#if loadingFeature}
          <span class="inline-flex items-center gap-1.5 text-xs text-slate-500" role="status">
            <span
              class="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
              aria-hidden="true"
            ></span>
            Loading feature...
          </span>
        {/if}
      {/if}
    </div>

    {#if projectFeatures.length === 0 && !loadingProject && !featuresStore.loading}
      <div class="rounded-lg border border-dashed border-hairline bg-white p-6 text-sm text-slate-500">
        No features in this project yet.
        <a href={withBase(`/projects/${projectId}`)} class="text-brand-700 underline">Add one</a> first.
      </div>
    {:else if loadError}
      <p class="text-sm text-red-600">{loadError}</p>
    {:else}
      <!-- Two-column layout: read tools left, sidebar right -->
      <div class="flex flex-col gap-8 lg:flex-row lg:items-start">
        <!-- Read tools -->
        <div class="min-w-0 flex-1">
          <h2 class="mb-4 text-base font-semibold text-slate-950">Read tools</h2>
          <ul class="space-y-3" aria-busy={buildingCards || loadingFeature || loadingAggregate}>
            {#each readCards as card (card.name)}
              <li class="rounded-lg border border-hairline bg-white p-4">
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0 flex-1">
                    <div class="font-mono text-sm font-semibold text-slate-950">{card.name}</div>
                    <div
                      class="mt-0.5 truncate font-mono text-[11px] text-slate-400"
                      title={card.callSignature}
                    >
                      {card.callSignature}
                    </div>
                    <p class="mt-1.5 text-xs leading-5 text-slate-600">{card.description}</p>
                  </div>
                  <div class="shrink-0 text-right">
                    <div class="font-mono text-lg font-semibold text-slate-950">
                      {card.tokens.toLocaleString()}
                    </div>
                    <div class="text-[10px] uppercase tracking-wide text-slate-400">tokens</div>
                    <div class="mt-0.5 text-[11px] text-slate-500">
                      {fmtPercent(card.tokens, baseline?.tokens ?? 0)}
                    </div>
                  </div>
                </div>
                <details
                  class="mt-3"
                  ontoggle={(e) => revealOutput(card, (e.currentTarget as HTMLDetailsElement).open)}
                >
                  <summary class="cursor-pointer text-xs text-slate-500 hover:text-slate-800"
                    >Show output</summary
                  >
                  {#if expandedJson[card.name]}
                    <pre
                      class="mt-2 max-h-72 overflow-auto rounded-md bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">{expandedJson[
                        card.name
                      ]}</pre>
                  {/if}
                </details>
              </li>
            {/each}
            {#if buildingCards || loadingFeature || loadingAggregate}
              <li
                class="animate-pulse rounded-lg border border-hairline bg-white p-4"
                aria-hidden="true"
              >
                <div class="h-4 w-44 rounded bg-slate-200"></div>
                <div class="mt-2 h-3 w-72 max-w-full rounded bg-slate-100"></div>
                <div class="mt-3 h-3 w-full rounded bg-slate-100"></div>
              </li>
              <li class="list-none">
                <p role="status" class="text-xs text-slate-400">
                  {#if buildingCards || loadingFeature}
                    Running live tool examples against the selected feature...
                  {:else}
                    Aggregating the whole project (loads every feature)...
                  {/if}
                </p>
              </li>
            {/if}
          </ul>
        </div>

        <!-- Sidebar: baseline + write tool catalog -->
        <div class="w-full shrink-0 space-y-6 lg:w-80">
          <!-- Baseline -->
          {#if baseline}
            <div class="rounded-lg border border-brand-200 bg-brand-50/60 p-4">
              <div class="flex items-baseline justify-between gap-2">
                <div>
                  <div class="font-mono text-sm font-semibold text-brand-900">Full feature JSON</div>
                  <p class="mt-0.5 text-xs text-slate-500">Naive blob-in-prompt baseline</p>
                </div>
                <div class="text-right">
                  <div class="font-mono text-2xl font-semibold text-brand-900">
                    {baseline.tokens.toLocaleString()}
                  </div>
                  <div class="text-[10px] uppercase tracking-wide text-slate-500">tokens</div>
                </div>
              </div>
              <details
                class="mt-3"
                ontoggle={(e) => (baselineOpen = (e.currentTarget as HTMLDetailsElement).open)}
              >
                <summary class="cursor-pointer text-xs text-slate-600 hover:text-slate-950"
                  >Show JSON ({baseline.json.length.toLocaleString()} chars)</summary
                >
                {#if baselineOpen}
                  <pre
                    class="mt-2 max-h-64 overflow-auto rounded-md bg-white p-2 text-[11px] leading-relaxed text-slate-700 ring-1 ring-hairline">{baseline.json}</pre>
                {/if}
              </details>
            </div>
          {:else}
            <div
              class="animate-pulse rounded-lg border border-brand-200 bg-brand-50/40 p-4"
              role="status"
              aria-label="Computing token baseline"
            >
              <div class="h-4 w-36 rounded bg-brand-100"></div>
              <div class="mt-2 h-3 w-48 rounded bg-brand-100/70"></div>
              <div class="mt-4 h-7 w-24 rounded bg-brand-100"></div>
            </div>
          {/if}

          <!-- Write tool catalog -->
          <div>
            <h2 class="mb-3 text-base font-semibold text-slate-950">Write & mutation tools</h2>
            <div class="space-y-4">
              {#each writeGroups as group}
                <div class="rounded-lg border border-hairline bg-white p-3">
                  <div class="mb-1 text-xs font-semibold text-slate-800">{group.label}</div>
                  <p class="mb-2 text-[11px] leading-5 text-slate-500">{group.description}</p>
                  <div class="flex flex-wrap gap-1">
                    {#each group.tools as tool}
                      <span
                        class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
                        >{tool}</span
                      >
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </div>
    {/if}
  {/if}
</div>
