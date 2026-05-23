<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Resource } from '$features/behavior-model/domain/entities/Resource';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import { humanizeStatePath } from '$features/behavior-model/domain/value-objects/humanize';
  import { getEffectiveEntities } from '$features/behavior-model/domain/services/EffectiveEntities';

  type Props = {
    feature: Feature;
    surface: Surface;
    resources: readonly Resource[];
  };
  let { feature, surface, resources }: Props = $props();

  const effective = $derived(getEffectiveEntities(feature));

  const inUse = $derived.by(() => {
    const surfacePaths = new Set(surface.stateDefinitions.map((d) => String(d.path)));
    return effective
      .map((e) => ({
        entry: e,
        fieldsUsed: e.fields.filter((f) => surfacePaths.has(String(f.path)))
      }))
      .filter((x) => x.fieldsUsed.length > 0);
  });

  function findResource(resourceId: string | undefined): Resource | undefined {
    if (!resourceId) return undefined;
    return resources.find((r) => r.id === resourceId);
  }
</script>

<div class="space-y-3 text-sm">
  {#if inUse.length === 0}
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50/30 p-6 text-center">
      <p class="text-sm font-medium text-slate-700">No entities touched here</p>
      <p class="mx-auto mt-1 max-w-md text-xs text-slate-500">
        Entities appear here when a state slot on this surface lives under their namespace.
        Define entities under the <strong>Entities</strong> tab at the top of the feature editor.
      </p>
    </div>
  {:else}
    <ul class="space-y-2">
      {#each inUse as item (item.entry.namespace)}
        {@const resource = findResource(item.entry.resourceId)}
        <li class="rounded-md border border-slate-200 bg-white p-3 text-xs">
          <header class="flex flex-wrap items-center gap-2">
            <span class="font-medium text-slate-900">{item.entry.name}</span>
            <span
              class="mono rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
              >{item.entry.namespace}</span
            >
            {#if !item.entry.isMaterialized}
              <span
                class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500"
                title="Auto-derived from state-path namespace"
              >
                Auto
              </span>
            {/if}
            {#if resource}
              <span class="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-800"
                >{resource.name}</span
              >
            {/if}
          </header>
          {#if item.entry.description}
            <p class="mt-0.5 text-[11px] text-slate-500">{item.entry.description}</p>
          {/if}
          <div class="mt-2">
            <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Fields used on this surface
            </p>
            <ul class="ml-3 list-disc text-[11px] text-slate-700">
              {#each item.fieldsUsed as field (field.path)}
                <li>
                  {humanizeStatePath(field.path)}
                  <span class="rounded-md bg-slate-100 px-1 text-[10px] text-slate-600"
                    >{field.type}</span
                  >
                </li>
              {/each}
            </ul>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
