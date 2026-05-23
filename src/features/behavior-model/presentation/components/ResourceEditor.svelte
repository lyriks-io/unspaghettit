<script lang="ts">
  import type { Resource } from '$features/behavior-model/domain/entities/Resource';
  import {
    accessModeLabel,
    ALL_ACCESS_MODES,
    ALL_AUTH_METHODS,
    ALL_RESOURCE_KINDS,
    ALL_RESOURCE_SCOPES,
    ALL_SENSITIVITIES,
    authMethodLabel,
    COMMON_COMPLIANCE_TAGS,
    resourceKindLabel,
    resourceScopeLabel,
    resourceTerminology,
    sensitivityLabel,
    type AccessMode,
    type AuthenticationMethod,
    type ResourceKind,
    type ResourceScope,
    type ResourceSensitivity
  } from '$features/behavior-model/domain/value-objects/Resource';

  type Props = {
    resource: Resource;
    onChange: (next: Resource) => void;
  };
  let { resource, onChange }: Props = $props();

  const terms = $derived(resourceTerminology(resource.kind));

  function patch(p: Partial<Resource>) {
    onChange({ ...resource, ...p });
  }

  function toggleTag(tag: string) {
    const tags = resource.complianceTags.includes(tag)
      ? resource.complianceTags.filter((t) => t !== tag)
      : [...resource.complianceTags, tag];
    patch({ complianceTags: tags });
  }

  let customTagDraft = $state('');
  function addCustomTag() {
    const t = customTagDraft.trim().toLowerCase().replace(/\s+/g, '_');
    if (t.length === 0) return;
    if (!resource.complianceTags.includes(t)) {
      patch({ complianceTags: [...resource.complianceTags, t] });
    }
    customTagDraft = '';
  }
</script>

