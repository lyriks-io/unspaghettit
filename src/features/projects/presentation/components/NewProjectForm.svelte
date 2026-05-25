<script lang="ts">
  import { tick } from 'svelte';
  import { tourStore } from '$features/tutorial/presentation/stores/tourStore.svelte';
  import { evaluateTourSubmitGuard } from '$features/tutorial/domain/services/SubmitGuard';

  type Props = {
    onSubmit: (name: string, description: string) => void | Promise<void>;
  };

  let { onSubmit }: Props = $props();

  let name = $state('');
  let description = $state('');
  let busy = $state(false);
  let nameInput = $state<HTMLInputElement | null>(null);

  // Tutor-mode submit guard. The verdict is a pure function of the
  // tour's current step and the typed name; the form just feeds it into
  // its disabled binding so the rest of the form code stays
  // tour-agnostic.
  const tourGuard = $derived(
    evaluateTourSubmitGuard(tourStore.currentStep, 'new-project', name)
  );

  $effect(() => {
    if (!nameInput) return;
    void tick().then(() => nameInput?.focus());
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    if (name.trim().length === 0) return;
    if (description.trim().length === 0) return;
    busy = true;
    try {
      await onSubmit(name.trim(), description.trim());
      name = '';
      description = '';
    } finally {
      busy = false;
    }
  }
</script>

<form
  onsubmit={handleSubmit}
  data-tour="new-project-form"
  class="grid gap-3 rounded-xl border border-cyan-100 bg-cyan-50/40 p-4 md:grid-cols-[1fr_1.6fr_auto] md:items-end"
>
  <div>
    <label for="proj-name" class="mb-1.5 block text-xs font-medium text-slate-700">
      Project name
    </label>
    <input
      id="proj-name"
      bind:this={nameInput}
      type="text"
      bind:value={name}
      placeholder="e.g. Acme Platform"
      class="h-10 w-full rounded-md border border-cyan-100 bg-white px-3 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
      required
    />
  </div>
  <div>
    <label for="proj-desc" class="mb-1.5 block text-xs font-medium text-slate-700">
      Description
    </label>
    <input
      id="proj-desc"
      data-tour="new-project-description"
      type="text"
      bind:value={description}
      placeholder="What product or initiative does this group?"
      class="h-10 w-full rounded-md border border-cyan-100 bg-white px-3 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
      required
    />
  </div>
  <button
    type="submit"
    class="h-10 rounded-md bg-brand-800 px-4 text-sm font-medium text-white hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-50"
    title={tourGuard.blocked
      ? `Tutorial: name must be exactly "${tourGuard.requiredValue}"`
      : undefined}
    disabled={busy || name.trim().length === 0 || description.trim().length === 0 || tourGuard.blocked}
  >
    {busy ? 'Creating...' : 'New project'}
  </button>
</form>
