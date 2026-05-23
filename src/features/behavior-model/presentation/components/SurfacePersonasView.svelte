<script lang="ts">
  import type { Persona } from '$features/behavior-model/domain/entities/Persona';
  import type { Surface } from '$features/behavior-model/domain/entities/Surface';
  import { humanizeStatePath } from '$features/behavior-model/domain/value-objects/humanize';

  type Props = { surface: Surface; personas: readonly Persona[] };
  let { surface, personas }: Props = $props();

  type RelevantPersona = {
    readonly persona: Persona;
    readonly stateMatches: readonly { readonly path: string; readonly value: unknown }[];
    readonly parameterMatches: readonly {
      readonly parameterName: string;
      readonly value: unknown;
      readonly actionName: string;
    }[];
  };

  const relevant = $derived.by<RelevantPersona[]>(() => {
    const surfacePaths = new Set(surface.stateDefinitions.map((d) => String(d.path)));
    const surfaceParams = new Map<string, string[]>(); // paramName -> action names
    for (const cap of surface.actions) {
      for (const param of cap.parameters) {
        const list = surfaceParams.get(param.name) ?? [];
        list.push(cap.name);
        surfaceParams.set(param.name, list);
      }
    }

    const out: RelevantPersona[] = [];
    for (const persona of personas) {
      const stateMatches = persona.stateOverrides
        .filter((o) => surfacePaths.has(String(o.path)))
        .map((o) => ({ path: String(o.path), value: o.value as unknown }));
      const parameterMatches = persona.parameterOverrides
        .filter((o) => surfaceParams.has(o.parameterName))
        .flatMap((o) =>
          (surfaceParams.get(o.parameterName) ?? []).map((capName) => ({
            parameterName: o.parameterName,
            value: o.value as unknown,
            actionName: capName
          }))
        );
      if (stateMatches.length === 0 && parameterMatches.length === 0) continue;
      out.push({ persona, stateMatches, parameterMatches });
    }
    return out;
  });

  function formatValue(v: unknown): string {
    if (v === null || v === undefined) return '-';
    if (typeof v === 'string') return v.length === 0 ? '""' : v;
    return JSON.stringify(v);
  }
</script>

<div class="space-y-3 text-sm">
  {#if personas.length === 0}
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50/30 p-6 text-center">
      <p class="text-sm font-medium text-slate-700">No personas defined yet</p>
      <p class="mx-auto mt-1 max-w-md text-xs text-slate-500">
        Personas are simulator presets that override state and parameters for a specific user
        shape. Define them under the <strong>Personas</strong> rail on the right.
      </p>
    </div>
  {:else if relevant.length === 0}
    <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50/30 p-6 text-center">
      <p class="text-sm font-medium text-slate-700">No relevant personas here</p>
      <p class="mx-auto mt-1 max-w-md text-xs text-slate-500">
        None of the {personas.length} defined persona{personas.length === 1 ? '' : 's'} target
        state or parameters used on this surface. Personas appear here when their overrides
        touch a path or parameter declared above.
      </p>
    </div>
  {:else}
    <ul class="space-y-2">
      {#each relevant as entry (entry.persona.id)}
        <li class="rounded-md border border-slate-200 bg-white p-3 text-xs">
          <header class="font-medium text-slate-900">{entry.persona.name}</header>
          {#if entry.persona.description}
            <p class="mt-0.5 text-[11px] text-slate-500">{entry.persona.description}</p>
          {/if}

          {#if entry.stateMatches.length > 0}
            <div class="mt-2">
              <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Sets state on this surface
              </p>
              <ul class="ml-3 list-disc text-[11px] text-slate-700">
                {#each entry.stateMatches as match (match.path)}
                  <li class="leading-snug">
                    {humanizeStatePath(match.path)}
                    <span class="text-slate-400">→</span>
                    <span class="mono text-slate-900">{formatValue(match.value)}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if entry.parameterMatches.length > 0}
            <div class="mt-2">
              <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Pre-fills parameters
              </p>
              <ul class="ml-3 list-disc text-[11px] text-slate-700">
                {#each entry.parameterMatches as match, i (i)}
                  <li class="leading-snug">
                    <span class="mono">{match.parameterName}</span>
                    <span class="text-slate-400">→</span>
                    <span class="mono text-slate-900">{formatValue(match.value)}</span>
                    <span class="text-slate-500">on {match.actionName}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
