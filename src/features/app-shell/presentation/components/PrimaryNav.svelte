<script lang="ts">
  import { page } from '$app/state';

  /**
   * Primary navigation. Deliberately a single entry: Projects is the
   * hierarchy's only entry point. Features live INSIDE a project and the
   * MCP playground is project-scoped (/projects/[id]/mcp), so neither
   * gets a global link. Feature editors count as Projects territory:
   * they are always a drill-down from a project, so the link stays lit
   * there.
   */
  type Props = {
    dark: boolean;
    lyriks: boolean;
  };

  let { dark, lyriks }: Props = $props();

  const primaryNav: ReadonlyArray<{
    label: string;
    href: string;
    isActive: (path: string) => boolean;
  }> = [
    {
      label: 'Projects',
      href: '/projects',
      isActive: (path) =>
        path === '/' ||
        path.startsWith('/projects') ||
        path.startsWith('/domains') ||
        path.startsWith('/features')
    }
  ];
</script>

<nav aria-label="Primary" class="hidden shrink-0 items-center gap-0.5 md:flex">
  {#each primaryNav as item (item.href)}
    {@const active = item.isActive(page.url.pathname)}
    <a
      href={item.href}
      aria-current={active ? 'page' : undefined}
      class="rounded-md px-2.5 py-1.5 text-sm font-medium transition {active
        ? lyriks
          ? 'bg-white/25 text-white'
          : dark
            ? 'bg-slate-800 text-white'
            : 'bg-slate-100 text-slate-950'
        : lyriks
          ? 'text-white/80 hover:bg-white/15 hover:text-white'
          : dark
            ? 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'}"
    >
      {item.label}
    </a>
  {/each}
</nav>
