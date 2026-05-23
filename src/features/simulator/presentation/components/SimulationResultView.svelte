<script lang="ts">
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import type { SimulationResult } from '$features/simulator/domain/SimulationResult';
  import { humanizeStatePath } from '$features/behavior-model/domain/value-objects/humanize';
  import { operatorLabel } from '$features/behavior-model/domain/value-objects/Operator';
  import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
  import { editorStore } from '$features/behavior-model/presentation/stores/editorStore.svelte';
  import { readPath } from '$features/behavior-model/domain/value-objects/StatePath';

  type Props = { feature: Feature; result: SimulationResult; surface: Surface };
  let { feature, result, surface }: Props = $props();

  const transitionTarget = $derived(
    result.transition
      ? feature.surfaces.find((s) => s.id === result.transition) ?? null
      : null
  );

  function goToTransition() {
    if (!transitionTarget) return;
    editorStore.selectSurface(transitionTarget.id);
  }

  type DiffRow = {
    readonly label: string;
    readonly path: string;
    readonly before: StateValue | undefined;
    readonly after: StateValue | undefined;
  };

  const stateDiff = $derived.by<DiffRow[]>(() => {
    const rows: DiffRow[] = [];
    for (const def of surface.stateDefinitions) {
      const before = readPath(result.previousState, def.path);
      const after = readPath(result.nextState, def.path);
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      rows.push({
        label: humanizeStatePath(def.path),
        path: def.path,
        before,
        after
      });
    }
    return rows;
  });

  const formatDisplay = (v: StateValue | undefined): string => {
    if (v === undefined) return '-';
    if (typeof v === 'string') return v.length === 0 ? '""' : v;
    return JSON.stringify(v);
  };

  type EvaluatedDescriptor = {
    readonly title: string;
    readonly condition: string;
  };

  // Compose a friendly title and a one-line humanized condition for every rule
  // that was evaluated in this run, so the result panel never displays raw paths.
  const ruleDescriptors = $derived.by(() => {
    const map = new Map<string, EvaluatedDescriptor>();
    const formatValue = (v: StateValue | undefined): string =>
      v === undefined ? '' : typeof v === 'string' ? `"${v}"` : JSON.stringify(v);
    type RuleLike = {
      condition?: unknown;
      category: string;
      description?: string;
    };
    // Composite or unconditional rules render a short marker instead of
    // the leaf comparison string. This keeps the trace readable without
    // pretending it understands the structured form.
    const describe = (origin: string, owner: string, rule: RuleLike): EvaluatedDescriptor => {
      let condition = '(unconditional)';
      const c = rule.condition as
        | { left: string; operator: string; right?: StateValue }
        | { kind: 'all' | 'any' | 'not' }
        | undefined;
      if (c && typeof c === 'object') {
        if ('kind' in c && (c.kind === 'all' || c.kind === 'any' || c.kind === 'not')) {
          condition = `(${c.kind} condition)`;
        } else if ('left' in c) {
          const right = formatValue(c.right);
          condition = `${humanizeStatePath(c.left)} ${operatorLabel(c.operator as never)}${right ? ` ${right}` : ''}`;
        }
      }
      return {
        title: rule.description ?? `${owner} · ${rule.category}`,
        condition: `[${origin}] ${condition}`
      };
    };
    for (const r of surface.rules) map.set(r.id, describe('surface', surface.name, r));
    for (const c of surface.actions) {
      for (const r of c.rules) map.set(r.id, describe('action', c.name, r));
    }
    return map;
  });

  // Call-status chip colors. Two outcomes only: success or blocked.
  const statusChipClasses = $derived(
    result.status === 'success'
      ? 'bg-emerald-100 text-emerald-800'
      : 'bg-amber-100 text-amber-800'
  );

  // Outcome severity is the worst tone produced during the run, independent of
  // the call status. A successful call can still emit an error message via a
  // show_message effect. That's not the same as the call failing.
  type Severity = 'ok' | 'info' | 'success' | 'warning' | 'error';
  const severityRank: Record<Severity, number> = {
    ok: 0,
    success: 1,
    info: 2,
    warning: 3,
    error: 4
  };
  const outcomeSeverity = $derived.by<Severity>(() => {
    let worst: Severity = 'ok';
    for (const m of result.messages) {
      const t = (m.tone as Severity) ?? 'info';
      if (severityRank[t] > severityRank[worst]) worst = t;
    }
    if (result.invariantViolations.length > 0 && severityRank.error > severityRank[worst]) {
      worst = 'error';
    }
    return worst;
  });

  const outcomeChipClasses = $derived(
    outcomeSeverity === 'error'
      ? 'bg-red-100 text-red-800'
      : outcomeSeverity === 'warning'
        ? 'bg-amber-100 text-amber-800'
        : outcomeSeverity === 'info'
          ? 'bg-sky-100 text-sky-800'
          : outcomeSeverity === 'success'
            ? 'bg-emerald-100 text-emerald-800'
            : 'bg-neutral-100 text-neutral-700'
  );

  // When the call status and outcome are in the same severity zone, the run
  // tells a single coherent story. Colour the whole block. When they
  // disagree (e.g. call=success but an error message was emitted) stay
  // neutral and let the per-message colours speak.
  type Zone = 'good' | 'warn' | 'mixed';
  const zone = $derived.by<Zone>(() => {
    const s = result.status;
    const o = outcomeSeverity;
    if (s === 'success' && (o === 'ok' || o === 'success' || o === 'info')) return 'good';
    if (s === 'blocked' && (o === 'ok' || o === 'warning' || o === 'error')) return 'warn';
    return 'mixed';
  });

  const blockClasses = $derived(
    zone === 'good'
      ? 'border-emerald-200 bg-emerald-50'
      : zone === 'warn'
        ? 'border-amber-200 bg-amber-50'
        : 'border-neutral-200 bg-white'
  );

  const messageClasses = (tone: string): string => {
    switch (tone) {
      case 'error':
        return 'bg-red-50 border-red-200 text-red-900';
      case 'warning':
        return 'bg-amber-50 border-amber-200 text-amber-900';
      case 'success':
        return 'bg-emerald-50 border-emerald-200 text-emerald-900';
      case 'info':
        return 'bg-sky-50 border-sky-200 text-sky-900';
      default:
        return 'bg-neutral-50 border-neutral-200 text-neutral-800';
    }
  };