<div class="space-y-4 text-xs">
  <!-- Identity -->
  <section class="grid grid-cols-1 gap-2">
    <label class="block">
      <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">Name</span>
      <input
        type="text"
        class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1"
        value={resource.name}
        onblur={(e) => patch({ name: (e.target as HTMLInputElement).value })}
      />
    </label>
    <label class="block">
      <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        Description
      </span>
      <textarea
        rows="2"
        class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1"
        value={resource.description ?? ''}
        onblur={(e) =>
          patch({ description: (e.target as HTMLTextAreaElement).value || undefined })}
      ></textarea>
    </label>
  </section>

  <!-- Kind / provider / scope / location -->
  <section class="grid grid-cols-2 gap-2">
    <label class="block">
      <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">Kind</span>
      <select
        class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1"
        value={resource.kind}
        onchange={(e) =>
          patch({ kind: (e.target as HTMLSelectElement).value as ResourceKind })}
      >
        {#each ALL_RESOURCE_KINDS as k}
          <option value={k}>{resourceKindLabel(k)}</option>
        {/each}
      </select>
    </label>
    <label class="block">
      <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">Provider</span>
      <input
        type="text"
        class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1"
        value={resource.provider}
        placeholder="PostgreSQL, AWS S3, Stripe…"
        onblur={(e) => patch({ provider: (e.target as HTMLInputElement).value })}
      />
    </label>
    <label class="block">
      <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">Scope</span>
      <select
        class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1"
        value={resource.scope}
        onchange={(e) =>
          patch({ scope: (e.target as HTMLSelectElement).value as ResourceScope })}
      >
        {#each ALL_RESOURCE_SCOPES as s}
          <option value={s}>{resourceScopeLabel(s)}</option>
        {/each}
      </select>
    </label>
    <label class="block">
      <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        Location / region
      </span>
      <input
        type="text"
        class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1"
        value={resource.location ?? ''}
        placeholder="eu-west-3 (Paris, FR)"
        onblur={(e) =>
          patch({ location: (e.target as HTMLInputElement).value || undefined })}
      />
    </label>
  </section>

  <!-- Structural identity (terminology adapts to kind) -->
  <section>
    <p class="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
      Structure
    </p>
    <div class="grid grid-cols-3 gap-2">
      <label class="block">
        <span class="text-[11px] text-neutral-600">{terms.database}</span>
        <input
          type="text"
          class="mono mt-1 w-full rounded-md border border-neutral-300 px-2 py-1"
          value={resource.database ?? ''}
          onblur={(e) =>
            patch({ database: (e.target as HTMLInputElement).value || undefined })}
        />
      </label>
      <label class="block">
        <span class="text-[11px] text-neutral-600">{terms.container}</span>
        <input
          type="text"
          class="mono mt-1 w-full rounded-md border border-neutral-300 px-2 py-1"
          value={resource.container ?? ''}
          onblur={(e) =>
            patch({ container: (e.target as HTMLInputElement).value || undefined })}
        />
      </label>
      <label class="block">
        <span class="text-[11px] text-neutral-600">{terms.field}</span>
        <input
          type="text"
          class="mono mt-1 w-full rounded-md border border-neutral-300 px-2 py-1"
          value={resource.field ?? ''}
          onblur={(e) => patch({ field: (e.target as HTMLInputElement).value || undefined })}
        />
      </label>
    </div>
  </section>

  <!-- Compliance + sensitivity -->
  <section class="grid grid-cols-2 gap-2">
    <label class="block">
      <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        Sensitivity
      </span>
      <select
        class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1"
        value={resource.sensitivity}
        onchange={(e) =>
          patch({
            sensitivity: (e.target as HTMLSelectElement).value as ResourceSensitivity
          })}
      >
        {#each ALL_SENSITIVITIES as s}
          <option value={s}>{sensitivityLabel(s)}</option>
        {/each}
      </select>
    </label>
    <label class="flex items-center gap-2 pt-5 text-neutral-700">
      <input
        type="checkbox"
        checked={resource.containsPii}
        onchange={(e) => patch({ containsPii: (e.target as HTMLInputElement).checked })}
      />
      Contains PII
    </label>
  </section>

  <section>
    <p class="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
      Compliance tags
    </p>
    <div class="flex flex-wrap gap-1">
      {#each COMMON_COMPLIANCE_TAGS as tag}
        {@const on = resource.complianceTags.includes(tag)}
        <button
          type="button"
          class="mono rounded-md border px-1.5 py-0.5 text-[10px] uppercase {on
            ? 'border-brand-400 bg-brand-50 text-brand-800'
            : 'border-neutral-300 text-neutral-500 hover:bg-neutral-50'}"
          onclick={() => toggleTag(tag)}
        >
          {tag}
        </button>
      {/each}
      {#each resource.complianceTags.filter((t) => !COMMON_COMPLIANCE_TAGS.includes(t)) as tag}
        <button
          type="button"
          class="mono rounded-md border border-brand-400 bg-brand-50 px-1.5 py-0.5 text-[10px] uppercase text-brand-800"
          onclick={() => toggleTag(tag)}
        >
          {tag} ✕
        </button>
      {/each}
    </div>
    <div class="mt-1 flex items-center gap-1">
      <input
        type="text"
        class="mono flex-1 rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px]"
        value={customTagDraft}
        oninput={(e) => (customTagDraft = (e.target as HTMLInputElement).value)}
        placeholder="Custom tag (e.g. ferpa)"
      />
      <button
        type="button"
        class="rounded-md border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50"
        onclick={addCustomTag}
      >
        Add
      </button>
    </div>
  </section>

  <!-- Operational -->
  <section class="grid grid-cols-2 gap-2">
    <label class="block">
      <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        Access mode
      </span>
      <select
        class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1"
        value={resource.accessMode}
        onchange={(e) =>
          patch({ accessMode: (e.target as HTMLSelectElement).value as AccessMode })}
      >
        {#each ALL_ACCESS_MODES as m}
          <option value={m}>{accessModeLabel(m)}</option>
        {/each}
      </select>
    </label>
    <label class="block">
      <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        Authentication
      </span>
      <select
        class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1"
        value={resource.authentication ?? 'none'}
        onchange={(e) =>
          patch({
            authentication: (e.target as HTMLSelectElement).value as AuthenticationMethod
          })}
      >
        {#each ALL_AUTH_METHODS as m}
          <option value={m}>{authMethodLabel(m)}</option>
        {/each}
      </select>
    </label>
    <label class="flex items-center gap-2 text-neutral-700">
      <input
        type="checkbox"
        checked={resource.encryptionAtRest ?? false}
        onchange={(e) =>
          patch({ encryptionAtRest: (e.target as HTMLInputElement).checked })}
      />
      Encryption at rest
    </label>
    <label class="flex items-center gap-2 text-neutral-700">
      <input
        type="checkbox"
        checked={resource.encryptionInTransit ?? false}
        onchange={(e) =>
          patch({ encryptionInTransit: (e.target as HTMLInputElement).checked })}
      />
      Encryption in transit
    </label>
    <label class="block">
      <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        Retention
      </span>
      <input
        type="text"
        class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1"
        value={resource.retention ?? ''}
        placeholder="30 days, 7 years, indefinite"
        onblur={(e) =>
          patch({ retention: (e.target as HTMLInputElement).value || undefined })}
      />
    </label>
    <label class="block">
      <span class="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        Owner
      </span>
      <input
        type="text"
        class="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1"
        value={resource.owner ?? ''}
        placeholder="team or person"
        onblur={(e) => patch({ owner: (e.target as HTMLInputElement).value || undefined })}
      />
    </label>
  </section>
</div>
