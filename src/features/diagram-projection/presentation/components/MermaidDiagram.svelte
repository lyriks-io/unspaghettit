<script lang="ts">
  import { loadMermaid } from '$features/diagram-projection/infrastructure/render/mermaidLoader';

  type Props = {
    code: string;
    /** Ready-made SVG markup; when set, it is shown instead of rendering `code`
     *  with Mermaid (used by formats the dashboard draws itself, e.g. mindmap). */
    svgOverride?: string;
    /** Exporter alias (`s{index}`) of the element to spotlight, if any. */
    focusKey?: string | null;
    /** Display label of the focused element: fallback match when the SVG has no alias id. */
    focusLabel?: string;
    /** Invoked with the alias index when the user clicks a drawn node. */
    onNodePick?: (index: number) => void;
  };
  let { code, svgOverride = '', focusKey = null, focusLabel = '', onNodePick }: Props = $props();

  let svg = $state('');
  let status = $state<'idle' | 'rendering' | 'ready' | 'error'>('idle');

  let viewport = $state<HTMLDivElement | null>(null);
  // Pan/zoom transform applied to the diagram. Scroll zooms toward the cursor,
  // drag pans — so even a very tall/wide chart stays navigable in a fixed frame.
  let scale = $state(1);
  let tx = $state(0);
  let ty = $state(0);

  // Natural (unscaled) diagram size, read from the rendered SVG's viewBox.
  let natW = 0;
  let natH = 0;

  // Monotonic token so a slow render can't overwrite a newer one.
  let renderSeq = 0;

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 4;
  const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  const render = async (source: string): Promise<void> => {
    if (!source) {
      svg = '';
      status = 'idle';
      return;
    }
    const seq = ++renderSeq;
    status = 'rendering';
    try {
      const mermaid = await loadMermaid();
      const result = await mermaid.render(`mermaid-${seq}`, source);
      if (seq !== renderSeq) return; // superseded by a newer render
      svg = result.svg;
      status = 'ready';
    } catch {
      // Belt and braces next to `suppressErrorRendering`: drop the temp
      // container Mermaid may leave in <body> on failure. Orphaned, it grows
      // the document and puts a phantom scrollbar on the window.
      document.getElementById(`dmermaid-${seq}`)?.remove();
      if (seq !== renderSeq) return;
      svg = '';
      status = 'error';
    }
  };

  // --- tweened camera -------------------------------------------------------
  // One rAF tween drives fit, button zoom, double-click and spotlight moves.
  // Start values are captured inside the first frame (not synchronously), so
  // effects calling `animateTo` never read the transform state they write.
  let tweenFrame: number | null = null;
  const easeInOutCubic = (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const cancelTween = (): void => {
    if (tweenFrame !== null) {
      cancelAnimationFrame(tweenFrame);
      tweenFrame = null;
    }
  };
  const animateTo = (nx: number, ny: number, ns: number, duration = 260): void => {
    cancelTween();
    if (duration <= 0) {
      tx = nx;
      ty = ny;
      scale = ns;
      return;
    }
    let start = 0;
    let sx = 0;
    let sy = 0;
    let ss = 1;
    const step = (now: number): void => {
      if (!start) {
        start = now;
        sx = tx;
        sy = ty;
        ss = scale;
      }
      const k = easeInOutCubic(Math.min(1, (now - start) / duration));
      tx = sx + (nx - sx) * k;
      ty = sy + (ny - sy) * k;
      scale = ss + (ns - ss) * k;
      tweenFrame = k < 1 ? requestAnimationFrame(step) : null;
    };
    tweenFrame = requestAnimationFrame(step);
  };

  // Scale the diagram to fit the frame and center it.
  const fit = (instant = false): void => {
    if (!viewport || !natW || !natH) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const next = clampScale(Math.min(vw / natW, vh / natH));
    animateTo((vw - natW * next) / 2, (vh - natH * next) / 2, next, instant ? 0 : 260);
  };

  // Zoom about a viewport point, keeping that point fixed under the cursor.
  const zoomAround = (factor: number, cx: number, cy: number, duration = 0): void => {
    const next = clampScale(scale * factor);
    if (next === scale) return;
    animateTo(cx - (cx - tx) * (next / scale), cy - (cy - ty) * (next / scale), next, duration);
  };

  const zoomByButton = (factor: number): void => {
    if (!viewport) return;
    zoomAround(factor, viewport.clientWidth / 2, viewport.clientHeight / 2, 160);
  };

  const onWheel = (event: WheelEvent): void => {
    if (!viewport) return;
    event.preventDefault();
    cancelTween();
    const rect = viewport.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAround(factor, event.clientX - rect.left, event.clientY - rect.top);
  };

  const onDblClick = (event: MouseEvent): void => {
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    zoomAround(1.6, event.clientX - rect.left, event.clientY - rect.top, 260);
  };

  const onKeydown = (event: KeyboardEvent): void => {
    const pan = 60;
    if (event.key === '+' || event.key === '=') zoomByButton(1.25);
    else if (event.key === '-' || event.key === '_') zoomByButton(0.8);
    else if (event.key === '0') fit();
    else if (event.key === 'ArrowLeft') tx += pan;
    else if (event.key === 'ArrowRight') tx -= pan;
    else if (event.key === 'ArrowUp') ty += pan;
    else if (event.key === 'ArrowDown') ty -= pan;
    else return;
    event.preventDefault();
  };

  let panning = $state(false);
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;
  let dragDistance = 0;
  // Captured at pointerdown: pointer capture retargets the later events (and
  // the click) to the viewport, so the pressed SVG element must be kept here.
  let pickCandidate: Element | null = null;

  const onPointerDown = (event: PointerEvent): void => {
    cancelTween();
    panning = true;
    startX = event.clientX;
    startY = event.clientY;
    startTx = tx;
    startTy = ty;
    dragDistance = 0;
    pickCandidate = event.target as Element;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!panning) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    dragDistance = Math.max(dragDistance, Math.abs(dx) + Math.abs(dy));
    tx = startTx + dx;
    ty = startTy + dy;
  };
  const endPan = (event: PointerEvent): void => {
    if (!panning) return;
    panning = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  };
  const onPointerUp = (event: PointerEvent): void => {
    const wasPanning = panning;
    endPan(event);
    // A stationary press on a drawn node selects it (a drag pans instead).
    // `detail > 1` is the second press of a double-click, which zooms.
    if (wasPanning && dragDistance <= 4 && event.detail <= 1 && onNodePick) {
      const index = aliasIndexFrom(pickCandidate);
      if (index !== null && Number.isInteger(index)) onNodePick(index);
    }
    pickCandidate = null;
  };

  // --- diagram-node picking -------------------------------------------------
  // Exporter aliases are `s{index}`; Mermaid embeds them in element ids
  // (`flowchart-s3-…`, `entity-s3-…`). An id whose alias tokens all agree is a
  // node (edge ids carry two different aliases), so a plain click selects it.
  const aliasTokens = (id: string): string[] => id.match(/s\d+/g) ?? [];

  const aliasIndexFrom = (target: Element | null): number | null => {
    let el: Element | null = target;
    while (el && el !== viewport) {
      const id = (el as HTMLElement).id;
      if (id) {
        const [first, ...rest] = aliasTokens(id);
        if (first && rest.every((token) => token === first)) {
          return Number(first.slice(1));
        }
      }
      el = el.parentElement;
    }
    return null;
  };

  // --- spotlight --------------------------------------------------------------
  // The focused element's bounding box in diagram coordinates; the ring div is
  // derived from it and the live transform, so it tracks pan/zoom for free.
  type Spot = { x: number; y: number; w: number; h: number };
  let spot = $state<Spot | null>(null);

  const findFocusTarget = (
    root: SVGSVGElement,
    key: string,
    label: string
  ): SVGGraphicsElement | null => {
    for (const el of root.querySelectorAll<SVGGraphicsElement>('g[id]')) {
      const tokens = aliasTokens(el.id);
      if (tokens.length > 0 && tokens.every((token) => token === key)) return el;
    }
    // No alias id in this dialect (e.g. sequence actors): match the visible text.
    const wanted = label.trim();
    if (!wanted) return null;
    for (const el of root.querySelectorAll('text, tspan, span')) {
      if (el.textContent?.trim() === wanted) {
        return (el.closest('g') ?? el) as SVGGraphicsElement;
      }
    }
    return null;
  };

  const spotFor = (el: SVGGraphicsElement, root: SVGSVGElement): Spot | null => {
    try {
      const box = el.getBBox();
      const ctm = el.getCTM();
      if (!ctm) return { x: box.x, y: box.y, w: box.width, h: box.height };
      const corners: readonly (readonly [number, number])[] = [
        [box.x, box.y],
        [box.x + box.width, box.y],
        [box.x, box.y + box.height],
        [box.x + box.width, box.y + box.height]
      ];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [cx, cy] of corners) {
        const point = root.createSVGPoint();
        point.x = cx;
        point.y = cy;
        const mapped = point.matrixTransform(ctm);
        minX = Math.min(minX, mapped.x);
        minY = Math.min(minY, mapped.y);
        maxX = Math.max(maxX, mapped.x);
        maxY = Math.max(maxY, mapped.y);
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    } catch {
      return null;
    }
  };

  // Re-render whenever the source changes. A ready-made SVG bypasses Mermaid
  // entirely (and invalidates any in-flight Mermaid render).
  $effect(() => {
    if (svgOverride) {
      renderSeq++;
      svg = svgOverride;
      status = 'ready';
      return;
    }
    void render(code);
  });

  // Once a fresh SVG is in the DOM, read its natural size and fit it. Mermaid's
  // own `max-width:100%` clamp would fight our transform, so we size the SVG
  // explicitly from its viewBox and let the transform drive what's shown.
  $effect(() => {
    if (status !== 'ready' || !svg || !viewport) return;
    const el = viewport.querySelector('svg');
    if (!el) return;
    const box = el.viewBox?.baseVal;
    const rect = el.getBoundingClientRect();
    natW = box && box.width ? box.width : rect.width;
    natH = box && box.height ? box.height : rect.height;
    el.style.maxWidth = 'none';
    el.style.width = `${natW}px`;
    el.style.height = `${natH}px`;
    fit(true);
  });

  // Spotlight the focused element: pulse a ring around it and glide the camera
  // so it lands centered at a readable zoom. Runs after the sizing effect above
  // (declaration order), so the SVG is already at its natural size.
  $effect(() => {
    if (status !== 'ready' || !svg || !viewport || !focusKey) {
      spot = null;
      return;
    }
    const root = viewport.querySelector('svg');
    if (!root) {
      spot = null;
      return;
    }
    const target = findFocusTarget(root, focusKey, focusLabel);
    const next = target ? spotFor(target, root) : null;
    spot = next;
    if (!next) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const targetScale = clampScale(Math.min(vw / (next.w + 260), vh / (next.h + 260), 1.5));
    animateTo(
      vw / 2 - (next.x + next.w / 2) * targetScale,
      vh / 2 - (next.y + next.h / 2) * targetScale,
      targetScale,
      420
    );
  });

  // Refit when the frame itself resizes (e.g. the sidebar collapses).
  $effect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(() => fit(true));
    observer.observe(viewport);
    return () => observer.disconnect();
  });
