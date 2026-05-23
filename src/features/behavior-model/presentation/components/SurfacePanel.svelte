<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Persona } from '$features/behavior-model/domain/entities/Persona';
  import type { Resource } from '$features/behavior-model/domain/entities/Resource';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import { getEffectiveEntities } from '$features/behavior-model/domain/services/EffectiveEntities';
  import { withSharedStateDefinitions } from '$features/behavior-model/domain/services/SharedStateDefinitions';
  import { editorStore } from '$features/behavior-model/presentation/stores/editorStore.svelte';
  import StateDefinitionsEditor from './StateDefinitionsEditor.svelte';
  import ActionsEditor from './ActionsEditor.svelte';
  import SurfaceRulesEditor from './SurfaceRulesEditor.svelte';
  import SurfaceInvariantsEditor from './SurfaceInvariantsEditor.svelte';
  import SurfaceMetaEditor from './SurfaceMetaEditor.svelte';
  import SurfaceResourcesView from './SurfaceResourcesView.svelte';
  import SurfaceEntitiesView from './SurfaceEntitiesView.svelte';
  import SurfacePersonasView from './SurfacePersonasView.svelte';

  type Props = {
    feature: Feature;
    surface: Surface;
    resources: readonly Resource[];
    personas: readonly Persona[];
  };
  let { feature, surface, resources, personas }: Props = $props();

  type Tab =
    | 'actions'
    | 'state'
    | 'rules'
    | 'invariants'
    | 'data'
    | 'resources'
    | 'personas';

  // Driven by the editor store so external navigators (e.g. the maturity
  // panel) can deep-link to a specific tab.
  const activeTab = $derived<Tab>(editorStore.surfacePanelTab);
  const stateAwareSurface = $derived(withSharedStateDefinitions(feature, surface));
  function setTab(tab: Tab) {
    editorStore.setSurfacePanelTab(tab);
  }

  const usedResourceCount = $derived.by(() => {
    const ids = new Set<string>();
    for (const cap of surface.actions) {
      for (const param of cap.parameters) {
        if (param.resourceId) ids.add(param.resourceId);
      }
    }
    return ids.size;
  });

  // Effective data view: every namespace appearing on the surface counts as a
  // Entity entity, regardless of whether it has been materialized.
  const usedDataCount = $derived.by(() => {
    const surfacePaths = new Set(stateAwareSurface.stateDefinitions.map((d) => String(d.path)));
    if (surfacePaths.size === 0) return 0;
    const effective = getEffectiveEntities(feature);
    let count = 0;
    for (const entry of effective) {
      if (entry.fields.some((f) => surfacePaths.has(String(f.path)))) count += 1;
    }
    return count;
  });

  // A Persona is "relevant here" when it overrides any state path on this
  // surface OR pre-fills any parameter used by actions on this surface.
  const usedPersonaCount = $derived.by(() => {
    const surfacePaths = new Set(stateAwareSurface.stateDefinitions.map((d) => String(d.path)));
    const surfaceParamNames = new Set<string>();
    for (const cap of surface.actions) {
      for (const p of cap.parameters) surfaceParamNames.add(p.name);
    }
    let count = 0;
    for (const persona of personas) {
      const hits =
        persona.stateOverrides.some((o) => surfacePaths.has(String(o.path))) ||
        persona.parameterOverrides.some((o) => surfaceParamNames.has(o.parameterName));
      if (hits) count += 1;
    }
    return count;
  });

  // Each tab carries a short hint that surfaces near the header inside the
  // panel, keeps the user oriented without expanding the tab bar itself.
  const tabs: ReadonlyArray<{
    readonly key: Tab;
    readonly label: string;
    readonly count: number;
    readonly hint: string;
  }> = $derived([
    {
      key: 'actions',
      label: 'Actions',
      count: surface.actions.length,
      hint: 'User- or AI-triggerable actions on this surface, with parameters, rules, and effects.'
    },
    {
      key: 'state',
      label: 'State',
      count: surface.stateDefinitions.length,
      hint: 'Typed state slots this surface reads or writes. Share with sibling surfaces below each row.'
    },
    {
      key: 'rules',
      label: 'Surface rules',
      count: surface.rules.length,
      hint: 'Cross-cutting gates that fire before every action on this surface (auth, role, kill-switch).'
    },
    {
      key: 'invariants',
      label: 'Invariants',
      count: surface.invariants.length,
      hint: 'Conditions that must hold after every action on this surface. A violation blocks the run.'
    },
    {
      key: 'data',
      label: 'Entities',
      count: usedDataCount,
      hint: 'Entity namespaces touched on this surface (read or written by any state slot).'
    },
    {
      key: 'resources',
      label: 'Resources',
      count: usedResourceCount,
      hint: 'External resources (DB, API, queue) referenced by parameters on this surface.'
    },
    {
      key: 'personas',
      label: 'Personas',
      count: usedPersonaCount,
      hint: 'Simulator presets whose state or parameter overrides target paths on this surface.'
    }
  ]);

  const activeTabInfo = $derived(tabs.find((t) => t.key === activeTab));
</script>

<section class="rounded-lg border border-hairline bg-white">
  <SurfaceMetaEditor {surface} />

  <!-- Tab bar: white-card active state on a slate-50/60 strip. Avoids the
       dark-to-light transition flash the earlier dark-active style caused
       (and the previously-active tab no longer hovers white when the cursor
       passes back over it, hover is a subtle slate). -->
  <div class="border-b border-hairline bg-slate-50/60 px-3 pt-3 pb-2">
    <div role="tablist" class="flex flex-wrap gap-1 text-sm">
      {#each tabs as tab (tab.key)}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === tab.key}
          class="group inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs {activeTab === tab.key
            ? 'bg-white text-slate-950 font-medium shadow-sm ring-1 ring-slate-200'
            : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'}"
          onclick={() => setTab(tab.key)}
        >
          <span>{tab.label}</span>
          <span
            class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums {activeTab === tab.key
              ? 'bg-slate-100 text-slate-700'
              : tab.count > 0
                ? 'bg-slate-200/80 text-slate-700 group-hover:bg-slate-300/80'
                : 'bg-slate-100 text-slate-400'}"
          >
            {tab.count}
          </span>
        </button>
      {/each}
    </div>
    {#if activeTabInfo}
      <p class="mt-2 text-[11px] leading-relaxed text-slate-500">{activeTabInfo.hint}</p>
    {/if}
  </div>

  <div class="p-4" data-focus-target={`tab:${surface.id}:${activeTab}`}>
    {#if activeTab === 'actions'}
      <ActionsEditor
        surface={stateAwareSurface}
        {resources}
        availableSurfaces={feature.surfaces.map((s) => ({ id: s.id, name: s.name }))}
        availableEvents={feature.events ?? []}
      />
    {:else if activeTab === 'state'}
      <StateDefinitionsEditor {surface} surfaces={feature.surfaces} />
    {:else if activeTab === 'rules'}
      <SurfaceRulesEditor surface={stateAwareSurface} />
    {:else if activeTab === 'invariants'}
      <SurfaceInvariantsEditor surface={stateAwareSurface} />
    {:else if activeTab === 'data'}
      <SurfaceEntitiesView {feature} {surface} {resources} />
    {:else if activeTab === 'resources'}
      <SurfaceResourcesView {surface} {resources} />
    {:else}
      <SurfacePersonasView {surface} {personas} />
    {/if}
  </div>
</section>
