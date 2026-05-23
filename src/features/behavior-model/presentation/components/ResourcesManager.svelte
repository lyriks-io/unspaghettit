<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Resource } from '$features/behavior-model/domain/entities/Resource';
  import type { ResourceId } from '$features/behavior-model/domain/value-objects/ids';
  import { asResourceId } from '$features/behavior-model/domain/value-objects/ids';
  import {
    addResource,
    removeResource,
    updateResource
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import {
    resourceKindLabel,
    resourceScopeLabel,
    sensitivityLabel
  } from '$features/behavior-model/domain/value-objects/Resource';
  import {
    buildResourceUsage,
    totalUsage,
    type ResourceParameterUsage
  } from '$features/behavior-model/domain/services/ResourceUsage';
  import { humanizeStatePath } from '$features/behavior-model/domain/value-objects/humanize';
  import { editorStore } from '$features/behavior-model/presentation/stores/editorStore.svelte';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import ResourceEditor from './ResourceEditor.svelte';
  import { projectContextStore } from '$features/projects/presentation/stores/projectContextStore.svelte';
  import { inheritedResources } from '$features/projects/domain/services/InheritedFromProject';

  type Props = { feature: Feature };
  let { feature }: Props = $props();

  let expandedId = $state<ResourceId | null>(null);

  async function add() {
    const resource: Resource = {
      id: asResourceId(cryptoIdGenerator()),
      name: 'New resource',
      kind: 'relational_db',
      provider: '',
      scope: 'cloud',
      sensitivity: 'internal',
      containsPii: false,
      complianceTags: [],
      accessMode: 'read_write'
    };
    await featureStore.mutate((current) => addResource(current, resource));
    expandedId = resource.id;
  }

  async function update(resource: Resource) {
    await featureStore.mutate((current) => updateResource(current, resource));
  }

  async function remove(id: ResourceId) {
    if (!confirm('Delete this resource? Parameters that reference it will keep the dangling id.'))
      return;
    await featureStore.mutate((current) => removeResource(current, id));
  }

  function sensitivityColor(s: Resource['sensitivity']): string {
    switch (s) {
      case 'public':
        return 'bg-emerald-50 text-emerald-700';
      case 'internal':
        return 'bg-sky-50 text-sky-700';
      case 'confidential':
        return 'bg-amber-50 text-amber-800';
      case 'restricted':
        return 'bg-red-50 text-red-700';
    }
  }

  function navigateToParam(p: ResourceParameterUsage) {
    editorStore.navigateTo({
      surfaceId: p.surfaceId,
      actionId: p.actionId,
      surfacePanelTab: 'actions'
    });
  }

  function focusDataTab() {
    editorStore.setTopLevelTab('data');
  }

  const inherited = $derived(inheritedResources(projectContextStore.siblings));
</script>

<div class="space-y-3 text-sm">
  <p class="text-xs text-neutral-500">
    Resources describe the data your feature reads from and writes to. They capture provider,
    location, sensitivity, retention, and compliance. So humans and AI builders share a single
    source of truth for every data touchpoint.
  </p>

  <button
    type="button"
    class="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
    onclick={add}
  >
    + New resource
  </button>

  {#if feature.resources.length === 0 && inherited.length === 0}
    <p class="rounded-md border border-dashed border-neutral-300 p-3 text-center text-xs text-neutral-500">
      No resources yet.
    </p>
  {:else}
    <ul class="space-y-2">
      {#each feature.resources as resource (resource.id)}
        {@const isExpanded = expandedId === resource.id}
        {@const usage = buildResourceUsage(feature, resource.id)}
        {@const usageTotal = totalUsage(usage)}
        <li
          class="rounded-md border bg-white {isExpanded
            ? 'border-brand-300 ring-1 ring-brand-200'
            : 'border-neutral-200'}"
        >
          <header class="flex items-start gap-2 px-3 py-2 text-xs">
            <button
              type="button"
              class="flex-1 text-left"
              onclick={() => (expandedId = isExpanded ? null : resource.id)}
            >
              <div class="flex items-center gap-2">
                <span class="text-neutral-400">{isExpanded ? '▾' : '▸'}</span>
                <span class="font-medium text-neutral-900">{resource.name}</span>
                <span
                  class="rounded-md px-1.5 py-0.5 text-[10px] font-medium {sensitivityColor(
                    resource.sensitivity
                  )}"
                >
                  {sensitivityLabel(resource.sensitivity)}
                </span>
                {#if resource.containsPii}
                  <span class="rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700"
                    >PII</span
                  >
                {/if}
              </div>
              <div class="ml-5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-neutral-500">
                <span>{resourceKindLabel(resource.kind)}</span>
                {#if resource.provider}<span>· {resource.provider}</span>{/if}
                <span>· {resourceScopeLabel(resource.scope)}</span>
                {#if resource.location}<span>· {resource.location}</span>{/if}
              </div>
              {#if resource.complianceTags.length > 0}
                <div class="ml-5 mt-1 flex flex-wrap gap-1">
                  {#each resource.complianceTags as tag}
                    <span
                      class="mono rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase text-neutral-600"
                      >{tag}</span
                    >
                  {/each}
                </div>
              {/if}
              <div class="ml-5 mt-1 text-[10px] text-neutral-500">
                {#if usageTotal === 0}
                  Not yet referenced anywhere.
                {:else}
                  Used by
                  {#if usage.dataNamespaces.length > 0}
                    <span class="text-violet-700"
                      >{usage.dataNamespaces.length} data
                      entit{usage.dataNamespaces.length === 1 ? 'y' : 'ies'}</span
                    >
                  {/if}
                  {#if usage.dataNamespaces.length > 0 && usage.parameters.length > 0}·{/if}
                  {#if usage.parameters.length > 0}
                    <span class="text-emerald-700"
                      >{usage.parameters.length} parameter{usage.parameters.length === 1
                        ? ''
                        : 's'}</span
                    >
                  {/if}
                {/if}
              </div>
            </button>
            <button
              type="button"
              class="text-xs text-neutral-400 hover:text-red-600"
              onclick={() => remove(resource.id)}
              aria-label="Remove resource"
            >
              ✕
            </button>
          </header>

          {#if isExpanded}
            {#if usageTotal > 0}
              <section class="border-t border-neutral-200 bg-neutral-50/40 p-3 text-xs">
                <header class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                  Used by
                </header>
                {#if usage.dataNamespaces.length > 0}
                  <div class="mb-2">
                    <p class="text-[10px] font-medium text-violet-700">
                      Entity entit{usage.dataNamespaces.length === 1 ? 'y' : 'ies'}
                    </p>
                    <ul class="ml-3 list-disc">
                      {#each usage.dataNamespaces as ns (ns)}
                        <li>
                          <button
                            type="button"
                            class="text-violet-800 hover:underline"
                            onclick={focusDataTab}
                            title="Open the Entity tab"
                          >
                            {humanizeStatePath(ns)}
                          </button>
                          <span class="mono text-[10px] text-neutral-500">({ns})</span>
                        </li>
                      {/each}
                    </ul>
                  </div>
                {/if}
                {#if usage.parameters.length > 0}
                  <div>
                    <p class="text-[10px] font-medium text-emerald-700">
                      Parameter{usage.parameters.length === 1 ? '' : 's'}
                    </p>
                    <ul class="ml-3 list-disc">
                      {#each usage.parameters as p (p.parameterId)}
                        <li>
                          <button
                            type="button"
                            class="text-emerald-800 hover:underline"
                            onclick={() => navigateToParam(p)}
                            title="Open the action"
                          >
                            {p.surfaceName} · {p.actionName} ·
                            <span class="mono">{p.parameterName}</span>
                          </button>
                          <span class="text-[10px] text-neutral-500">({p.parameterType})</span>
                        </li>
                      {/each}
                    </ul>
                  </div>
                {/if}
              </section>
            {/if}
            <div class="border-t border-neutral-200 p-3">
              <ResourceEditor {resource} onChange={(next) => update(next)} />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if inherited.length > 0}
    <section class="space-y-2 border-t border-dashed border-neutral-200 pt-3">
      <header class="flex items-baseline justify-between">
        <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Inherited from project
        </h3>
        <p class="text-[10px] text-slate-400">
          Read-only. Edit on the source feature.
        </p>
      </header>
      <ul class="space-y-2">
        {#each inherited as row (row.value.id)}
          {@const resource = row.value}
          <li class="rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs">
            <div class="flex items-center gap-2">
              <span class="font-medium text-slate-800">{resource.name}</span>
              <span
                class="rounded-md px-1.5 py-0.5 text-[10px] font-medium {sensitivityColor(
                  resource.sensitivity
                )}"
              >
                {sensitivityLabel(resource.sensitivity)}
              </span>
              {#if resource.containsPii}
                <span class="rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">PII</span>
              {/if}
              <span class="ml-auto rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700" title="Source feature">
                {row.sourceFeatureName}
              </span>
            </div>
            <div class="ml-0 mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-neutral-500">
              <span>{resourceKindLabel(resource.kind)}</span>
              {#if resource.provider}<span>· {resource.provider}</span>{/if}
              <span>· {resourceScopeLabel(resource.scope)}</span>
              {#if resource.location}<span>· {resource.location}</span>{/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
