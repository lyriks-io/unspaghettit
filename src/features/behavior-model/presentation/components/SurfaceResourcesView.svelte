<script lang="ts">
  import type { Resource } from '$features/behavior-model/domain/entities/Resource';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import {
    resourceKindLabel,
    resourceScopeLabel,
    sensitivityLabel
  } from '$features/behavior-model/domain/value-objects/Resource';
  import type { ResourceId } from '$features/behavior-model/domain/value-objects/ids';

  type Props = { surface: Surface; resources: readonly Resource[] };
  let { surface, resources }: Props = $props();

  type Usage = {
    readonly resource: Resource;
    readonly usedBy: readonly { actionName: string; parameterName: string }[];
  };

  const usage = $derived.by<Usage[]>(() => {
    const byResource = new Map<ResourceId, Usage['usedBy'][number][]>();
    for (const cap of surface.actions) {
      for (const param of cap.parameters) {
        if (!param.resourceId) continue;
        if (!byResource.has(param.resourceId)) byResource.set(param.resourceId, []);
        byResource
          .get(param.resourceId)!
          .push({ actionName: cap.name, parameterName: param.name });
      }
    }
    const out: Usage[] = [];
    for (const [resId, usedBy] of byResource) {
      const resource = resources.find((r) => r.id === resId);
      if (resource) out.push({ resource, usedBy });
    }
    return out;
  });

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
</script>

<div class="space-y-3 text-sm">
  {#if usage.length === 0}
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50/30 p-6 text-center">
      <p class="text-sm font-medium text-slate-700">No linked resources here</p>
      <p class="mx-auto mt-1 max-w-md text-xs text-slate-500">
        No parameter on this surface points at a resource yet. Open an action, expand a
        parameter, and pick one in the <em>Linked resource</em> section. Manage the global
        catalogue under <strong>Resources</strong> in the top-level tabs.
      </p>
    </div>
  {:else}
    <ul class="space-y-2">
      {#each usage as entry (entry.resource.id)}
        <li class="rounded-md border border-slate-200 bg-white p-3 text-xs">
          <header class="flex flex-wrap items-center gap-2">
            <span class="font-medium text-slate-900">{entry.resource.name}</span>
            <span
              class="rounded-md px-1.5 py-0.5 text-[10px] font-medium {sensitivityColor(
                entry.resource.sensitivity
              )}"
            >
              {sensitivityLabel(entry.resource.sensitivity)}
            </span>
            {#if entry.resource.containsPii}
              <span class="rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">PII</span>
            {/if}
          </header>
          <div class="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            <span>{resourceKindLabel(entry.resource.kind)}</span>
            {#if entry.resource.provider}<span>· {entry.resource.provider}</span>{/if}
            <span>· {resourceScopeLabel(entry.resource.scope)}</span>
            {#if entry.resource.location}<span>· {entry.resource.location}</span>{/if}
          </div>
          {#if entry.resource.complianceTags.length > 0}
            <div class="mt-1 flex flex-wrap gap-1">
              {#each entry.resource.complianceTags as tag}
                <span
                  class="mono rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-600"
                  >{tag}</span
                >
              {/each}
            </div>
          {/if}
          <div class="mt-2">
            <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Used on this surface by
            </p>
            <ul class="ml-3 list-disc text-[11px] text-slate-700">
              {#each entry.usedBy as ref}
                <li>
                  <span class="font-medium">{ref.actionName}</span>
                  ·
                  <span class="mono">{ref.parameterName}</span>
                </li>
              {/each}
            </ul>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