</script>

<!-- Fixed 60vh below lg; at lg the card is a flex column and the canvas
     stretches to whatever height remains. -->
<div class="diagram-canvas relative h-[60vh] w-full overflow-hidden lg:h-auto lg:min-h-0 lg:flex-1">
  {#if status === 'error'}
    <div class="grid h-full place-items-center px-4 text-center text-sm text-slate-500">
      <div>
        <p class="font-medium text-slate-700">Couldn't draw this diagram.</p>
        <p class="mt-1">Use “Copy as Mermaid” to view the source elsewhere.</p>
      </div>
    </div>
  {:else}
    <!-- The canvas is a real interactive control (pan, zoom, pick); role
         "application" plus tabindex makes that reachable, so the
         noninteractive-element heuristics do not apply here. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={viewport}
      role="application"
      tabindex="0"
      aria-label="Diagram canvas. Scroll to zoom, drag to pan, double-click to zoom in. Keyboard: plus and minus zoom, arrows pan, 0 fits."
      class="h-full w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40 {panning
        ? 'cursor-grabbing'
        : 'cursor-grab'}"
      onwheel={onWheel}
      ondblclick={onDblClick}
      onkeydown={onKeydown}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointerleave={endPan}
    >
      {#if status === 'ready' && svg}
        <div
          class="mermaid-host absolute left-0 top-0 origin-top-left will-change-transform"
          style={`transform: translate(${tx}px, ${ty}px) scale(${scale});`}
        >
          {#key svg}
            <div class="diagram-enter">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html svg}
            </div>
          {/key}
        </div>
        {#if spot}
          <div
            class="spotlight-ring pointer-events-none absolute z-10"
            style={`left:${tx + (spot.x - 10) * scale}px; top:${ty + (spot.y - 10) * scale}px; width:${(spot.w + 20) * scale}px; height:${(spot.h + 20) * scale}px;`}
            aria-hidden="true"
          ></div>
        {/if}
      {:else}
        <div class="grid h-full place-items-center">
          <div class="flex items-center gap-2.5 text-sm text-slate-400">
            <span class="projection-spinner" aria-hidden="true"></span>
            Projecting…
          </div>
        </div>
      {/if}
    </div>

    <!-- Bottom-right: Google-Maps-style zoom + fit control (matches the graph). -->
    <div
      class="absolute bottom-3 right-3 z-10 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-sm backdrop-blur"
    >
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in (+)"
        onclick={() => zoomByButton(1.25)}
        class="grid h-9 w-9 place-items-center text-lg font-semibold leading-none text-slate-700 transition hover:bg-slate-100"
      >
        +
      </button>
      <div class="h-px bg-slate-200"></div>
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out (−)"
        onclick={() => zoomByButton(0.8)}
        class="grid h-9 w-9 place-items-center text-lg font-semibold leading-none text-slate-700 transition hover:bg-slate-100"
      >
        −
      </button>
      <div class="h-px bg-slate-200"></div>
      <button
        type="button"
        aria-label="Fit diagram to view"
        title="Fit to view (0)"
        onclick={() => fit()}
        class="grid h-9 w-9 place-items-center text-slate-700 transition hover:bg-slate-100"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M4 9V5a1 1 0 0 1 1-1h4" />
          <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
          <path d="M4 15v4a1 1 0 0 0 1 1h4" />
          <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
        </svg>
      </button>
    </div>

    {#if status === 'ready'}
      <div
        class="absolute bottom-3 left-3 z-10 rounded-md bg-white/85 px-2 py-1 text-xs font-medium text-slate-500 backdrop-blur"
      >
        {Math.round(scale * 100)}%
      </div>
    {/if}
  {/if}
</div>

<style>
  .mermaid-host :global(svg) {
    display: block;
  }

  /* Same visual language as the interactive behavior graph's canvas. */
  .diagram-canvas {
    background:
      radial-gradient(circle at 50% 40%, rgba(34, 211, 238, 0.08), transparent 30rem),
      linear-gradient(#ffffff, #f6fafc);
  }

  .diagram-canvas::before {
    position: absolute;
    inset: 0;
    pointer-events: none;
    content: '';
    background-image: radial-gradient(rgba(15, 23, 42, 0.07) 1px, transparent 1px);
    background-size: 22px 22px;
    mask-image: radial-gradient(circle at center, black 0, black 60%, transparent 100%);
  }

  .diagram-enter {
    animation: diagram-in 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  @keyframes diagram-in {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.985);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .spotlight-ring {
    border: 2px solid #06b6d4;
    border-radius: 12px;
    animation: spot-pulse 1.6s ease-in-out infinite;
  }

  @keyframes spot-pulse {
    0%,
    100% {
      box-shadow:
        0 0 0 4px rgba(6, 182, 212, 0.2),
        0 0 22px rgba(6, 182, 212, 0.3);
    }
    50% {
      box-shadow:
        0 0 0 10px rgba(6, 182, 212, 0.08),
        0 0 36px rgba(6, 182, 212, 0.45);
    }
  }

  .projection-spinner {
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 9999px;
    border: 2px solid rgba(100, 116, 139, 0.25);
    border-top-color: #06b6d4;
    animation: spinner-turn 0.8s linear infinite;
  }

  @keyframes spinner-turn {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .diagram-enter,
    .spotlight-ring {
      animation: none;
    }
  }
</style>
