<script lang="ts">
  import {
    isExpression,
    type Expression
  } from '$features/behavior-model/domain/value-objects/Expression';
  import type { LeafRuleCondition } from '$features/behavior-model/domain/value-objects/RuleCondition';
  import {
    asStatePath,
    isStatePath,
    type StatePath
  } from '$features/behavior-model/domain/value-objects/StatePath';
  import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
  import StatePathSelect from './StatePathSelect.svelte';

  type RightValue = StateValue | Expression;
  type Mode = 'literal' | 'state' | 'expression';

  type Props = {
    value: LeafRuleCondition['right'];
    availablePaths: readonly StatePath[];
    onChange: (next: RightValue) => void;
  };
  let { value, availablePaths, onChange }: Props = $props();

  const mode = $derived<Mode>(
    isExpression(value) ? (value.kind === 'state' ? 'state' : 'expression') : 'literal'
  );

  const literalValue = $derived(
    value === undefined || isExpression(value)
      ? ''
      : typeof value === 'string'
        ? value
        : JSON.stringify(value)
  );

  const statePathValue = $derived(
    isExpression(value) && value.kind === 'state' ? String(value.path) : ''
  );

  const expressionPreview = $derived(
    isExpression(value) && value.kind !== 'state' ? JSON.stringify(value, null, 2) : ''
  );
  let expressionDraft = $state('');
  let expressionError = $state<string | null>(null);

  function parseLiteral(raw: string): StateValue {
    if (raw === 'true' || raw === 'false') return raw === 'true';
    if (raw === 'null') return null;
    if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
    return raw;
  }

  function setMode(next: Mode) {
    if (next === mode) return;
    if (next === 'literal') {
      onChange('');
      return;
    }
    if (next === 'state') {
      const first = availablePaths[0] ?? asStatePath('state.path');
      onChange({ kind: 'state', path: first });
      return;
    }
    expressionDraft = expressionPreview || JSON.stringify({ kind: 'literal', value: '' }, null, 2);
    expressionError = null;
    onChange({ kind: 'literal', value: '' });
  }

  function updateLiteral(raw: string) {
    onChange(parseLiteral(raw));
  }

  function updateState(raw: string) {
    if (!isStatePath(raw)) return;
    onChange({ kind: 'state', path: asStatePath(raw) });
  }

  function updateExpression(raw: string) {
    expressionDraft = raw;
  }

  function commitExpression() {
    expressionError = null;
    try {
      const parsed = JSON.parse(expressionDraft || expressionPreview || 'null');
      if (!isExpression(parsed)) {
        expressionError = 'Expression JSON needs a valid kind field.';
        return;
      }
      onChange(parsed);
    } catch {
      expressionError = 'Expression JSON is not valid.';
    }
  }

  // Templates for each Expression kind so the user can pick one from a
  // dropdown and get a ready-to-fill skeleton in the JSON textarea, instead
  // of memorising the AST shape from the operations doc.
  type KindTemplate = {
    readonly kind: string;
    readonly label: string;
    readonly hint: string;
    readonly template: object;
  };
  const KIND_TEMPLATES: readonly KindTemplate[] = [
    {
      kind: 'literal',
      label: 'Literal',
      hint: 'A constant value.',
      template: { kind: 'literal', value: '' }
    },
    {
      kind: 'state',
      label: 'Read state path',
      hint: 'Reads another state slot.',
      template: { kind: 'state', path: 'state.path' }
    },
    {
      kind: 'param',
      label: 'Read parameter',
      hint: 'Reads an action parameter.',
      template: { kind: 'param', name: 'paramName' }
    },
    {
      kind: 'add',
      label: '+ Add (a + b)',
      hint: 'Sum of two expressions.',
      template: { kind: 'add', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 1 } }
    },
    {
      kind: 'sub',
      label: '− Subtract',
      hint: 'Difference of two expressions.',
      template: { kind: 'sub', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 1 } }
    },
    {
      kind: 'mul',
      label: '× Multiply',
      hint: 'Product of two expressions.',
      template: { kind: 'mul', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 1 } }
    },
    {
      kind: 'div',
      label: '÷ Divide',
      hint: 'Quotient. Division by 0 returns undefined.',
      template: { kind: 'div', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 1 } }
    },
    {
      kind: 'min',
      label: 'min(a, b)',
      hint: 'Smaller of two values.',
      template: { kind: 'min', left: { kind: 'literal', value: 0 }, right: { kind: 'literal', value: 1 } }
    },
    {
      kind: 'max',
      label: 'max(a, b)',
      hint: 'Larger of two values.',
      template: { kind: 'max', left: { kind: 'literal', value: 0 }, right: { kind: 'literal', value: 1 } }
    },
    {
      kind: 'neg',
      label: 'neg(x), negate number',
      hint: 'Multiplies a number by -1.',
      template: { kind: 'neg', operand: { kind: 'state', path: 'state.path' } }
    },
    {
      kind: 'not',
      label: 'not(x), flip boolean',
      hint: 'Inverts true/false. Use for toggle effects.',
      template: { kind: 'not', operand: { kind: 'state', path: 'state.path' } }
    },
    {
      kind: 'sum',
      label: 'Σ sum(array)',
      hint: 'Sum of a numeric array.',
      template: { kind: 'sum', operand: { kind: 'state', path: 'shares' } }
    },
    {
      kind: 'count',
      label: '# count(array)',
      hint: 'Length of an array.',
      template: { kind: 'count', operand: { kind: 'state', path: 'items' } }
    },
    {
      kind: 'sum_pluck',
      label: 'Σ sum_pluck, sum a field across objects',
      hint: 'Σ of `field` plucked from each object in an array (e.g. share.amount).',
      template: { kind: 'sum_pluck', operand: { kind: 'state', path: 'shares' }, field: 'amount' }
    },
    {
      kind: 'count_where',
      label: '# count_where, count by field value',
      hint: 'Count of objects whose `field` equals a value (e.g. status=enrolled).',
      template: {
        kind: 'count_where',
        operand: { kind: 'state', path: 'applications' },
        field: 'status',
        equals: { kind: 'literal', value: 'enrolled' }
      }
    },
    {
      kind: 'switch',
      label: '⎇ switch, case / branch',
      hint: 'First case whose condition holds wins; falls through to default. Replaces multiple rules.',
      template: {
        kind: 'switch',
        cases: [
          {
            when: {
              left: 'enrolledCount',
              operator: 'lower_than',
              right: { kind: 'state', path: 'capacity' }
            },
            then: { kind: 'literal', value: 'enrolled' }
          }
        ],
        default: { kind: 'literal', value: 'waitlisted' }
      }
    }
  ];

  let kindPickerOpen = $state(false);
  function applyTemplate(t: KindTemplate) {
    expressionDraft = JSON.stringify(t.template, null, 2);
    expressionError = null;
    kindPickerOpen = false;
    onChange(t.template as Expression);
  }