</script>

<div class="space-y-2 rounded-md border p-3 text-xs text-neutral-800 {blockClasses}">
  <div class="flex flex-wrap items-center gap-1.5">
    <span class="text-[10px] uppercase tracking-wide text-neutral-500">Call</span>
    <span class="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase {statusChipClasses}">
      {result.status}
    </span>
    <span class="ml-2 text-[10px] uppercase tracking-wide text-neutral-500">Outcome</span>
    <span class="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase {outcomeChipClasses}">
      {outcomeSeverity}
    </span>
    {#if transitionTarget}
      <button
        type="button"
        class="ml-auto rounded-md border border-brand-300 bg-white px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-50"
        onclick={goToTransition}
        title={`Open ${transitionTarget.name}`}
      >
        Go to {transitionTarget.name} ?
      </button>
    {:else if result.transition}
      <span class="ml-auto text-[10px] text-neutral-500">? {result.transition}</span>
    {/if}
  </div>

  {#if result.parameterErrors.length > 0}
    <div>
      <p class="mb-1 font-medium text-red-700">Parameter errors</p>
      <ul class="ml-3 list-disc">
        {#each result.parameterErrors as error}
          <li><span class="mono">{error.parameterName}</span> {error.reason}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if result.messages.length > 0}
    <div>
      <p class="mb-1 font-medium text-neutral-700">Messages</p>
      <ul class="space-y-1">
        {#each result.messages as message}
          <li class="rounded-md border px-2 py-1 {messageClasses(message.tone)}">
            <span class="text-[10px] font-semibold uppercase tracking-wide opacity-70">
              [{message.tone}]
            </span>
            <span class="ml-1">{message.text}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if result.invariantViolations.length > 0}
    <div>
      <p class="mb-1 font-medium text-red-700">Invariant violations</p>
      <ul class="space-y-1">
        {#each result.invariantViolations as violation}
          <li class="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-900">
            <span class="font-medium">{violation.invariantName}:</span>
            {violation.message}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if result.evaluatedRules.length > 0}
    <details>
      <summary class="cursor-pointer font-medium text-neutral-700">
        Rules evaluated ({result.evaluatedRules.length})
      </summary>
      <ul class="ml-3 mt-1 space-y-1.5">
        {#each result.evaluatedRules as rule}
          {@const desc = ruleDescriptors.get(rule.ruleId)}
          <li class="leading-snug">
            <div class="flex items-center gap-2">
              <span class="font-medium text-neutral-900">{desc?.title ?? rule.category}</span>
              <span
                class="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase {rule.conditionHeld
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-neutral-100 text-neutral-500'}"
              >
                {rule.conditionHeld ? 'matched' : 'no match'}
              </span>
            </div>
            {#if desc}
              <div class="text-[11px] text-neutral-500">{desc.condition}</div>
            {/if}
          </li>
        {/each}
      </ul>
    </details>
  {/if}

  {#if result.appliedEffects.length > 0}
    <details>
      <summary class="cursor-pointer font-medium text-neutral-700">
        Effects applied ({result.appliedEffects.length})
      </summary>
      <ul class="ml-3 mt-1 list-disc">
        {#each result.appliedEffects as effect}
          <li><span class="mono">[{effect.type}]</span> {effect.summary}</li>
        {/each}
      </ul>
    </details>
  {/if}

  {#if result.emittedEvents.length > 0}
    <div>
      <p class="mb-1 font-medium text-neutral-700">Events emitted</p>
      <ul class="flex flex-wrap gap-1">
        {#each result.emittedEvents as event}
          <li class="mono rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-800">
            {event}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <details>
    <summary class="cursor-pointer font-medium text-neutral-700">
      State changes ({stateDiff.length})
    </summary>
    {#if stateDiff.length === 0}
      <p class="mt-1 text-[11px] text-neutral-500">No state was changed.</p>
    {:else}
      <ul class="mt-1 space-y-1">
        {#each stateDiff as row}
          <li class="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px]">
            <div class="font-medium text-neutral-900" title={row.path}>{row.label}</div>
            <div class="flex items-center gap-2 text-neutral-700">
              <span class="mono text-neutral-500">{formatDisplay(row.before)}</span>
              <span class="text-neutral-400" aria-hidden="true">→</span>
              <span class="mono font-medium text-neutral-900">{formatDisplay(row.after)}</span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </details>

  {#if result.cascadedHandlers && result.cascadedHandlers.length > 0}
    <details open>
      <summary class="cursor-pointer font-medium text-violet-800">
        Cascaded handlers ({result.cascadedHandlers.length})
      </summary>
      <p class="mt-1 text-[11px] text-neutral-500">
        Other actions that fired automatically when this action emitted events. Indentation =
        cascade depth; a child's events trigger its own handlers next.
      </p>
      <ul class="mt-2 space-y-2">
        {#each result.cascadedHandlers as cascade}
          {@const status = cascade.result.status}
          <li
            class="rounded-md border bg-white p-2 {status === 'success'
              ? 'border-emerald-200'
              : 'border-amber-200 bg-amber-50/40'}"
            style="margin-left: {(cascade.depth - 1) * 12}px"
          >
            <div class="flex items-center gap-2 text-[11px]">
              <span
                class="rounded px-1 py-0.5 text-[10px] font-semibold {status === 'success'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'}"
              >
                {status}
              </span>
              <span class="mono text-violet-700">↳ triggered by "{cascade.triggeredBy}"</span>
              <span class="text-neutral-500">· depth {cascade.depth}</span>
            </div>
            {#if cascade.result.invariantViolations.length > 0}
              <ul class="mt-1 space-y-0.5">
                {#each cascade.result.invariantViolations as v}
                  <li class="text-[10px] text-amber-800">
                    ! invariant <span class="mono">{v.invariantName}</span>, {v.message}
                  </li>
                {/each}
              </ul>
            {/if}
            {#if cascade.result.emittedEvents.length > 0}
              <p class="mt-1 text-[10px] text-neutral-600">
                Emitted: {cascade.result.emittedEvents.join(', ')}
              </p>
            {/if}
            {#if cascade.result.cascadedHandlers && cascade.result.cascadedHandlers.length > 0}
              <p class="mt-1 text-[10px] text-violet-700">
                ↳ chained into {cascade.result.cascadedHandlers.length} more handler(s) (see below)
              </p>
            {/if}
          </li>
          {#if cascade.result.cascadedHandlers}
            {#each cascade.result.cascadedHandlers as nested}
              <li
                class="rounded-md border bg-white p-2 {nested.result.status === 'success'
                  ? 'border-emerald-200'
                  : 'border-amber-200 bg-amber-50/40'}"
                style="margin-left: {(nested.depth - 1) * 12}px"
              >
                <div class="flex items-center gap-2 text-[11px]">
                  <span
                    class="rounded px-1 py-0.5 text-[10px] font-semibold {nested.result.status === 'success'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'}"
                  >
                    {nested.result.status}
                  </span>
                  <span class="mono text-violet-700">↳ "{nested.triggeredBy}"</span>
                  <span class="text-neutral-500">· depth {nested.depth}</span>
                </div>
              </li>
            {/each}
          {/if}
        {/each}
      </ul>
    </details>
  {/if}
</div>
