<script lang="ts">
  import { tick } from 'svelte';

  type Props = {
    onSubmit: (name: string, description: string) => void | Promise<void>;
  };

  let { onSubmit }: Props = $props();

  let name = $state('');
  let description = $state('');
  let busy = $state(false);
  let nameInput = $state<HTMLInputElement | null>(null);

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
  class="grid gap-3 rounded-xl border border-cyan-100 bg-cyan-50/40 p-4 md:grid-cols-[1fr_1.4fr_auto] md:items-end"
>
  <div>
    <label for="feature-name" class="mb-1.5 block text-xs font-medium text-slate-700">
      Feature name
    </label>
    <input
      id="feature-name"
      bind:this={nameInput}
      type="text"
      bind:value={name}
      placeholder="e.g. Restaurant booking"
      class="h-10 w-full rounded-md border border-cyan-100 bg-white px-3 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
      required
    />
  </div>
  <div>
    <label for="feature-desc" class="mb-1.5 block text-xs font-medium text-slate-700">
      Description
    </label>
    <input
      id="feature-desc"
      type="text"
      bind:value={description}
      placeholder="What is this feature about?"
      class="h-10 w-full rounded-md border border-cyan-100 bg-white px-3 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
      required
    />
  </div>
  <button
    type="submit"
    class="h-10 rounded-md bg-brand-800 px-4 text-sm font-medium text-white hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-50"
    disabled={busy || name.trim().length === 0 || description.trim().length === 0}
  >
    {busy ? 'Creating...' : 'New feature'}
  </button>
</form>
