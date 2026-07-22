<script lang="ts">
  import { identityStore } from '$shared/identity/identityStore.svelte';
  import HeaderMenu from '$features/app-shell/presentation/components/HeaderMenu.svelte';
  import { promptForDisplayName } from '$features/app-shell/presentation/identityPrompt';

  /**
   * The avatar menu: shows who the local display name belongs to and offers
   * the set/change-name dialog. The avatar doubles as the "needs action" cue
   * when no name is set (dashed border + amber dot).
   *
   * Under a host brand (e.g. `brand=lyriks`) the host owns identity, so the
   * dropdown, the set-name affordance, and the status dot are all dropped:
   * `avatarOnly` renders just the avatar disc, non-interactive.
   */
  type Props = {
    /** Render only the avatar disc, without the dropdown / set-name menu. */
    avatarOnly?: boolean;
  };

  let { avatarOnly = false }: Props = $props();

  // First letter, uppercase, used in the avatar when a name is set.
  const initial = $derived(identityStore.name.trim().charAt(0).toUpperCase());

  const label = $derived(
    identityStore.name
      ? `Signed in as ${identityStore.name}. Open identity menu.`
      : 'Set your display name'
  );
  const title = $derived(
    identityStore.name
      ? `Signed in as ${identityStore.name}`
      : 'Set a display name so your edits are recognisable in history'
  );

  const triggerClass = (): string =>
    `group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold shadow-sm shadow-slate-950/5 ring-1 ring-transparent transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
      identityStore.name
        ? 'bg-linear-to-br from-brand-600 to-brand-800 text-white hover:from-brand-500 hover:to-brand-700'
        : 'border border-dashed border-slate-300 bg-white text-slate-400 hover:border-brand-400 hover:text-brand-700'
    }`;

  // Static avatar disc used in `avatarOnly` mode: no dashed "needs action"
  // border, no status dot, no hover affordance — the host manages identity, so
  // the disc keeps the same branded fill whether or not a name is known.
  const staticAvatarClass =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-brand-600 to-brand-800 text-sm font-semibold text-white shadow-sm shadow-slate-950/5';

  async function pickRename(close: () => void) {
    close();
    await promptForDisplayName();
  }
</script>

{#snippet avatarGlyph()}
  {#if identityStore.name}
    <span aria-hidden="true">{initial}</span>
  {:else}
    <!-- Person silhouette: head + shoulders. Sized to match the
         surrounding nav buttons; thin stroke so the dashed border
         around it stays the dominant "needs action" cue. -->
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" />
    </svg>
  {/if}
{/snippet}

{#if avatarOnly}
  <!-- Host-branded chrome: the avatar is presentation only. Keep the disc so
       the header still reads "signed in", but drop the menu, the set-name
       affordance, and the status dot. -->
  <div class={staticAvatarClass} {title} aria-label={title}>
    {@render avatarGlyph()}
  </div>
{:else}
  <HeaderMenu {label} {title} {triggerClass}>
    {#snippet trigger()}
      {@render avatarGlyph()}
      <!-- Status dot: green when set, amber dashed when missing.
           Communicates the "set" / "needs action" state at a glance,
           distinguishing the avatar from a generic nav pill. -->
      <span
        class="absolute -right-0.5 -bottom-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full ring-2 ring-white
          {identityStore.name ? 'bg-emerald-500' : 'bg-amber-400'}"
        aria-hidden="true"
      ></span>
    {/snippet}
    {#snippet menu(close)}
      {#if identityStore.name}
        <p class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Signed in as
        </p>
        <p class="truncate px-3 pb-2 text-sm font-medium text-slate-800">
          {identityStore.name}
        </p>
        <div class="my-1 h-px bg-slate-100"></div>
      {/if}
      <button
        type="button"
        role="menuitem"
        onclick={() => pickRename(close)}
        class="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
          aria-hidden="true"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
        <span class="min-w-0 flex-1">
          <span class="block font-medium">
            {identityStore.name ? 'Change display name' : 'Set display name'}
          </span>
          <span class="block text-[11px] text-slate-500">
            Shown on every history entry you create.
          </span>
        </span>
      </button>
    {/snippet}
  </HeaderMenu>
{/if}
