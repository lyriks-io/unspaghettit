<script lang="ts">
  import { onMount } from 'svelte';
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

  // Sentinel project id for features that aren't linked to any project.
  // Empty string would collide with valid (?) ids; '__unassigned' is namespaced.
  const UNASSIGNED = '__unassigned';

  let selectedId = $state<string>('');
  let selectedProjectId = $state<string>('');
  let feature = $state<Feature | null>(null);
  let loadingFeature = $state(false);
  let loadError = $state<string | null>(null);

  // featureId -> projectId (or UNASSIGNED). Populated once projects + features
  // are loaded. Lets us scope the feature dropdown to one project's features.
  let projectByFeatureId = $state<Map<string, string>>(new Map());

  // Project demoed by the get_project / get_project_aggregate cards. Follows
  // the project filter so the page is internally consistent.
  let currentProject = $state<Project | null>(null);
  let currentProjectAggregate = $state<ProjectAggregateRead | null>(null);

  // Action: Show Tool Examples. Tracks which MCP tool examples are
  // expanded on the page. Toggled by clicking a tool header. State path:
  // mcpPlayground.shownTool. Defaults to "get_feature" so users land on a
  // useful example.
  let shownTool = $state<string>('get_feature');

  function showToolExamples(tool: string): void {
    shownTool = tool;
  }

  async function refreshMembership(): Promise<void> {
    const container = await getBrowserContainer();
    const next = new Map<string, string>();
    await Promise.all(
      projectsStore.summaries.map(async (summary) => {
        const project = await container.useCases.getProject(asProjectId(String(summary.id)));
        for (const fid of project?.featureIds ?? []) {
          next.set(String(fid), String(summary.id));
        }
      })
    );
    projectByFeatureId = next;
  }

  onMount(() => {
    void (async () => {
      await Promise.all([featuresStore.refresh(), projectsStore.refresh()]);
      await refreshMembership();
    })();
  });

  // Keep the get_project / get_project_aggregate demo cards in sync with the
  // project filter. Skip when the user has chosen the Unassigned bucket; it
  // has no project to fetch.
  $effect(() => {
    if (!selectedProjectId || selectedProjectId === UNASSIGNED) {
      currentProject = null;
      currentProjectAggregate = null;
      return;
    }
    const projectId = asProjectId(selectedProjectId);
    void (async () => {
      const container = await getBrowserContainer();
      const [project, aggregate] = await Promise.all([
        container.useCases.getProject(projectId),
        container.useCases.getProjectAggregate(projectId)
      ]);
      currentProject = project;
      currentProjectAggregate = aggregate;
    })();
  });

  // Project options: every project that owns at least one of the loaded
  // features, plus "Unassigned" if any feature has no project. Derived from
  // membership so empty/stale projects don't clutter the dropdown.
  const projectOptions = $derived.by(() => {
    const liveProjectIds = new Set(projectByFeatureId.values());
    const options = projectsStore.summaries
      .filter((summary) => liveProjectIds.has(String(summary.id)))
      .map((summary) => ({ id: String(summary.id), name: summary.name }));
    const hasUnassigned = featuresStore.summaries.some(
      (summary) => !projectByFeatureId.has(String(summary.id))
    );
    if (hasUnassigned) options.push({ id: UNASSIGNED, name: 'Unassigned' });
    return options;
  });

  const featuresInSelectedProject = $derived.by(() => {
    if (!selectedProjectId) return featuresStore.summaries;
    return featuresStore.summaries.filter((summary) => {
      const projectId = projectByFeatureId.get(String(summary.id));
      if (selectedProjectId === UNASSIGNED) return projectId === undefined;
      return projectId === selectedProjectId;
    });
  });

  // Default project = the one owning the currently-loaded feature; fallback to
  // the first option. Set once we have data; user picks take priority after.
  $effect(() => {
    if (selectedProjectId) return;
    if (projectOptions.length === 0) return;
    const currentFeatureProject = selectedId ? projectByFeatureId.get(selectedId) : undefined;
    const matchedOption = currentFeatureProject
      ? projectOptions.find((option) => option.id === currentFeatureProject)
      : undefined;
    selectedProjectId = matchedOption?.id ?? projectOptions[0]?.id ?? '';
  });

  // Auto-pick the first feature in the selected project, and switch when the
  // current selection no longer belongs to it.
  $effect(() => {
    if (featuresInSelectedProject.length === 0) {
      selectedId = '';
      return;
    }
    const stillVisible = featuresInSelectedProject.some(
      (summary) => summary.id === selectedId
    );
    if (!stillVisible) {
      selectedId = String(featuresInSelectedProject[0]!.id);
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
    output: unknown;
    description: string;
  };

  const baseline = $derived.by(() => {
    if (!feature) return null;
    const json = exportFeatureToJson(feature);
    return { json, tokens: estimateTokens(json) };
  });

  const runScenarios = runScenariosUseCase();

  const readCards = $derived.by((): readonly ReadToolCard[] => {
    if (!feature) return [];
    const selectedFeature = feature;
    const out: ReadToolCard[] = [];

    out.push({
      name: 'list_features',
      callSignature: 'list_features()',
      output: listFeaturesTool(featuresStore.summaries),
      description: 'Compact index of all features. Discovery entry point.'
    });

    out.push({
      name: 'get_feature',
      callSignature: `get_feature(featureId: "${feature.id}")`,
      output: getFeatureIndexTool(selectedFeature),
      description: 'Structured index. Surfaces, actions, state counts, devContext. Pass verbose:true only when you need the full blob.'
    });

    out.push({
      name: 'list_actions',
      callSignature: `list_actions(featureId: "${feature.id}")`,
      output: listActionsTool(selectedFeature),
      description: 'Flat list of all actions across surfaces with id, name, intent, rule/effect counts.'
    });

    const firstCap = firstCapability(selectedFeature);
    if (firstCap) {
      out.push({
        name: 'get_action',
        callSignature: `get_action(featureId: "${feature.id}", actionId: "${firstCap.action.id}")`,
        output: getActionTool(selectedFeature, asActionId(firstCap.action.id)),
        description: 'Single action with its rules, parameters, linked state defs, and implementation guidance. The primary focused query.'
      });
    }

    const firstStateDef = feature.surfaces.find((s) => s.stateDefinitions.length > 0)?.stateDefinitions[0];
    if (firstStateDef) {
      out.push({
        name: 'find_state_references',
        callSignature: `find_state_references(featureId: "${feature.id}", statePath: "${firstStateDef.path}")`,
        output: findStateReferencesTool(selectedFeature, asStatePath(String(firstStateDef.path)) as StatePath),
        description: 'Count refs to a state path across rules, effects, invariants, requiredStates, and parameter bindings. Run before editing or removing state.'
      });
    }

    if (firstCap) {
      const snapshot = buildSnapshot(firstCap.surface);
      const parameters = buildParameters(firstCap.action);
      try {
        out.push({
          name: 'dry_run_simulate',
          callSignature: `dry_run_simulate(${firstCap.surface.name} ▸ ${firstCap.action.name}, default snapshot)`,
          output: dryRunSimulateTool({
            feature: selectedFeature,
            surfaceId: asSurfaceId(firstCap.surface.id),
            actionId: asActionId(firstCap.action.id),
            snapshot,
            parameters
          }),
          description: 'Pure simulation. Runs the deterministic engine on proposed state without writing to disk. Validate changes before committing.'
        });
      } catch (e) {
        out.push({
          name: 'dry_run_simulate',
          callSignature: `dry_run_simulate(${firstCap.surface.name} ▸ ${firstCap.action.name})`,
          output: { error: (e as Error).message },
          description: 'Simulation failed with default snapshot.'
        });
      }
    }

    out.push({
      name: 'score_feature',
      callSignature: `score_feature(featureId: "${feature.id}")`,
      output: scoreFeatureTool(selectedFeature),
      description:
        'Compact summary. Score, percentage, issue counts, top failing areas, worst surfaces. Pass includeIssues:true (next card) when you need the actual issues.'
    });

    const worstSurface = feature.surfaces.reduce<Surface | null>((worst, s) => {
      // Pick the surface most likely to surface issues so the demo card has
      // something to show. Falls back to the first surface if all are clean.
      const issueProxy = s.actions.length + s.stateDefinitions.length;
      const worstProxy =
        worst === null ? -1 : worst.actions.length + worst.stateDefinitions.length;
      return issueProxy > worstProxy ? s : worst;
    }, null);
    if (worstSurface) {
      out.push({
        name: 'score_feature (issues)',
        callSignature: `score_feature(featureId: "${feature.id}", surfaceId: "${worstSurface.id}", includeIssues: true)`,
        output: scoreFeatureTool(selectedFeature, {
          surfaceId: String(worstSurface.id),
          includeIssues: true
        }),
        description: `Same tool, asked to return the actual issue list (includeIssues:true) for ${worstSurface.name}. The surfaceId / area / severity filters exist to keep the issue array bounded. Typical payload stays under 10 KB instead of dumping every issue across the whole feature.`
      });
    }

    try {
      out.push({
        name: 'run_all_scenarios',
        callSignature: `run_all_scenarios(featureId: "${feature.id}")`,
        output: runScenarios({ feature: selectedFeature }),
        description:
          'Run every Scenario through the simulator and assert against expectedStatus + expectedAssertions. Per-result parameterErrors[] and invariantViolations[] surface the cause when a scenario unexpectedly blocks.'
      });
    } catch (e) {
      out.push({
        name: 'run_all_scenarios',
        callSignature: `run_all_scenarios(featureId: "${feature.id}")`,
        output: { error: (e as Error).message },
        description: 'Run all scenarios.'
      });
    }

    out.push({
      name: 'list_projects',
      callSignature: 'list_projects()',
      output: { summaries: projectsStore.summaries },
      description:
        'Compact project summaries (id, name, featureCount, timestamps). Cheapest discovery call for projects. Mirrors list_features.'
    });

    if (currentProject) {
      out.push({
        name: 'get_project',
        callSignature: `get_project(projectId: "${currentProject.id}")`,
        output: currentProject,
        description:
          'Full Project document (id, name, description, featureIds[], timestamps). Use list_projects for discovery first.'
      });
    }

    if (currentProjectAggregate) {
      out.push({
        name: 'get_project_aggregate',
        callSignature: `get_project_aggregate(projectId: "${currentProjectAggregate.projectId}")`,
        output: currentProjectAggregate,
        description:
          'Cross-feature view of a project: flat list of resources, data namespaces, registered events, and transitions, each tagged with the source feature. Use this to reason about a project as one logical surface.'
      });
    }

    return out;
  });

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
        'move_feature_in_project'
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

<div class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
  <header class="mb-6 border-b border-slate-200 pb-6">
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div class="max-w-3xl">
    <p class="text-xs font-semibold uppercase tracking-wide text-brand-700">Agent integration</p>
    <h1 class="mt-2 text-4xl font-semibold tracking-tight text-slate-950">MCP server</h1>
    <p class="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
      The MCP server lets AI coding agents read and edit Unspaghettit Features and Projects without
      pasting the full JSON blob into a prompt. A Feature is one LLM-sized slice of behavior
      (a flow, a screen, a capability); a Project groups many Features under one product or codebase.
      The read tools below run live against the selected Feature (plus the first Project). Compare
      their token cost to the raw JSON baseline on the right.
    </p>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:w-[34rem]">
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
    <label for="project-select" class="text-sm font-medium text-slate-700">Project:</label>
    <select
      id="project-select"
      bind:value={selectedProjectId}
      disabled={projectOptions.length === 0}
      class="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {#each projectOptions as option (option.id)}
        <option value={option.id}>{option.name}</option>
      {/each}
    </select>
    <span class="text-slate-300" aria-hidden="true">/</span>
    <label for="feature-select" class="text-sm font-medium text-slate-700">Feature:</label>
    <select
      id="feature-select"
      bind:value={selectedId}
      disabled={featuresInSelectedProject.length === 0}
      class="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {#each featuresInSelectedProject as summary (summary.id)}
        <option value={summary.id}>{summary.name}</option>
      {/each}
    </select>
    <span class="text-xs text-slate-500">
      {featuresInSelectedProject.length} feature{featuresInSelectedProject.length === 1 ? '' : 's'} in this project
    </span>
    {#if loadingFeature}
      <span class="text-xs text-slate-500">Loading...</span>
    {/if}
  </div>

  {#if featuresStore.summaries.length === 0 && !featuresStore.loading}
    <div class="rounded-lg border border-dashed border-hairline bg-white p-6 text-sm text-slate-500">
      No features yet. <a href="/features" class="text-brand-700 underline">Create one</a> first.
    </div>
  {:else if featuresInSelectedProject.length === 0}
    <div class="rounded-lg border border-dashed border-hairline bg-white p-6 text-sm text-slate-500">
      No features in this project. Pick another project or
      <a href="/projects/{selectedProjectId}" class="text-brand-700 underline">add one</a>.
    </div>
  {:else if loadError}
    <p class="text-sm text-red-600">{loadError}</p>
  {:else if feature && baseline}
    <!-- Two-column layout: read tools left, sidebar right -->
    <div class="flex flex-col gap-8 lg:flex-row lg:items-start">
      <!-- Read tools -->
      <div class="min-w-0 flex-1">
        <h2 class="mb-4 text-base font-semibold text-slate-950">Read tools</h2>
        <ul class="space-y-3">
          {#each readCards as card (card.name)}
            {@const tokens = estimateTokens(card.output)}
            {@const json = JSON.stringify(card.output, null, 2)}
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
                    {tokens.toLocaleString()}
                  </div>
                  <div class="text-[10px] uppercase tracking-wide text-slate-400">tokens</div>
                  <div class="mt-0.5 text-[11px] text-slate-500">
                    {fmtPercent(tokens, baseline.tokens)}
                  </div>
                </div>
              </div>
              <details class="mt-3">
                <summary class="cursor-pointer text-xs text-slate-500 hover:text-slate-800"
                  >Show output</summary
                >
                <pre
                  class="mt-2 max-h-72 overflow-auto rounded-md bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">{json}</pre>
              </details>
            </li>
          {/each}
        </ul>
      </div>

      <!-- Sidebar: baseline + write tool catalog -->
      <div class="w-full shrink-0 space-y-6 lg:w-80">
        <!-- Baseline -->
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
          <details class="mt-3">
            <summary class="cursor-pointer text-xs text-slate-600 hover:text-slate-950"
              >Show JSON ({baseline.json.length.toLocaleString()} chars)</summary
            >
            <pre
              class="mt-2 max-h-64 overflow-auto rounded-md bg-white p-2 text-[11px] leading-relaxed text-slate-700 ring-1 ring-hairline">{baseline.json}</pre>
          </details>
        </div>

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
</div>
