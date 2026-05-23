<script lang="ts">
  import type { Entity, EntityField } from '$features/behavior-model/domain/entities/Entity';
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Resource } from '$features/behavior-model/domain/entities/Resource';
  import type {
    EntityFieldId,
    ResourceId
  } from '$features/behavior-model/domain/value-objects/ids';
  import {
    asEntityFieldId,
    asResourceId
  } from '$features/behavior-model/domain/value-objects/ids';
  import {
    isStatePath,
    asStatePath
  } from '$features/behavior-model/domain/value-objects/StatePath';
  import {
    statePathFromName
  } from '$features/behavior-model/domain/value-objects/humanize';
  import type { StateType } from '$features/behavior-model/domain/value-objects/StateValue';
  import {
    resourceKindLabel,
    sensitivityLabel
  } from '$features/behavior-model/domain/value-objects/Resource';
  import {
    countStatePathReferences,
    formatReferenceBreakdown,
    totalReferences
  } from '$features/behavior-model/domain/services/StatePathReferences';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import EntityFieldRow from './EntityFieldRow.svelte';

  type Props = {
    data: Entity;
    feature: Feature;
    resources: readonly Resource[];
    onChange: (next: Entity) => void;
  };
  let { data, feature, resources, onChange }: Props = $props();

  function patch(p: Partial<Entity>) {
    onChange({ ...data, ...p });
  }

  function addField() {
    const baseName = `field${data.fields.length + 1}`;
    const path = asStatePath(`${data.namespace}.${baseName}`);
    const field: EntityField = {
      id: asEntityFieldId(cryptoIdGenerator()),
      name: baseName,
      path,
      type: 'string'
    };
    patch({ fields: [...data.fields, field] });
  }

  function updateField(id: EntityFieldId, p: Partial<EntityField>) {
    patch({
      fields: data.fields.map((f) => (f.id === id ? { ...f, ...p } : f))
    });
  }

  function removeField(id: EntityFieldId) {
    const field = data.fields.find((f) => f.id === id);
    if (!field) return;
    if (field.path) {
      const refs = countStatePathReferences(feature, field.path);
      // Subtract this field itself from "otherDataFields". We already know
      // we're about to remove it, so we don't want to count it as collateral.
      const otherFields = Math.max(0, refs.otherDataFields - 1);
      const adjusted = { ...refs, otherDataFields: otherFields };
      const total = totalReferences(adjusted) - refs.stateDefinitions; // state defs survive
      const stateDefHint =
        refs.stateDefinitions > 0
          ? `\n\nThe underlying state path "${field.path}" still exists as a state definition. Removing this field only removes its catalogue entry, not the state itself.`
          : '';
      if (total > 0) {
        const breakdown = formatReferenceBreakdown({
          ...adjusted,
          stateDefinitions: 0
        });
        const ok = confirm(
          `Remove field "${field.name}" (${field.path})?\n\n` +
            `${total} link${total === 1 ? '' : 's'} elsewhere reference this path:\n` +
            `  ${breakdown}\n\n` +
            `These references won't be deleted, but they may now be undocumented.${stateDefHint}`
        );
        if (!ok) return;
      } else if (!confirm(`Remove field "${field.name}"?`)) {
        return;
      }
    } else if (!confirm(`Remove field "${field.name}"?`)) {
      return;
    }
    patch({ fields: data.fields.filter((f) => f.id !== id) });
  }

  function setFieldName(id: EntityFieldId, raw: string) {
    const cleaned = raw.trim();
    if (cleaned.length === 0) return;
    const newPath = asStatePath(`${data.namespace}.${statePathFromName(cleaned)}`);
    updateField(id, { name: cleaned, path: newPath });
  }

  function setFieldPath(id: EntityFieldId, raw: string) {
    if (!isStatePath(raw)) return;
    updateField(id, { path: asStatePath(raw) });
  }

  function setNamespace(raw: string) {
    const ns = statePathFromName(raw).split('.')[0] ?? data.namespace;
    if (ns === data.namespace) return;
    // Re-base every top-level field path to the new namespace. Fields without
    // a path (nested-only) are left as-is.
    const fields = data.fields.map((f) => {
      if (!f.path) return f;
      const segments = String(f.path).split('.');
      segments[0] = ns;
      return { ...f, path: asStatePath(segments.join('.')) };
    });
    patch({ namespace: ns, fields });
  }

  function setResource(raw: string) {
    if (raw.length === 0) {
      patch({ resourceId: undefined });
      return;
    }
    patch({ resourceId: asResourceId(raw) });
  }

  function findResource(id: ResourceId | undefined): Resource | undefined {
    if (!id) return undefined;
    return resources.find((r) => r.id === id);
  }
