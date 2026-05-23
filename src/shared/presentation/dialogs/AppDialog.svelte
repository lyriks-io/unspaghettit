<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { dialogStore, type DialogTone } from './dialogStore.svelte';

  const current = $derived(dialogStore.current);

  // Local checkbox state for checklist dialogs. Rebuilds whenever a new
  // checklist request lands.
  let selected = $state<Set<string>>(new Set());

  // Single-field input state for prompt dialogs (e.g. passphrase entry).
  // Reset on every new request so the previous value can't leak across
  // unrelated prompts.
  let inputValue = $state('');
  let promptError = $state<string | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (current?.kind === 'checklist') {
      selected = new Set(current.opts.items.filter((i) => i.defaultChecked).map((i) => i.id));
    } else {
      selected = new Set();
    }
    if (current?.kind === 'prompt') {
      inputValue = current.opts.defaultValue ?? '';
      promptError = null;
      // Defer focus so the input has rendered before we steal focus.
      queueMicrotask(() => inputEl?.focus());
    } else {
      inputValue = '';
      promptError = null;
    }
  });

  function toggleItem(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function selectAll() {
    if (current?.kind !== 'checklist') return;
    selected = new Set(current.opts.items.map((i) => i.id));
  }

  function selectNone() {
    selected = new Set();
  }

  function cancel() {
    if (current?.kind === 'prompt') {
      dialogStore.resolvePrompt(null);
    } else {
      dialogStore.resolveCurrent(false);
    }
  }

  function confirm() {
    if (current?.kind === 'checklist') {
      dialogStore.resolveCurrent(true, Array.from(selected));
    } else if (current?.kind === 'prompt') {
      const value = inputValue;
      const error = current.opts.validate ? current.opts.validate(value) : null;
      if (error) {
        promptError = error;
        return;
      }
      dialogStore.resolvePrompt(value);
    } else {
      dialogStore.resolveCurrent(true);
    }
  }

  function handleKey(e: KeyboardEvent) {
    if (!current) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && current.kind !== 'checklist') {
      // Enter is too easy to hit accidentally with a multi-select; only
      // bind it for plain confirm/alert/prompt.
      e.preventDefault();
      confirm();
    }
  }

  const toneStyles: Record<
    DialogTone,
    { icon: string; iconBg: string; iconColor: string; confirmBtn: string; check: string }
  > = {
    default: {
      icon: '?',
      iconBg: 'bg-slate-100',
      iconColor: 'text-slate-700',
      confirmBtn: 'bg-slate-900 hover:bg-slate-800 text-white',
      check: 'accent-slate-700'
    },
    danger: {
      icon: '!',
      iconBg: 'bg-rose-50',
      iconColor: 'text-rose-600',
      confirmBtn: 'bg-rose-600 hover:bg-rose-500 text-white',
      check: 'accent-rose-600'
    },
    info: {
      icon: 'i',
      iconBg: 'bg-brand-50',
      iconColor: 'text-brand-700',
      confirmBtn: 'bg-brand-700 hover:bg-brand-600 text-white',
      check: 'accent-brand-700'
    },
    success: {
      icon: '✓',
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
      confirmBtn: 'bg-emerald-600 hover:bg-emerald-500 text-white',
      check: 'accent-emerald-600'
    },
    warning: {
      icon: '!',
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-600',
      confirmBtn: 'bg-amber-600 hover:bg-amber-500 text-white',
      check: 'accent-amber-600'
    }
  };

  const tone = $derived<DialogTone>(
    current?.opts.tone ?? (current?.kind === 'alert' ? 'info' : 'default')
  );
  const style = $derived(toneStyles[tone]);
</script>

<svelte:window onkeydown={handleKey} />

