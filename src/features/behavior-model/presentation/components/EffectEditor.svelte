<script lang="ts">
  import {
    ALL_EFFECT_TYPES,
    effectTypeLabel,
    type Effect,
    type EffectType
  } from '$features/behavior-model/domain/value-objects/Effect';
  import {
    asStatePath,
    isStatePath,
    type StatePath
  } from '$features/behavior-model/domain/value-objects/StatePath';
  import { asEventName, isEventName } from '$features/behavior-model/domain/value-objects/EventName';
  import { asSurfaceId, type SurfaceId } from '$features/behavior-model/domain/value-objects/ids';
  import StatePathSelect from './StatePathSelect.svelte';
  import ConditionRightEditor from './ConditionRightEditor.svelte';

  type AvailableSurface = { readonly id: SurfaceId; readonly name: string };

  type Props = {
    effect: Effect;
    availablePaths?: readonly StatePath[];
    availableSurfaces?: readonly AvailableSurface[];
    onChange: (next: Effect) => void;
  };
  let {
    effect,
    availablePaths = [],
    availableSurfaces = [],
    onChange
  }: Props = $props();

  function changeType(type: EffectType) {
    const id = effect.id;
    switch (type) {
      case 'set_state':
        onChange({ id, type: 'set_state', path: asStatePath('state.path'), value: '' });
        break;
      case 'show_message':
        onChange({ id, type: 'show_message', message: '' });
        break;
      case 'emit_event':
        onChange({ id, type: 'emit_event', event: asEventName('event.name') });
        break;
      case 'block_action':
        onChange({ id, type: 'block_action', reason: '' });
        break;
      case 'allow_action':
        onChange({ id, type: 'allow_action' });
        break;
      case 'transition_surface':
        onChange({ id, type: 'transition_surface', target: asSurfaceId('') });
        break;
    }
  }

  function setStatePath(raw: string) {
    if (!isStatePath(raw) || effect.type !== 'set_state') return;
    onChange({ ...effect, path: asStatePath(raw) });
  }

  function setEventName(raw: string) {
    if (effect.type !== 'emit_event') return;
    if (!isEventName(raw)) return;
    onChange({ ...effect, event: asEventName(raw) });
  }
</script>

<div class="space-y-2">
  <div class="flex items-center gap-2">
    <select
      class="rounded-md border border-neutral-300 px-2 py-1 text-xs"
      value={effect.type}
      onchange={(e) => changeType((e.target as HTMLSelectElement).value as EffectType)}
    >
      {#each ALL_EFFECT_TYPES as t}
        <option value={t}>{effectTypeLabel(t)}</option>
      {/each}
    </select>
  </div>

  {#if effect.type === 'set_state'}
    <div class="flex items-start gap-2">
      <StatePathSelect
        value={effect.path}
        {availablePaths}
        onCommit={setStatePath}
      />
      <span class="mt-1.5 text-xs text-neutral-500">=</span>
      <ConditionRightEditor
        value={effect.value}
        {availablePaths}
        onChange={(value) => onChange({ ...effect, value })}
      />
    </div>
  {:else if effect.type === 'show_message'}
    <div class="flex items-center gap-2">
      <select
        class="rounded-md border border-neutral-300 px-2 py-1 text-xs"
        value={effect.tone ?? 'info'}
        onchange={(e) =>
          onChange({
            ...effect,
            tone: (e.target as HTMLSelectElement).value as 'info' | 'success' | 'warning' | 'error'
          })}
      >
        <option value="info">info</option>
        <option value="success">success</option>
        <option value="warning">warning</option>
        <option value="error">error</option>
      </select>
      <input
        type="text"
        class="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs"
        value={effect.message}
        onblur={(e) =>
          onChange({ ...effect, message: (e.target as HTMLInputElement).value })}
      />
    </div>
  {:else if effect.type === 'emit_event'}
    <input
      type="text"
      class="mono w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
      value={effect.event}
      onblur={(e) => setEventName((e.target as HTMLInputElement).value)}
      placeholder="domain.event_name"
    />
  {:else if effect.type === 'block_action'}
    <input
      type="text"
      class="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
      value={effect.reason}
      onblur={(e) => onChange({ ...effect, reason: (e.target as HTMLInputElement).value })}
      placeholder="Reason for blocking"
    />
  {:else if effect.type === 'transition_surface'}
    {#if availableSurfaces.length > 0}
      <select
        class="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
        value={String(effect.target ?? '')}
        onchange={(e) =>
          onChange({
            ...effect,
            target: asSurfaceId((e.target as HTMLSelectElement).value)
          })}
      >
        <option value="">- pick a surface -</option>
        {#each availableSurfaces as s (s.id)}
          <option value={s.id}>{s.name}</option>
        {/each}
      </select>
      <p class="text-xs text-neutral-500">
        Navigate to the chosen surface after this action succeeds.
      </p>
    {:else}
      <input
        type="text"
        class="mono w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
        value={effect.target}
        onblur={(e) => onChange({ ...effect, target: asSurfaceId((e.target as HTMLInputElement).value) })}
        placeholder="surface-id"
      />
      <p class="text-xs text-neutral-500">Paste a surface id from the same feature.</p>
    {/if}
  {:else if effect.type === 'allow_action'}
    <p class="text-xs text-neutral-500">No configuration. Marks the action as allowed.</p>
  {/if}
</div>