</script>

<div class="flex flex-wrap items-start gap-1">
  <div
    class="mt-0.5 flex rounded-md border border-slate-200 bg-white p-0.5 text-[10px]"
    role="tablist"
    aria-label="Right side type"
  >
    <button
      type="button"
      class="rounded px-1.5 py-0.5 {mode === 'literal'
        ? 'bg-slate-900 text-white'
        : 'text-slate-600 hover:text-slate-900'}"
      onclick={() => setMode('literal')}
      aria-pressed={mode === 'literal'}
    >
      Literal
    </button>
    <button
      type="button"
      class="rounded px-1.5 py-0.5 {mode === 'state'
        ? 'bg-slate-900 text-white'
        : 'text-slate-600 hover:text-slate-900'}"
      onclick={() => setMode('state')}
      aria-pressed={mode === 'state'}
    >
      State
    </button>
    <button
      type="button"
      class="rounded px-1.5 py-0.5 {mode === 'expression'
        ? 'bg-slate-900 text-white'
        : 'text-slate-600 hover:text-slate-900'}"
      onclick={() => setMode('expression')}
      aria-pressed={mode === 'expression'}
    >
      JSON
    </button>
  </div>

  {#if mode === 'state'}
    <StatePathSelect
      value={statePathValue}
      {availablePaths}
      onCommit={updateState}
      width="min-w-44"
    />
  {:else if mode === 'expression'}
    <div class="flex min-w-64 flex-col gap-0.5">
      <div class="relative">
        <button
          type="button"
          class="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
          onclick={() => (kindPickerOpen = !kindPickerOpen)}
        >
          + Insert kind…
        </button>
        {#if kindPickerOpen}
          <div
            class="absolute left-0 z-10 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-slate-300 bg-white p-1 text-[11px] shadow-lg"
          >
            <p class="px-2 py-1 text-[10px] text-slate-500">
              Picks a template; you can edit values after.
            </p>
            {#each KIND_TEMPLATES as t (t.kind)}
              <button
                type="button"
                class="block w-full rounded px-2 py-1 text-left hover:bg-violet-50"
                onclick={() => applyTemplate(t)}
              >
                <div class="font-medium text-slate-800">{t.label}</div>
                <div class="text-[10px] text-slate-500">{t.hint}</div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <textarea
        class="mono mt-0.5 min-h-20 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
        value={expressionDraft || expressionPreview}
        oninput={(e) => updateExpression((e.target as HTMLTextAreaElement).value)}
        onblur={commitExpression}
        title="Advanced expression JSON"
      ></textarea>
      {#if expressionError}
        <span class="text-[10px] text-red-600">{expressionError}</span>
      {:else}
        <span class="text-[10px] text-slate-500">
          Edit the AST directly, or use "Insert kind…" to pick a template for any Expression
          shape (sum, count_where, switch, etc.).
        </span>
      {/if}
    </div>
  {:else}
    <input
      type="text"
      class="mono mt-0.5 w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
      value={literalValue}
      onchange={(e) => updateLiteral((e.target as HTMLInputElement).value)}
      placeholder="value"
    />
  {/if}
</div>