{#if current}
  <div
    class="fixed inset-0 z-100 flex items-center justify-center px-4"
    role="presentation"
    transition:fade={{ duration: 120, easing: cubicOut }}
  >
    <button
      type="button"
      aria-label="Dismiss"
      class="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
      onclick={cancel}
    ></button>

    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-dialog-title"
      aria-describedby="app-dialog-message"
      class="relative w-full {current.kind === 'checklist' || current.kind === 'choice' ? 'max-w-lg' : 'max-w-md'} overflow-hidden rounded-2xl border border-hairline bg-white shadow-2xl shadow-slate-950/20"
      transition:scale={{ duration: 140, start: 0.96, easing: cubicOut }}
    >
      <div class="flex gap-4 px-7 pt-7 pb-5">
        <div
          class={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg ${style.iconBg} ${style.iconColor}`}
        >
          {style.icon}
        </div>
        <div class="min-w-0 flex-1 pt-1">
          <h2 id="app-dialog-title" class="text-lg leading-tight text-slate-950">
            {current.opts.title}
          </h2>
          <p
            id="app-dialog-message"
            class="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600"
          >
            {current.opts.message}
          </p>
        </div>
      </div>

      {#if current.kind === 'choice'}
        <div class="px-7 pt-2 pb-5">
          <ul class="flex max-h-80 flex-col gap-3 overflow-y-auto">
            {#each current.opts.options as option (option.id)}
              <li class="flex">
                <button
                  type="button"
                  onclick={() => dialogStore.resolveChoice(option.id)}
                  class={`group flex w-full items-center justify-between gap-4 rounded-xl px-5 py-4 text-left shadow-sm shadow-slate-950/5 transition hover:shadow-md focus:ring-2 focus:ring-offset-2 focus:outline-none ${style.confirmBtn}`}
                >
                  <span class="min-w-0 flex-1">
                    <span class="block text-sm">{option.label}</span>
                    {#if option.description}
                      <span class="mt-1 block text-xs leading-relaxed opacity-80">
                        {option.description}
                      </span>
                    {/if}
                  </span>
                  <span
                    aria-hidden="true"
                    class="shrink-0 text-base transition group-hover:translate-x-1"
                  >→</span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {:else if current.kind === 'prompt'}
        <div class="px-7 pt-1 pb-4">
          <label class="block text-xs font-medium text-slate-700">
            {current.opts.inputLabel ?? 'Value'}
            <input
              bind:this={inputEl}
              bind:value={inputValue}
              type={current.opts.password ? 'password' : 'text'}
              autocomplete={current.opts.password ? 'new-password' : 'off'}
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder={current.opts.placeholder ?? ''}
              class="mono mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100"
              oninput={() => (promptError = null)}
            />
          </label>
          {#if promptError}
            <p class="mt-2 text-xs font-medium text-red-700">{promptError}</p>
          {/if}
        </div>
      {:else if current.kind === 'checklist'}
        <div class="border-t border-hairline px-6 py-3">
          <div class="mb-2 flex items-center justify-between">
            <span class="text-xs font-medium uppercase tracking-wide text-slate-500">
              {selected.size} of {current.opts.items.length} selected
            </span>
            <div class="flex gap-2 text-xs">
              <button type="button" class="font-medium text-slate-600 hover:text-slate-950" onclick={selectAll}>
                Select all
              </button>
              <span class="text-slate-300">·</span>
              <button type="button" class="font-medium text-slate-600 hover:text-slate-950" onclick={selectNone}>
                Select none
              </button>
            </div>
          </div>
          <ul class="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-hairline bg-slate-50 p-2">
            {#each current.opts.items as item (item.id)}
              <li>
                <label
                  class="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 transition hover:bg-white"
                >
                  <input
                    type="checkbox"
                    class={`mt-0.5 h-4 w-4 rounded ${style.check}`}
                    checked={selected.has(item.id)}
                    onchange={() => toggleItem(item.id)}
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block text-sm font-medium text-slate-900">{item.label}</span>
                    {#if item.description}
                      <span class="mt-0.5 block text-xs text-slate-500">{item.description}</span>
                    {/if}
                  </span>
                </label>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="flex justify-end gap-2 border-t border-hairline bg-slate-50 px-7 py-3">
        {#if current.kind === 'alert'}
          <button
            type="button"
            onclick={cancel}
            class={`rounded-md px-4 py-2 text-sm transition ${style.confirmBtn}`}
          >
            {current.opts.buttonLabel ?? 'OK'}
          </button>
        {:else if current.kind === 'choice'}
          <button
            type="button"
            onclick={cancel}
            class="rounded-md px-3 py-2 text-sm text-slate-600 transition hover:text-slate-950"
          >
            {current.opts.cancelLabel ?? 'Close'}
          </button>
        {:else}
          <button
            type="button"
            onclick={cancel}
            class="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
          >
            {current.opts.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onclick={confirm}
            class={`rounded-md px-4 py-2 text-sm transition focus:ring-2 focus:ring-offset-2 focus:outline-none ${style.confirmBtn}`}
          >
            {current.opts.confirmLabel ?? 'Confirm'}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}
