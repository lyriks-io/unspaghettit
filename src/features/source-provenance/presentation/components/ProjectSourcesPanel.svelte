<script lang="ts">
  import { projectSourcesStore } from '$features/source-provenance/presentation/stores/projectSourcesStore.svelte';
  import { confirmDialog } from '$shared/presentation/dialogs/dialogStore.svelte';

  /**
   * The project's stored source documents (the "Project Sources" surface of
   * the Source Provenance feature). Paste a PRD / spec / notes here; it is
   * stored as an immutable text file in the project's snapshot folder and an
   * agent pulls it through the MCP (list_sources / get_source) to extract
   * behavior with full span provenance.
   */

  type Props = { search: string };
  let { search }: Props = $props();

  let pasteOpen = $state(false);
  let nameDraft = $state('');
  let contentDraft = $state('');
  let feedback = $state<string | null>(null);

  const filtered = $derived(
    search.trim().length === 0
      ? projectSourcesStore.sources
      : projectSourcesStore.sources.filter((s) =>
          s.name.toLowerCase().includes(search.toLowerCase())
        )
  );

  const formatBytes = (n: number): string =>
    n < 1024
      ? `${n} B`
      : n < 1048576
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / 1048576).toFixed(1)} MB`;

  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  };

  async function savePaste(): Promise<void> {
    feedback = null;
    const ok = await projectSourcesStore.paste(nameDraft, contentDraft);
    if (!ok) return;
    feedback = projectSourcesStore.lastPasteDeduped
      ? 'This exact text is already stored, the existing source is reused.'
      : 'Source stored in the project folder.';
    nameDraft = '';
    contentDraft = '';
    pasteOpen = false;
  }

  async function removeSource(id: string, name: string): Promise<void> {
    const ok = await confirmDialog({
      title: 'Remove this source?',
      message: `"${name}" will be deleted from the project folder. Spans recorded from it keep only their snippet text; this cannot be undone.`,
      confirmLabel: 'Remove source',
      cancelLabel: 'Cancel',
      tone: 'danger'
    });
    if (!ok) return;
    feedback = null;
    if (await projectSourcesStore.remove(id)) {
      feedback = 'Source removed from the project folder.';
    }
  }
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <p class="max-w-2xl text-xs leading-5 text-slate-500">
      Paste a document (PRD, spec, meeting notes) to store it with this project. An AI agent can
      then pull it through the MCP (<code class="rounded bg-slate-100 px-1 py-0.5 text-[11px]"
        >list_sources</code
      >
      / <code class="rounded bg-slate-100 px-1 py-0.5 text-[11px]">get_source</code>) and trace
      every extracted rule back to the exact lines it came from.
    </p>
    <button
      type="button"
      onclick={() => (pasteOpen = !pasteOpen)}
      class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800"
    >
      {pasteOpen ? 'Close' : 'Paste text'}
    </button>
  </div>

  {#if feedback}
    <p
      class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
    >
      {feedback}
    </p>
  {/if}
  {#if projectSourcesStore.error}
    <p class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
      {projectSourcesStore.error}
    </p>
  {/if}

  {#if pasteOpen}
    <div class="space-y-2 rounded-lg border border-hairline bg-white p-3">
      <label class="block text-xs font-medium text-slate-700">
        Name
        <input
          type="text"
          bind:value={nameDraft}
          placeholder="e.g. Checkout PRD v2"
          class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15"
        />
      </label>
      <label class="block text-xs font-medium text-slate-700">
        Text to analyze
        <textarea
          bind:value={contentDraft}
          rows="10"
          placeholder="Paste the document text here..."
          class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs leading-5 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15"
        ></textarea>
      </label>
      <div class="flex items-center justify-between gap-2">
        <p class="text-[11px] text-slate-400">
          Stored verbatim and immutable (1 MB cap). Identical text is deduplicated automatically.
        </p>
        <button
          type="button"
          onclick={savePaste}
          disabled={projectSourcesStore.saving ||
            nameDraft.trim().length === 0 ||
            contentDraft.length === 0}
          class="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white transition enabled:hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {projectSourcesStore.saving ? 'Storing...' : 'Store source'}
        </button>
      </div>
    </div>
  {/if}

  {#if projectSourcesStore.loading}
    <p class="rounded-lg border border-hairline bg-white p-6 text-center text-sm text-slate-500">
      Loading sources...
    </p>
  {:else if filtered.length === 0}
    <p
      class="rounded-lg border border-dashed border-hairline bg-white p-6 text-center text-sm text-slate-500"
    >
      {projectSourcesStore.sources.length === 0
        ? 'No sources stored for this project yet. Paste a document to get started.'
        : 'No sources match your search.'}
    </p>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-hairline bg-white">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-3 py-2">Name</th>
            <th class="px-3 py-2">Kind</th>
            <th class="px-3 py-2">Size</th>
            <th class="px-3 py-2">Hash</th>
            <th class="px-3 py-2">Stored</th>
            <th class="px-3 py-2"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as source (source.id)}
            <tr class="border-t border-slate-100">
              <td class="px-3 py-2 font-medium text-slate-950">{source.name}</td>
              <td class="px-3 py-2 text-slate-600">
                {source.kind === 'pasted' ? 'Pasted' : 'File'}
              </td>
              <td class="px-3 py-2 text-slate-600">{formatBytes(source.byteLength)}</td>
              <td class="px-3 py-2 font-mono text-xs text-slate-400">{source.contentHash}</td>
              <td class="px-3 py-2 text-xs text-slate-500">{formatDate(source.attachedAt)}</td>
              <td class="px-3 py-2 text-right">
                <button
                  type="button"
                  onclick={() => removeSource(source.id, source.name)}
                  class="rounded-md px-2 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
                >
                  Remove
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
