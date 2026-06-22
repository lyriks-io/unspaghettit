<script lang="ts">
  import type { EntityField } from '$features/behavior-model/domain/entities/Entity';
  import type { EntityFieldId } from '$features/behavior-model/domain/value-objects/ids';
  import { asEntityFieldId } from '$features/behavior-model/domain/value-objects/ids';
  import {
    ALL_DATA_FIELD_TYPES,
    dataFieldTypeLabel,
    type EntityFieldType
  } from '$features/behavior-model/domain/value-objects/EntityFieldType';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import Self from './EntityFieldRow.svelte';

  type Props = {
    field: EntityField;
    /** Visual indent depth (0 = root). */
    depth?: number;
    /**
     * Hides the path / required column. Useful for nested fields that don't
     * have their own state path or `array → items` placeholders.
     */
    hidePath?: boolean;
    onChange: (next: EntityField) => void;
    onRemove?: () => void;
  };
  let { field, depth = 0, hidePath = false, onChange, onRemove }: Props = $props();

  const indentPx = $derived(depth * 16);

  function patch(p: Partial<EntityField>) {
    onChange({ ...field, ...p });
  }

  function changeType(type: EntityFieldType) {
    // Reset container-specific extras when switching away from object/array.
    const next: EntityField = {
      ...field,
      type,
      fields: type === 'object' ? (field.fields ?? []) : undefined,
      items:
        type === 'array'
          ? (field.items ?? {
              id: asEntityFieldId(cryptoIdGenerator()),
              name: 'item',
              type: 'string'
            })
          : undefined,
      enumValues: type === 'enum' ? (field.enumValues ?? []) : undefined
    };
    onChange(next);
  }

  function addChild() {
    const child: EntityField = {
      id: asEntityFieldId(cryptoIdGenerator()),
      name: `field${(field.fields?.length ?? 0) + 1}`,
      type: 'string'
    };
    patch({ fields: [...(field.fields ?? []), child] });
  }

  function updateChild(id: EntityFieldId, next: EntityField) {
    patch({
      fields: (field.fields ?? []).map((c) => (c.id === id ? next : c))
    });
  }

  function removeChild(id: EntityFieldId) {
    patch({ fields: (field.fields ?? []).filter((c) => c.id !== id) });
  }

  function updateItems(next: EntityField) {
    patch({ items: next });
  }

  let enumDraft = $state('');
  $effect(() => {
    enumDraft = field.enumValues?.join(', ') ?? '';
  });
  function commitEnum() {
    const values = enumDraft
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    patch({ enumValues: values });
  }
</script>

<div class="space-y-1" style:padding-left="{indentPx}px">
  <div class="flex flex-wrap items-center gap-1.5 rounded-md border border-neutral-200 bg-white p-2 text-xs">
    <input
      type="text"
      class="rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px]"
      value={field.name}
      onblur={(e) => patch({ name: (e.target as HTMLInputElement).value })}
      placeholder="name"
    />
    <select
      class="rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px]"
      value={field.type}
      onchange={(e) => changeType((e.target as HTMLSelectElement).value as EntityFieldType)}
    >
      {#each ALL_DATA_FIELD_TYPES as t}
        <option value={t}>{dataFieldTypeLabel(t)}</option>
      {/each}
    </select>
    {#if !hidePath}
      <label class="flex items-center gap-1 text-neutral-600">
        <input
          type="checkbox"
          checked={field.required ?? false}
          onchange={(e) =>
            patch({ required: (e.target as HTMLInputElement).checked || undefined })}
        />
        required
      </label>
    {/if}
    {#if field.type === 'enum'}
      <input
        type="text"
        class="mono w-44 rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px]"
        value={enumDraft}
        oninput={(e) => (enumDraft = (e.target as HTMLInputElement).value)}
        onblur={commitEnum}
        placeholder="comma,separated,values"
      />
    {/if}
    <input
      type="text"
      class="flex-1 rounded-md border border-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-600"
      value={field.description ?? ''}
      placeholder="Description (optional)"
      onblur={(e) =>
        patch({ description: (e.target as HTMLInputElement).value || undefined })}
    />
    {#if onRemove}
      <button
        type="button"
        class="text-neutral-400 hover:text-red-600"
        onclick={onRemove}
        aria-label="Remove field"
      >
        ✕
      </button>
    {/if}
  </div>

  {#if field.type === 'object'}
    <div class="space-y-1 border-l-2 border-neutral-200 pl-3" style:margin-left="{indentPx + 4}px">
      {#each field.fields ?? [] as child (child.id)}
        <Self
          field={child}
          depth={0}
          hidePath
          onChange={(next) => updateChild(child.id, next)}
          onRemove={() => removeChild(child.id)}
        />
      {/each}
      <button
        type="button"
        class="rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] hover:bg-neutral-50"
        onclick={addChild}
      >
        + Field
      </button>
    </div>
  {:else if field.type === 'array' && field.items}
    {@const itemSchema = field.items}
    <div class="space-y-1 border-l-2 border-neutral-200 pl-3" style:margin-left="{indentPx + 4}px">
      <p class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        Items schema
      </p>
      <Self
        field={itemSchema}
        depth={0}
        hidePath
        onChange={(next) => updateItems(next)}
      />
    </div>
  {/if}
</div>
