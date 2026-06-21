<script lang="ts">
  import type { Entity } from '$features/behavior-model/domain/entities/Entity';
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import {
    asEntityFieldId,
    asEntityId
  } from '$features/behavior-model/domain/value-objects/ids';
  import {
    addEntity,
    removeEntity,
    updateEntity
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import {
    getEffectiveEntities,
    materializeFields,
    type EffectiveEntities
  } from '$features/behavior-model/domain/services/EffectiveEntities';
  import { humanizeStatePath } from '$features/behavior-model/domain/value-objects/humanize';
  import {
    resourceKindLabel,
    sensitivityLabel
  } from '$features/behavior-model/domain/value-objects/Resource';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import { editorStore } from '$features/behavior-model/presentation/stores/editorStore.svelte';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import EntityEditor from './EntityEditor.svelte';
  import { useFeatureQueueContext } from '$features/behavior-model/presentation/context/featureQueueContext';
  import { inheritedData } from '$features/projects/domain/services/InheritedFromProject';

  type Props = { feature: Feature };
  let { feature }: Props = $props();

  const queueCtx = useFeatureQueueContext();
  let expandedNamespace = $state<string | null>(null);

  const effective = $derived(getEffectiveEntities(feature));
  const inherited = $derived(inheritedData(queueCtx.siblings));

  // Build a stored Entity record on-demand so the user can attach metadata to a
  // deduced entry without seeing two list items.
  async function ensureMaterialized(entry: EffectiveEntities): Promise<Entity> {
    if (entry.id) {
      return feature.entities.find((d) => d.id === entry.id) ?? buildAndStore(entry);
    }
    return buildAndStore(entry);
  }

  async function buildAndStore(entry: EffectiveEntities): Promise<Entity> {
    const data: Entity = {
      id: asEntityId(cryptoIdGenerator()),
      namespace: entry.namespace,
      description: entry.description,
      resourceId: entry.resourceId,
      fields: materializeFields(entry, () => asEntityFieldId(cryptoIdGenerator()))
    };
    await featureStore.mutate((current) => addEntity(current, data));
    return data;
  }

  async function update(data: Entity) {
    await featureStore.mutate((current) => updateEntity(current, data));
  }

  async function reset(entry: EffectiveEntities) {
    if (!entry.id) return;
    if (
      !confirm(
        'Reset this entry to its deduced form? Description and resource link will be lost.'
      )
    )
      return;
    await featureStore.mutate((current) => removeEntity(current, entry.id!));
  }

  async function expand(entry: EffectiveEntities) {
    if (expandedNamespace === entry.namespace) {
      expandedNamespace = null;
      return;
    }
    // Lazy-materialize so the editor has a real record to edit.
    if (!entry.id) await ensureMaterialized(entry);
    expandedNamespace = entry.namespace;
  }

  function findResource(resourceId: string | undefined) {
    if (!resourceId) return null;
    return feature.resources.find((r) => r.id === resourceId) ?? null;
  }

  function focusResourcesTab() {
    editorStore.setTopLevelTab('resources');
  }

  // Used to grab the freshest stored Entity after lazy materialization; the
  // feature prop refreshes via the store mutation.
  function findStored(namespace: string): Entity | undefined {
    return feature.entities.find((d) => d.namespace === namespace);
  }
</script>

<div class="space-y-6">
  <header class="space-y-1">
    <h2 class="text-lg font-semibold text-neutral-900">Entity</h2>
    <p class="text-sm text-neutral-600">
      Logical entities your feature handles. User, Order, Cart, Product. Every state-path
      namespace appears here as a fact derived from your model. Expand an entry to attach a
      description or link a resource.
    </p>
  </header>

  {#if effective.length === 0}
    <p class="rounded-md border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">
      No data yet. Define some state on a surface. Entries will appear here automatically.
    </p>
  {:else}
    <ul class="divide-y divide-neutral-200 rounded-md border border-neutral-200 bg-white">
      {#each effective as entry (entry.namespace)}
        {@const isExpanded = expandedNamespace === entry.namespace}
        {@const stored = findStored(entry.namespace)}
        {@const linkedResource = findResource(entry.resourceId)}
        <li>
          <header class="flex flex-wrap items-baseline gap-2 px-4 py-3">
            <button
              type="button"
              class="flex flex-1 items-baseline gap-2 text-left"
              onclick={() => expand(entry)}
            >
              <span class="text-neutral-400">{isExpanded ? '▾' : '▸'}</span>
              <h3 class="text-base font-semibold text-neutral-900">{entry.name}</h3>
              <span class="mono text-[11px] text-neutral-500">{entry.namespace}</span>
              <span class="text-[11px] text-neutral-500">
                · {entry.fields.length} field{entry.fields.length === 1 ? '' : 's'}
              </span>
              {#if entry.usedBySurfaces.length > 0}
                <span class="text-[11px] text-neutral-500">
                  · on: {entry.usedBySurfaces.join(', ')}
                </span>
              {/if}
              {#if !entry.isMaterialized}
                <span
                  class="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500"
                  title="No metadata attached yet. Expand to add a description or link a resource."
                >
                  Auto
                </span>
              {/if}
              {#if linkedResource}
                <span class="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-800">
                  {linkedResource.name}
                </span>
              {/if}
            </button>
            {#if entry.isMaterialized}
              <button
                type="button"
                class="text-[11px] text-neutral-400 hover:text-red-600"
                onclick={() => reset(entry)}
                title="Drop the stored record and revert to the auto-deduced view"
              >
                Reset
              </button>
            {/if}
          </header>

          {#if linkedResource}
            <button
              type="button"
              class="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-4 pb-1 text-left text-[11px] text-violet-900 hover:underline"
              onclick={focusResourcesTab}
              title="Open the Resources tab"
            >
              <span class="font-medium">Stored in:</span>
              <span>{linkedResource.name}</span>
              <span class="text-violet-600">·</span>
              <span>{resourceKindLabel(linkedResource.kind)}</span>
              {#if linkedResource.provider}
                <span class="text-violet-600">·</span>
                <span>{linkedResource.provider}</span>
              {/if}
              {#if linkedResource.location}
                <span class="text-violet-600">·</span>
                <span>{linkedResource.location}</span>
              {/if}
              <span class="text-violet-600">·</span>
              <span>{sensitivityLabel(linkedResource.sensitivity)}</span>
              {#if linkedResource.containsPii}
                <span class="rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">PII</span>
              {/if}
              {#each linkedResource.complianceTags as tag}
                <span
                  class="mono rounded-md bg-violet-100/70 px-1 py-0.5 text-[10px] uppercase text-violet-800"
                  >{tag}</span
                >
              {/each}
            </button>
          {/if}

          {#if !isExpanded}
            <ul class="flex flex-wrap gap-1.5 px-4 pb-3 pt-1">
              {#each entry.fields as f (f.path)}
                <li
                  class="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-700"
                  title={f.path}
                >
                  <span>{humanizeStatePath(f.path)}</span>
                  <span class="rounded bg-neutral-200 px-1 text-[10px] text-neutral-600"
                    >{f.type}</span
                  >
                </li>
              {/each}
            </ul>
          {:else if stored}
            <div class="border-t border-neutral-200 bg-neutral-50/40 px-4 py-3">
              <EntityEditor
                data={stored}
                {feature}
                resources={feature.resources}
                onChange={(next) => update(next)}
              />
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
      <ul class="divide-y divide-slate-100 rounded-md border border-slate-200 bg-slate-50/40">
        {#each inherited as row (row.value.id)}
          {@const data = row.value}
          <li class="flex flex-wrap items-baseline gap-2 px-4 py-2 text-xs">
            <span class="font-medium text-slate-800">{data.namespace}</span>
            <span class="text-[11px] text-neutral-500">
              · {data.fields.length} field{data.fields.length === 1 ? '' : 's'}
            </span>
            <span class="ml-auto rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700" title="Source feature">
              {row.sourceFeatureName}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