</script>

<div class="space-y-4 text-sm">
  <section class="space-y-2">
    <label class="block text-xs font-medium text-neutral-600">
      Namespace
      <input
        type="text"
        class="mono mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
        value={data.namespace}
        onblur={(e) => setNamespace((e.target as HTMLInputElement).value)}
      />
      <span class="mt-0.5 block text-[10px] text-neutral-500">
        Canonical identifier and first segment of every field's state path. The display name is
        derived automatically. Renaming re-bases existing fields.
      </span>
    </label>
    <label class="block text-xs font-medium text-neutral-600">
      Description
      <textarea
        rows="2"
        class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
        value={data.description ?? ''}
        onblur={(e) =>
          patch({ description: (e.target as HTMLTextAreaElement).value || undefined })}
      ></textarea>
    </label>
  </section>

  <section>
    <header class="mb-1 flex items-center gap-2">
      <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        Backed by resource
      </span>
      {#if data.resourceId}
        <button
          type="button"
          class="text-[10px] text-neutral-400 hover:text-red-600"
          onclick={() => setResource('')}
        >
          clear
        </button>
      {/if}
    </header>
    {#if resources.length === 0}
      <p class="text-[11px] text-neutral-400">
        No resources defined yet. Open the Resources tab to catalogue where this entity lives.
      </p>
    {:else}
      <select
        class="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
        value={data.resourceId ?? ''}
        onchange={(e) => setResource((e.target as HTMLSelectElement).value)}
      >
        <option value="">- No resource -</option>
        {#each resources as r (r.id)}
          <option value={r.id}>
            {r.name} ({resourceKindLabel(r.kind)} · {sensitivityLabel(r.sensitivity)})
          </option>
        {/each}
      </select>
      {@const linked = findResource(data.resourceId)}
      {#if linked}
        <p class="mt-1 text-[11px] text-neutral-500">
          {linked.provider}{linked.location ? ` · ${linked.location}` : ''}
          {#if linked.containsPii}<span class="ml-1 text-red-700">· PII</span>{/if}
        </p>
      {/if}
    {/if}
  </section>

  <section>
    <header class="mb-1 flex items-center justify-between">
      <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        Fields ({data.fields.length})
      </span>
      <button
        type="button"
        class="rounded-md border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
        onclick={addField}
      >
        + Field
      </button>
    </header>
    {#if data.fields.length === 0}
      <p class="text-[11px] text-neutral-500">No fields yet.</p>
    {:else}
      <ul class="space-y-2">
        {#each data.fields as field (field.id)}
          <li class="space-y-1">
            <div class="flex flex-wrap items-center gap-1.5 text-xs">
              <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                Path
              </span>
              <input
                type="text"
                class="mono flex-1 rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px]"
                value={field.path ?? ''}
                onblur={(e) => setFieldPath(field.id, (e.target as HTMLInputElement).value)}
                placeholder="namespace.field"
              />
            </div>
            <EntityFieldRow
              {field}
              onChange={(next) => updateField(field.id, next)}
              onRemove={() => removeField(field.id)}
            />
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
