<script lang="ts">
  import type { Parameter } from '$features/behavior-model/domain/entities/Parameter';
  import {
    VALIDATION_GROUPS,
    validationAppliesTo,
    validationRequiresValue,
    validationTypeLabel,
    type ParameterValidation,
    type ParameterValidationType
  } from '$features/behavior-model/domain/value-objects/ParameterValidation';

  type Props = {
    parameter: Parameter;
    onChange: (patch: Partial<Parameter>) => void;
  };
  let { parameter, onChange }: Props = $props();

  // Hide validations that don't apply to this parameter type. `any` validators
  // would fit any type. None right now, but the structure is ready.
  function appliesToParam(t: ParameterValidationType): boolean {
    const applies = validationAppliesTo(t);
    if (applies === 'any') return true;
    if (parameter.type === 'string' || parameter.type === 'enum') return applies === 'string';
    if (parameter.type === 'number') return applies === 'number';
    return false;
  }

  // Group filtered types by category for the <optgroup>s in the dropdown.
  const groupedApplicable = $derived.by<
    ReadonlyArray<{ readonly label: string; readonly types: readonly ParameterValidationType[] }>
  >(() =>
    VALIDATION_GROUPS.map((g) => ({
      label: g.label,
      types: g.types.filter(appliesToParam)
    })).filter((g) => g.types.length > 0)
  );

  const applicableTypes = $derived<readonly ParameterValidationType[]>(
    groupedApplicable.flatMap((g) => g.types)
  );

  const validations = $derived(parameter.validations ?? []);

  function defaultFor(type: ParameterValidationType): ParameterValidation {
    switch (type) {
      case 'min_length':
      case 'max_length':
      case 'length':
        return { type, value: 1 };
      case 'min':
      case 'max':
        return { type, value: 0 };
      case 'multiple_of':
        return { type, value: 1 };
      case 'pattern':
        return { type, value: '^.+$' };
      case 'starts_with':
      case 'ends_with':
      case 'contains':
        return { type, value: '' };
      default:
        return { type } as ParameterValidation;
    }
  }

  function add() {
    const next = applicableTypes[0];
    if (!next) return;
    onChange({ validations: [...validations, defaultFor(next)] });
  }

  function update(index: number, replacement: ParameterValidation) {
    onChange({
      validations: validations.map((v, i) => (i === index ? replacement : v))
    });
  }

  function remove(index: number) {
    onChange({ validations: validations.filter((_, i) => i !== index) });
  }

  function changeType(index: number, newType: ParameterValidationType) {
    update(index, defaultFor(newType));
  }

  function changeValue(index: number, raw: string) {
    const current = validations[index];
    if (!current) return;
    const requires = validationRequiresValue(current.type);
    if (requires === 'number') {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        update(index, { ...(current as ParameterValidation), value: n } as ParameterValidation);
      }
      return;
    }
    if (requires === 'string') {
      update(index, { ...(current as ParameterValidation), value: raw } as ParameterValidation);
    }
  }

  function changeMessage(index: number, raw: string) {
    const current = validations[index];
    if (!current) return;
    update(index, { ...current, message: raw.length === 0 ? undefined : raw });
  }
</script>

<div class="space-y-2">
  <button
    type="button"
    class="rounded-md border border-neutral-300 px-2 py-1 text-[11px] hover:bg-neutral-50"
    onclick={add}
    disabled={applicableTypes.length === 0}
  >
    + Validation
  </button>

  {#if applicableTypes.length === 0}
    <p class="text-[11px] text-neutral-500">No built-in validations available for this type.</p>
  {/if}

  {#if validations.length === 0}
    <p class="rounded-md border border-dashed border-neutral-300 p-2 text-center text-[11px] text-neutral-500">
      No validations. Only the type and "required" check apply.
    </p>
  {:else}
    <ul class="space-y-1">
      {#each validations as validation, i (i)}
        {@const requires = validationRequiresValue(validation.type)}
        <li class="space-y-1 rounded-md border border-neutral-200 bg-neutral-50 p-2">
          <div class="flex flex-wrap items-center gap-1.5">
            <select
              class="rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px]"
              value={validation.type}
              onchange={(e) =>
                changeType(i, (e.target as HTMLSelectElement).value as ParameterValidationType)}
            >
              {#each groupedApplicable as group (group.label)}
                <optgroup label={group.label}>
                  {#each group.types as t (t)}
                    <option value={t}>{validationTypeLabel(t)}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
            {#if requires === 'number' && 'value' in validation}
              <input
                type="number"
                class="w-20 rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px]"
                value={String(validation.value)}
                onchange={(e) => changeValue(i, (e.target as HTMLInputElement).value)}
              />
            {:else if requires === 'string' && 'value' in validation}
              <input
                type="text"
                class="mono flex-1 rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px]"
                value={String(validation.value)}
                placeholder="^[A-Z]+$"
                onchange={(e) => changeValue(i, (e.target as HTMLInputElement).value)}
              />
            {/if}
            <button
              type="button"
              class="ml-auto text-neutral-400 hover:text-red-600"
              onclick={() => remove(i)}
              aria-label="Remove validation"
            >
              ✕
            </button>
          </div>
          <input
            type="text"
            class="w-full rounded-md border border-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-600"
            value={validation.message ?? ''}
            placeholder="Custom error message (optional)"
            onblur={(e) => changeMessage(i, (e.target as HTMLInputElement).value)}
          />
        </li>
      {/each}
    </ul>
  {/if}
</div>
