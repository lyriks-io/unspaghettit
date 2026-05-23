<script lang="ts">
  import type {
    EventDefinition,
    EventPayloadField
  } from '$features/behavior-model/domain/entities/EventDefinition';
  import type { Feature } from '$features/behavior-model/domain/entities/Feature';
  import { asEventDefinitionId } from '$features/behavior-model/domain/value-objects/ids';
  import {
    asEventName,
    isEventName
  } from '$features/behavior-model/domain/value-objects/EventName';
  import type { StateType } from '$features/behavior-model/domain/value-objects/StateValue';
  import {
    addEvent,
    removeEvent,
    updateEvent
  } from '$features/behavior-model/domain/services/FeatureTransforms';
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import {
    buildEventCatalog,
    groupEventCatalog,
    type EventEmissionSource
  } from '$features/behavior-model/domain/services/EventCatalog';
  import { editorStore } from '$features/behavior-model/presentation/stores/editorStore.svelte';
  import { cryptoIdGenerator } from '$shared/domain/IdGenerator';
  import { projectContextStore } from '$features/projects/presentation/stores/projectContextStore.svelte';
  import { inheritedEvents } from '$features/projects/domain/services/InheritedFromProject';

  type Props = { feature: Feature };
  let { feature }: Props = $props();

  const groups = $derived(groupEventCatalog(buildEventCatalog(feature)));
  const total = $derived(groups.reduce((acc, g) => acc + g.events.length, 0));
  const registered = $derived(feature.events ?? []);
  const inherited = $derived(inheritedEvents(projectContextStore.siblings));
  const payloadTypes: readonly StateType[] = [
    'string',
    'number',
    'boolean',
    'enum',
    'object',
    'array'
  ];

  let newEventName = $state('');
  let createError = $state<string | null>(null);

  async function addRegisteredEvent() {
    createError = null;
    const name = newEventName.trim();
    if (!isEventName(name)) {
      createError = 'Use lowercase dot-separated form like audit.started.';
      return;
    }
    if (registered.some((event) => event.name === name)) {
      createError = `Event "${name}" already exists.`;
      return;
    }
    const event: EventDefinition = {
      id: asEventDefinitionId(cryptoIdGenerator()),
      name: asEventName(name)
    };
    await featureStore.mutate((current) => addEvent(current, event));
    newEventName = '';
  }

  async function updateRegisteredEvent(event: EventDefinition, patch: Partial<EventDefinition>) {
    await featureStore.mutate((current) => updateEvent(current, { ...event, ...patch }));
  }

  async function removeRegisteredEvent(event: EventDefinition) {
    if (!confirm(`Delete event "${event.name}"? Existing emit_event effects keep their names.`))
      return;
    await featureStore.mutate((current) => removeEvent(current, event.id));
  }

  function renameEvent(event: EventDefinition, raw: string) {
    const name = raw.trim();
    if (!isEventName(name)) return;
    updateRegisteredEvent(event, { name: asEventName(name) });
  }

  function addPayloadField(event: EventDefinition) {
    const fields = event.payloadSchema ?? [];
    const field: EventPayloadField = {
      name: `field${fields.length + 1}`,
      type: 'string',
      required: true
    };
    updateRegisteredEvent(event, { payloadSchema: [...fields, field] });
  }

  function updatePayloadField(
    event: EventDefinition,
    index: number,
    patch: Partial<EventPayloadField>
  ) {
    const fields = event.payloadSchema ?? [];
    const next = fields.map((field, i) => (i === index ? { ...field, ...patch } : field));
    updateRegisteredEvent(event, { payloadSchema: next });
  }

  function removePayloadField(event: EventDefinition, index: number) {
    const next = (event.payloadSchema ?? []).filter((_, i) => i !== index);
    updateRegisteredEvent(event, { payloadSchema: next.length > 0 ? next : undefined });
  }

  function originLabel(o: EventEmissionSource['origin']): string {
    switch (o) {
      case 'action_default':
        return 'declared';
      case 'action_effect':
        return 'action effect';
      case 'action_rule_effect':
        return 'action rule';
      case 'surface_rule_effect':
        return 'surface rule';
    }
  }

  function navigate(source: EventEmissionSource) {
    editorStore.navigateTo({
      surfaceId: source.surfaceId,
      actionId: source.actionId,
      surfacePanelTab: 'actions'
    });
  }
</script>

