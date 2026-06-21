<script lang="ts">
  import type { Resource } from '$features/behavior-model/domain/entities/Resource';
  import type { EventDefinition } from '$features/behavior-model/domain/entities/EventDefinition';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import type { Action } from '$features/behavior-model/domain/entities/Action';
  import type { Rule } from '$features/behavior-model/domain/entities/Rule';
  import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
  import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
  import type { EffectId, InvariantId, RuleId } from '$features/behavior-model/domain/value-objects/ids';
  import {
    asStatePath,
    isStatePath
  } from '$features/behavior-model/domain/value-objects/StatePath';
  import { asEventName, isEventName } from '$features/behavior-model/domain/value-objects/EventName';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import {
    addEffectToCapability,
    addInvariantToCapability,
    addRuleToCapability,
    removeEffectFromCapability,
    removeInvariantFromCapability,
    removeRuleFromCapability,
    updateAction,
    updateRuleOnCapability
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import {
    newEffect,
    newInvariant,
    newRule
  } from '$features/behavior-model/presentation/view-models/factories';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import RuleEditor from './RuleEditor.svelte';
  import EffectEditor from './EffectEditor.svelte';
  import InvariantEditor from './InvariantEditor.svelte';
  import ParametersEditor from './ParametersEditor.svelte';
  import ScenariosEditor from './ScenariosEditor.svelte';
  import StatePathSelect from './StatePathSelect.svelte';
  import { useFeatureQueueContext } from '$features/behavior-model/presentation/context/featureQueueContext';

  type AvailableSurface = { readonly id: Surface['id']; readonly name: string };

  type Props = {
    surface: Surface;
    action: Action;
    resources: readonly Resource[];
    expanded: boolean;
    onToggle: () => void;
    onRemove: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    availableSurfaces?: readonly AvailableSurface[];
    availableEvents?: readonly EventDefinition[];
  };
  let {
    surface,
    action,
    resources,
    expanded,
    onToggle,
    onRemove,
    onMoveUp,
    onMoveDown,
    availableSurfaces = [],
    availableEvents = []
  }: Props = $props();

  const availablePaths = $derived(surface.stateDefinitions.map((d) => d.path));
  const blockedEffects = $derived(action.onBlockedEffects ?? []);
  let requiredStateDraft = $state('');
  let emittedEventDraft = $state('');

  async function patchMeta(patch: Partial<Action>) {
    await featureStore.mutate((current) =>
      updateAction(current, surface.id, action.id, patch)
    );
  }

  async function addRule() {
    const fallbackPath = surface.stateDefinitions[0]?.path ?? 'state.path';
    const rule = newRule(cryptoIdGenerator, {
      category: 'business',
      left: fallbackPath as string,
      operator: 'equals'
    });
    await featureStore.mutate((current) =>
      addRuleToCapability(current, surface.id, action.id, rule)
    );
  }

  async function updateRule(rule: Rule) {
    await featureStore.mutate((current) =>
      updateRuleOnCapability(current, surface.id, action.id, rule)
    );
  }

  async function removeRule(id: RuleId) {
    await featureStore.mutate((current) =>
      removeRuleFromCapability(current, surface.id, action.id, id)
    );
  }

  async function addEffect() {
    const effect = newEffect(cryptoIdGenerator, 'set_state');
    await featureStore.mutate((current) =>
      addEffectToCapability(current, surface.id, action.id, effect)
    );
  }

  async function updateEffect(next: Effect) {
    await featureStore.mutate((current) =>
      updateAction(current, surface.id, action.id, {
        effects: action.effects.map((e) => (e.id === next.id ? next : e))
      })
    );
  }

  async function removeEffect(id: EffectId) {
    await featureStore.mutate((current) =>
      removeEffectFromCapability(current, surface.id, action.id, id)
    );
  }

  // -- onBlockedEffects: action-level fallbacks that fire when blocked --
  async function addOnBlockedEffect() {
    const effect = newEffect(cryptoIdGenerator, 'transition_surface');
    const current = action.onBlockedEffects ?? [];
    await featureStore.mutate((feature) =>
      updateAction(feature, surface.id, action.id, {
        onBlockedEffects: [...current, effect]
      })
    );
  }

  async function updateOnBlockedEffect(next: Effect) {
    const current = action.onBlockedEffects ?? [];
    await featureStore.mutate((feature) =>
      updateAction(feature, surface.id, action.id, {
        onBlockedEffects: current.map((e) => (e.id === next.id ? next : e))
      })
    );
  }

  async function removeOnBlockedEffect(id: EffectId) {
    const current = action.onBlockedEffects ?? [];
    await featureStore.mutate((feature) =>
      updateAction(feature, surface.id, action.id, {
        onBlockedEffects: current.filter((e) => e.id !== id)
      })
    );
  }

  async function addInvariant() {
    const fallbackPath = surface.stateDefinitions[0]?.path ?? 'state.path';
    const invariant = newInvariant(cryptoIdGenerator, {
      name: 'New invariant',
      left: fallbackPath as string
    });
    await featureStore.mutate((current) =>
      addInvariantToCapability(current, surface.id, action.id, invariant)
    );
  }

  async function updateInvariant(next: Invariant) {
    await featureStore.mutate((current) =>
      updateAction(current, surface.id, action.id, {
        invariants: action.invariants.map((i) => (i.id === next.id ? next : i))
      })
    );
  }

  async function removeInvariant(id: InvariantId) {
    await featureStore.mutate((current) =>
      removeInvariantFromCapability(current, surface.id, action.id, id)
    );
  }

  async function addRequiredState(raw: string) {
    if (!isStatePath(raw) || action.requiredStates.includes(raw as never)) return;
    await patchMeta({ requiredStates: [...action.requiredStates, asStatePath(raw)] });
    requiredStateDraft = '';
  }

  async function removeRequiredState(raw: string) {
    await patchMeta({ requiredStates: action.requiredStates.filter((path) => path !== raw) });
  }

  async function addEmittedEvent(raw: string) {
    if (!isEventName(raw) || action.emittedEvents.includes(raw as never)) return;
    await patchMeta({ emittedEvents: [...action.emittedEvents, asEventName(raw)] });
    emittedEventDraft = '';
  }

  async function removeEmittedEvent(raw: string) {
    await patchMeta({ emittedEvents: action.emittedEvents.filter((event) => event !== raw) });
  }

  // Queue toggle is only shown when the feature is part of a project; that's
  // the only context where "implement next" is meaningful. Computed reactively
  // so the button label flips immediately after an enqueue without a refresh.
  const queueCtx = useFeatureQueueContext();
  const featureId = $derived(featureStore.feature?.id);
  const isQueued = $derived(
    featureId ? queueCtx.isActionQueued(featureId, action.id) : false
  );

  async function toggleQueue() {
    if (!featureId) return;
    if (isQueued) {
      const itemId = queueCtx.findQueueItemIdForAction(featureId, action.id);
      if (itemId) await queueCtx.dequeueByItemId(itemId);
    } else {
      await queueCtx.enqueueAction(featureId, action.id);
    }
  }

  // Evolution: a proposed improvement rendered as a dashed placeholder. It's a
  // real action (queueable above) but not committed behavior. "Accept" clears
  // the marker so it joins the spec proper and re-enters maturity/gap analysis.
  const proposal = $derived(action.evolution);
  const articleClass = $derived(
    [
      'group rounded-md border bg-white',
      proposal ? 'border-dashed' : '',
      expanded
        ? 'border-brand-300 ring-1 ring-brand-200'
        : proposal
          ? 'border-violet-300 bg-violet-50/40'
          : 'border-slate-200'
    ]
      .filter(Boolean)
      .join(' ')
  );

  async function acceptEvolution() {
    // Clearing the marker promotes the proposal to a committed action.
    await patchMeta({ evolution: undefined });
  }
</script>

<article
  class={articleClass}
  data-focus-target={`action:${action.id}`}
>
  <header class="flex items-center justify-between gap-2 px-3 py-2">
    <button
      type="button"
      class="flex flex-1 items-center gap-2 text-left"
      onclick={onToggle}
    >
      <span class="text-xs text-slate-400" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      <span class="font-medium {proposal ? 'text-violet-900' : 'text-slate-900'}">{action.name}</span>
      {#if proposal}
        <span
          class="rounded-full border border-violet-300 bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700"
          title="Proposed improvement — not committed behavior yet"
        >
          Evolution{proposal.category ? ` · ${proposal.category}` : ''}
        </span>
      {:else}
        <span class="text-xs text-slate-500">
          {action.rules.length} rule(s) · {action.effects.length} effect(s)
        </span>
      {/if}
    </button>
    <div class="flex items-center gap-0.5">
      {#if proposal}
        <button
          type="button"
          class="rounded px-1.5 text-xs font-medium text-violet-700 opacity-0 transition hover:bg-violet-100 group-hover:opacity-100"
          onclick={acceptEvolution}
          aria-label="Accept this proposal as a committed action"
          title="Accept: clear the proposal marker and make this a committed action"
        >
          ✓ accept
        </button>
      {/if}
      {#if queueCtx.isInProject && featureId}
        <button
          type="button"
          class="rounded px-1.5 text-xs transition-opacity {isQueued
            ? 'text-brand-700 opacity-100'
            : 'text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100'}"
          onclick={toggleQueue}
          aria-label={isQueued ? 'Remove action from queue' : 'Add action to implementation queue'}
          title={isQueued ? 'In queue (click to remove)' : 'Add to implementation queue'}
        >
          {isQueued ? '✓ queued' : '+ queue'}
        </button>
      {/if}
      {#if onMoveUp !== undefined || onMoveDown !== undefined}
        <button
          type="button"
          class="rounded px-1 text-xs text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 group-hover:disabled:opacity-30"
          onclick={onMoveUp}
          disabled={onMoveUp === undefined}
          aria-label="Move action up"
          title="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          class="rounded px-1 text-xs text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 group-hover:disabled:opacity-30"
          onclick={onMoveDown}
          disabled={onMoveDown === undefined}
          aria-label="Move action down"
          title="Move down"
        >
          ↓
        </button>
      {/if}
      <button
        type="button"
        class="rounded px-1 text-xs text-slate-400 hover:text-red-600"
        onclick={onRemove}
        aria-label="Remove action"
        title="Remove"
      >
        x
      </button>
    </div>
  </header>

  {#if proposal}
    <p class="-mt-1 px-3 pb-2 text-xs leading-snug text-violet-700/90">
      <span aria-hidden="true">💡</span>
      {proposal.rationale}{proposal.source ? ` — ${proposal.source}` : ''}
    </p>
  {/if}

  {#if expanded}
    <div class="space-y-4 border-t border-slate-200 p-3">
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label class="block text-xs font-medium text-slate-600">
          Name
          <input
            type="text"
            value={action.name}
            onblur={(e) => patchMeta({ name: (e.target as HTMLInputElement).value })}
            class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label class="block text-xs font-medium text-slate-600">
          Intent
          <input
            type="text"
            value={action.intent}
            placeholder="What does this action do?"
            onblur={(e) => patchMeta({ intent: (e.target as HTMLInputElement).value })}
            class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
      </div>

      <section class="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-2 text-xs">
            <input
              type="checkbox"
              class="mt-0.5"
              checked={action.bypassInvariants === true}
              onchange={(e) =>
                patchMeta({
                  bypassInvariants: (e.target as HTMLInputElement).checked || undefined
                })}
            />
            <span>
              <span class="font-semibold text-slate-800">Bypass invariants</span>
              <span class="block text-[11px] text-slate-500">
                Skip every invariant check when this action runs. Use ONLY for repair / admin
                actions that exist to fix a broken invariant (a regular action staying inside the
                invariants is safer).
              </span>
              {#if action.bypassInvariants === true}
                <span class="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                  ! Repair action, invariants OFF
                </span>
              {/if}
            </span>
          </label>

          <label class="block rounded-md border border-slate-200 bg-white p-2 text-xs">
            <span class="font-semibold text-slate-800">Triggered by event</span>
            <span class="block text-[11px] text-slate-500">
              When another action emits this event anywhere in the project, this action runs
              automatically as a cascade. Leave empty for a normal user-triggered action.
            </span>
            {#if availableEvents.length > 0}
              <select
                class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                value={action.triggeredByEvent ?? ''}
                onchange={(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  patchMeta({
                    triggeredByEvent: v.length > 0 ? asEventName(v) : undefined
                  });
                }}
              >
                <option value="">, Not a handler ,</option>
                {#each availableEvents as event (event.id)}
                  <option value={event.name}>{event.name}</option>
                {/each}
              </select>
            {:else}
              <input
                type="text"
                class="mono mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                value={action.triggeredByEvent ?? ''}
                onblur={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  patchMeta({
                    triggeredByEvent: v.length > 0 && isEventName(v) ? asEventName(v) : undefined
                  });
                }}
                placeholder="domain.event_name"
              />
            {/if}
            {#if action.triggeredByEvent}
              <span class="mt-1 inline-block rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                ? Handler, fires on "{action.triggeredByEvent}"
              </span>
            {/if}
          </label>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <h3 class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Required states ({action.requiredStates.length})
          </h3>
          <div class="flex items-start gap-2">
            <StatePathSelect
              value={requiredStateDraft}
              {availablePaths}
              onCommit={(raw) => (requiredStateDraft = raw)}
              width="min-w-0 flex-1"
            />
            <button
              type="button"
              class="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-white disabled:opacity-50"
              onclick={() => addRequiredState(requiredStateDraft)}
              disabled={!isStatePath(requiredStateDraft)}
            >
              Add
            </button>
          </div>
          {#if action.requiredStates.length > 0}
            <div class="mt-2 flex flex-wrap gap-1">
              {#each action.requiredStates as path (path)}
                <span class="inline-flex max-w-full items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] text-slate-700">
                  <span class="mono truncate">{path}</span>
                  <button
                    type="button"
                    class="text-slate-400 hover:text-red-600"
                    aria-label={`Remove required state ${path}`}
                    onclick={() => removeRequiredState(path)}
                  >
                    x
                  </button>
                </span>
              {/each}
            </div>
          {/if}
        </div>

        <div>
          <h3 class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Emitted events ({action.emittedEvents.length})
          </h3>
          <div class="flex items-center gap-2">
            {#if availableEvents.length > 0}
              <select
                class="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                bind:value={emittedEventDraft}
              >
                <option value="">Pick an event</option>
                {#each availableEvents as event (event.id)}
                  <option value={event.name}>{event.name}</option>
                {/each}
              </select>
            {:else}
              <input
                type="text"
                class="mono min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                bind:value={emittedEventDraft}
                placeholder="audit.started"
              />
            {/if}
            <button
              type="button"
              class="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-white disabled:opacity-50"
              onclick={() => addEmittedEvent(emittedEventDraft)}
              disabled={!isEventName(emittedEventDraft)}
            >
              Add
            </button>
          </div>
          {#if action.emittedEvents.length > 0}
            <div class="mt-2 flex flex-wrap gap-1">
              {#each action.emittedEvents as event (event)}
                <span class="inline-flex max-w-full items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] text-slate-700">
                  <span class="mono truncate">{event}</span>
                  <button
                    type="button"
                    class="text-slate-400 hover:text-red-600"
                    aria-label={`Remove emitted event ${event}`}
                    onclick={() => removeEmittedEvent(event)}
                  >
                    x
                  </button>
                </span>
              {/each}
            </div>
          {/if}
        </div>
        </div>
      </section>

      <section data-tour="action-parameters-section">
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Parameters
        </h3>
        <ParametersEditor {surface} {action} {resources} />
      </section>

      <section>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Scenarios ({action.scenarios?.length ?? 0})
        </h3>
        <ScenariosEditor {surface} {action} />
      </section>

      <section data-tour="action-rules-section">
        <h3 class="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Rules ({action.rules.length})</span>
          <button
            type="button"
            class="rounded-md border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
            onclick={addRule}
          >
            + Rule
          </button>
        </h3>
        {#if action.rules.length === 0}
          <p class="rounded-md border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
            No rules yet.
          </p>
        {:else}
          <div class="space-y-2">
            {#each action.rules as rule (rule.id)}
              <RuleEditor
                {rule}
                {availablePaths}
                availableParameters={action.parameters}
                onChange={(next) => updateRule(next)}
                onRemove={() => removeRule(rule.id)}
              />
            {/each}
          </div>
        {/if}
      </section>

      <section data-tour="action-effects-section">
        <h3 class="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>On success effects ({action.effects.length})</span>
          <button
            type="button"
            class="rounded-md border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
            onclick={addEffect}
          >
            + Effect
          </button>
        </h3>
        <p class="mb-2 text-xs text-slate-500">
          Applied when no rule blocks the action.
        </p>
        {#if action.effects.length === 0}
          <p class="rounded-md border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
            No on-success effects yet.
          </p>
        {:else}
          <ul class="space-y-2">
            {#each action.effects as effect (effect.id)}
              <li class="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-3">
                <div class="flex-1">
                  <EffectEditor
                    {effect}
                    {availablePaths}
                    {availableSurfaces}
                    onChange={(next) => updateEffect(next)}
                  />
                </div>
                <button
                  type="button"
                  class="text-xs text-slate-400 hover:text-red-600"
                  onclick={() => removeEffect(effect.id)}
                  aria-label="Remove effect"
                >
                  ?
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section>
        <h3 class="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>On block effects ({blockedEffects.length})</span>
          <button
            type="button"
            class="rounded-md border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
            onclick={addOnBlockedEffect}
          >
            + Effect
          </button>
        </h3>
        <p class="mb-2 text-xs text-slate-500">
          Applied when at least one rule blocks the action. Useful for graceful redirects (e.g.
          "? Sign in") or audit events on every reject. State mutations stay suppressed; events,
          messages, and transitions still fire.
        </p>
        {#if blockedEffects.length === 0}
          <p class="rounded-md border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
            No on-block effects yet.
          </p>
        {:else}
          <ul class="space-y-2">
            {#each blockedEffects as effect (effect.id)}
              <li class="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/50 p-3">
                <div class="flex-1">
                  <EffectEditor
                    {effect}
                    {availablePaths}
                    {availableSurfaces}
                    onChange={(next) => updateOnBlockedEffect(next)}
                  />
                </div>
                <button
                  type="button"
                  class="text-xs text-slate-400 hover:text-red-600"
                  onclick={() => removeOnBlockedEffect(effect.id)}
                  aria-label="Remove on-block effect"
                >
                  ?
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section>
        <h3 class="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Invariants ({action.invariants.length})</span>
          <button
            type="button"
            class="rounded-md border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
            onclick={addInvariant}
          >
            + Invariant
          </button>
        </h3>
        {#if action.invariants.length === 0}
          <p class="rounded-md border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
            No invariants yet.
          </p>
        {:else}
          <div class="space-y-2">
            {#each action.invariants as invariant (invariant.id)}
              <InvariantEditor
                {invariant}
                {availablePaths}
                onChange={(next) => updateInvariant(next)}
                onRemove={() => removeInvariant(invariant.id)}
              />
            {/each}
          </div>
        {/if}
      </section>
    </div>
  {/if}
</article>