<div class="space-y-6">
  <header class="space-y-1">
    <h2 class="text-lg font-semibold text-neutral-900">Events</h2>
    <p class="text-sm text-neutral-600">
      Every event the feature emits. Across action declarations, default effects, and
      rule effects. Grouped by namespace so the product's signal vocabulary is discoverable in
      one place. {total} unique event{total === 1 ? '' : 's'} in {groups.length} group{groups.length === 1 ? '' : 's'}.
    </p>
  </header>

  <section class="space-y-3 rounded-md border border-neutral-200 bg-white p-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 class="text-sm font-semibold text-neutral-900">Registry</h3>
        <p class="text-xs text-neutral-500">
          First-class events and payload schemas. Emissions below can reference these names.
        </p>
      </div>
      <div class="flex items-start gap-2">
        <label class="block">
          <span class="sr-only">New event name</span>
          <input
            type="text"
            class="mono w-52 rounded-md border border-neutral-300 px-2 py-1 text-xs"
            bind:value={newEventName}
            placeholder="audit.started"
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addRegisteredEvent();
              }
            }}
          />
          {#if createError}
            <span class="mt-1 block text-[11px] text-red-600">{createError}</span>
          {/if}
        </label>
        <button
          type="button"
          class="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
          onclick={addRegisteredEvent}
        >
          Add event
        </button>
      </div>
    </header>

    {#if registered.length === 0}
      <p class="rounded-md border border-dashed border-neutral-300 p-3 text-center text-xs text-neutral-500">
        No registered events yet.
      </p>
    {:else}
      <ul class="space-y-2">
        {#each registered as event (event.id)}
          <li class="space-y-2 rounded-md border border-neutral-200 bg-neutral-50/40 p-3">
            <div class="flex flex-wrap items-start gap-2">
              <label class="block flex-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                Name
                <input
                  type="text"
                  class="mono mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                  value={event.name}
                  onblur={(e) => renameEvent(event, (e.target as HTMLInputElement).value)}
                />
              </label>
              <label class="block flex-[2] text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                Description
                <input
                  type="text"
                  class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                  value={event.description ?? ''}
                  onblur={(e) =>
                    updateRegisteredEvent(event, {
                      description: (e.target as HTMLInputElement).value || undefined
                    })}
                />
              </label>
              <button
                type="button"
                class="mt-5 text-xs text-neutral-400 hover:text-red-600"
                onclick={() => removeRegisteredEvent(event)}
              >
                Remove
              </button>
            </div>
            <section>
              <header class="mb-1 flex items-center justify-between">
                <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                  Payload ({event.payloadSchema?.length ?? 0})
                </span>
                <button
                  type="button"
                  class="rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] hover:bg-white"
                  onclick={() => addPayloadField(event)}
                >
                  + Field
                </button>
              </header>
              {#if (event.payloadSchema?.length ?? 0) === 0}
                <p class="text-[11px] text-neutral-500">No payload fields.</p>
              {:else}
                <ul class="space-y-1">
                  {#each event.payloadSchema ?? [] as field, i (i)}
                    <li class="flex flex-wrap items-center gap-1.5">
                      <input
                        type="text"
                        class="mono rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px]"
                        value={field.name}
                        onblur={(e) =>
                          updatePayloadField(event, i, {
                            name: (e.target as HTMLInputElement).value || field.name
                          })}
                      />
                      <select
                        class="rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px]"
                        value={field.type}
                        onchange={(e) =>
                          updatePayloadField(event, i, {
                            type: (e.target as HTMLSelectElement).value as StateType
                          })}
                      >
                        {#each payloadTypes as type}
                          <option value={type}>{type}</option>
                        {/each}
                      </select>
                      <label class="inline-flex items-center gap-1 text-[11px] text-neutral-600">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onchange={(e) =>
                            updatePayloadField(event, i, {
                              required: (e.target as HTMLInputElement).checked
                            })}
                        />
                        required
                      </label>
                      <input
                        type="text"
                        class="min-w-40 flex-1 rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px]"
                        value={field.description ?? ''}
                        placeholder="Description"
                        onblur={(e) =>
                          updatePayloadField(event, i, {
                            description: (e.target as HTMLInputElement).value || undefined
                          })}
                      />
                      <button
                        type="button"
                        class="text-xs text-neutral-400 hover:text-red-600"
                        onclick={() => removePayloadField(event, i)}
                        aria-label="Remove payload field"
                      >
                        x
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </section>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if total === 0}
    <p class="rounded-md border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">
      No events emitted yet. Add an <span class="mono">emit_event</span> effect to an action or rule.
    </p>
  {:else}
    <div class="space-y-5">
      {#each groups as group (group.group)}
        <section>
          <header class="mb-1 flex items-baseline gap-2">
            <h3 class="text-sm font-semibold text-neutral-900">{group.group}</h3>
            <span class="text-[11px] text-neutral-500">
              {group.events.length} event{group.events.length === 1 ? '' : 's'}
            </span>
          </header>
          <ul class="divide-y divide-neutral-200 rounded-md border border-neutral-200 bg-white">
            {#each group.events as event (event.name)}
              <li class="px-3 py-2">
                <header class="flex flex-wrap items-baseline gap-2">
                  <code class="mono text-sm font-medium text-neutral-900">{event.name}</code>
                  <span class="text-[11px] text-neutral-500">
                    {event.emissions.length} emission{event.emissions.length === 1 ? '' : 's'}
                  </span>
                </header>
                <ul class="mt-1.5 space-y-0.5">
                  {#each event.emissions as emission, i (i)}
                    <li class="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-600">
                      <button
                        type="button"
                        class="rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
                        onclick={() => navigate(emission)}
                        title="Open in feature editor"
                      >
                        {emission.surfaceName}{emission.actionName
                          ? ` · ${emission.actionName}`
                          : ''}
                      </button>
                      <span class="rounded bg-neutral-100 px-1 text-[10px] uppercase tracking-wide text-neutral-500">
                        {originLabel(emission.origin)}
                      </span>
                      {#if emission.description}
                        <span class="text-neutral-500">- {emission.description}</span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
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
        {#each inherited as row (row.value.name)}
          {@const event = row.value}
          <li class="flex flex-wrap items-baseline gap-2 px-4 py-2 text-xs">
            <span class="mono font-medium text-slate-800">{event.name}</span>
            {#if event.payloadSchema && event.payloadSchema.length > 0}
              <span class="text-[11px] text-neutral-500">
                · {event.payloadSchema.length} payload field{event.payloadSchema.length === 1 ? '' : 's'}
              </span>
            {/if}
            <span class="ml-auto rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700" title="Source feature">
              {row.sourceFeatureName}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
