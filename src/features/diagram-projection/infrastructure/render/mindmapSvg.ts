import type { DiagramNode, DiagramSpec } from '../../domain/DiagramSpec';

/**
 * In-app mindmap renderer: a bidirectional tidy-tree layout (the shape XMind
 * and markmap use) drawn straight to SVG.
 *
 * Mermaid's mindmap uses a force layout that collapses into overlapping boxes
 * once a node fans out into dozens of children (a surface with 50+ actions),
 * so the dashboard draws mindmaps itself. The root sits in the middle,
 * top-level branches are balanced onto the left and right sides by subtree
 * size, leaves stack at a fixed row pitch, and every parent centers on its
 * children. A parent whose children are one huge flock of leaves gets a
 * grid inside a soft group panel (one connector, no edge spaghetti), which
 * keeps the drawing near the viewport's aspect so the fit-to-view zoom stays
 * readable. Overlap-free by construction. Pure string building, no DOM.
 *
 * Node groups carry `id="mindmap-s{index}"` (the exporter's alias scheme), so
 * the viewer's spotlight and click-to-pick work unchanged.
 */

export type MindmapLayoutNode = {
  readonly node: DiagramNode;
  readonly index: number;
  readonly depth: number;
  /** Index of the root branch this node belongs to (-1 for the root). */
  readonly branch: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly parentIndex: number | null;
  /** True when the node sits inside a group panel (no individual edge). */
  readonly inPanel: boolean;
};

export type MindmapPanel = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly branch: number;
  readonly parentIndex: number;
};

export type MindmapLayout = {
  readonly nodes: MindmapLayoutNode[];
  readonly panels: MindmapPanel[];
};

const FONT_SIZE = 13;
const CHAR_W = 7.9; // conservative Inter width at 13px
const PAD_X = 12;
const NODE_H = 30;
const ROOT_H = 44;
const ROW_PITCH = 38; // vertical rhythm of stacked leaves
const GUTTER = 64; // horizontal gap between a parent and its children
const GRID_GAP = 14; // horizontal gap between grid columns in a panel
const PANEL_PAD = 16;
const MAX_STACK = 12; // beyond this, an all-leaf flock wraps into a grid
const VIEW_ASPECT = 1.7; // target width:height of a wrapped grid block
const MAX_LABEL = 32;

/** Branch palette: strong stroke + soft fill, same family as the graph. */
const BRANCHES = [
  { stroke: '#0e7490', fill: '#cffafe' },
  { stroke: '#2563eb', fill: '#dbeafe' },
  { stroke: '#7c3aed', fill: '#ede9fe' },
  { stroke: '#db2777', fill: '#fce7f3' },
  { stroke: '#ea580c', fill: '#ffedd5' },
  { stroke: '#ca8a04', fill: '#fef3c7' },
  { stroke: '#16a34a', fill: '#dcfce7' },
  { stroke: '#0f766e', fill: '#ccfbf1' }
] as const;

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const displayLabel = (label: string): string =>
  label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1).trimEnd()}…` : label;

const nodeWidth = (label: string, isRoot: boolean): number =>
  Math.max(isRoot ? 90 : 56, displayLabel(label).length * CHAR_W + PAD_X * 2);

/**
 * Computes positions for every reachable node. Exported for tests: overlap
 * freedom is a geometric property worth asserting directly.
 */
export const layoutMindmap = (spec: DiagramSpec): MindmapLayout => {
  const indexOf = new Map<string, number>();
  spec.nodes.forEach((node, index) => indexOf.set(node.id, index));

  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of spec.edges) {
    if (!indexOf.has(edge.from) || !indexOf.has(edge.to)) continue;
    const children = childrenOf.get(edge.from) ?? [];
    children.push(edge.to);
    childrenOf.set(edge.from, children);
    hasParent.add(edge.to);
  }

  const root =
    spec.nodes.find((node) => node.kind === 'root') ??
    spec.nodes.find((node) => !hasParent.has(node.id)) ??
    spec.nodes[0];
  if (!root) return { nodes: [], panels: [] };

  // Same reachability semantics as the Mermaid exporter: walk the tree from
  // the root (guarding cycles), then attach any unreached node under the root.
  const order: { id: string; depth: number; parent: string | null }[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number, parent: string | null): void => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push({ id, depth, parent });
    for (const child of childrenOf.get(id) ?? []) walk(child, depth + 1, id);
  };
  walk(root.id, 0, null);
  for (const node of spec.nodes) if (!seen.has(node.id)) walk(node.id, 1, root.id);

  // Effective children after cycle/orphan resolution, in walk order.
  const treeChildren = new Map<string, string[]>();
  for (const entry of order) {
    if (entry.parent === null) continue;
    const list = treeChildren.get(entry.parent) ?? [];
    list.push(entry.id);
    treeChildren.set(entry.parent, list);
  }

  const leafCount = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const entry = order[i];
    if (!entry) continue;
    const children = treeChildren.get(entry.id) ?? [];
    leafCount.set(
      entry.id,
      children.length === 0
        ? 1
        : children.reduce((sum, child) => sum + (leafCount.get(child) ?? 1), 0)
    );
  }

  // Balance top-level branches onto the two sides by subtree size, keeping
  // spec order within each side.
  const rootChildren = treeChildren.get(root.id) ?? [];
  const sideOf = new Map<string, 1 | -1>();
  const branchIndex = new Map<string, number>();
  let rightWeight = 0;
  let leftWeight = 0;
  rootChildren.forEach((child, index) => {
    branchIndex.set(child, index);
    if (rightWeight <= leftWeight) {
      sideOf.set(child, 1);
      rightWeight += leafCount.get(child) ?? 1;
    } else {
      sideOf.set(child, -1);
      leftWeight += leafCount.get(child) ?? 1;
    }
  });

  const widthOf = (id: string): number => {
    const node = spec.nodes[indexOf.get(id) ?? -1];
    return node ? nodeWidth(node.label, id === root.id) : 56;
  };

  type Placed = { x: number; y: number; w: number };
  const placedById = new Map<string, Placed>();
  const inPanel = new Set<string>();
  // Panels are indexed by parent id until indices resolve at the end.
  const rawPanels: { parentId: string; x: number; y: number; w: number; h: number }[] = [];

  /**
   * One DFS does both axes: x flows down (child sits one gutter beyond its
   * parent's facing edge), y flows up (leaves take rows, parents center on
   * their children). `cursor.v` is the next free y on this side, in px.
   */
  const place = (id: string, parentEdgeX: number, side: 1 | -1, cursor: { v: number }): void => {
    const w = widthOf(id);
    const x = parentEdgeX + side * (GUTTER + w / 2);
    const children = treeChildren.get(id) ?? [];

    const allLeaves =
      children.length > 0 && children.every((child) => (treeChildren.get(child) ?? []).length === 0);
    if (allLeaves && children.length > MAX_STACK) {
      // Wrap the flock into a grid inside a group panel.
      const cellW = children.reduce((max, child) => Math.max(max, widthOf(child)), 0);
      const cols = Math.max(
        1,
        Math.round(Math.sqrt((children.length * ROW_PITCH * VIEW_ASPECT) / (cellW + GRID_GAP)))
      );
      const rows = Math.ceil(children.length / cols);
      const panelW = PANEL_PAD * 2 + cols * cellW + (cols - 1) * GRID_GAP;
      const panelH = PANEL_PAD * 2 + rows * ROW_PITCH - (ROW_PITCH - NODE_H);
      const panelLeft = side === 1 ? x + w / 2 + GUTTER : x - w / 2 - GUTTER - panelW;
      const panelTop = cursor.v;
      children.forEach((child, i) => {
        const col = Math.floor(i / rows);
        const row = i % rows;
        // Mirror column order on the left side so column 0 hugs the parent.
        const visualCol = side === 1 ? col : cols - 1 - col;
        placedById.set(child, {
          x: panelLeft + PANEL_PAD + visualCol * (cellW + GRID_GAP) + cellW / 2,
          y: panelTop + PANEL_PAD + NODE_H / 2 + row * ROW_PITCH,
          w: widthOf(child)
        });
        inPanel.add(child);
      });
      rawPanels.push({ parentId: id, x: panelLeft, y: panelTop, w: panelW, h: panelH });
      placedById.set(id, { x, y: panelTop + panelH / 2, w });
      cursor.v = panelTop + panelH + ROW_PITCH / 2;
      return;
    }

    if (children.length === 0) {
      placedById.set(id, { x, y: cursor.v, w });
      cursor.v += ROW_PITCH;
      return;
    }

    const edgeX = x + (side * w) / 2;
    for (const child of children) place(child, edgeX, side, cursor);
    const ys = children.map((child) => placedById.get(child)?.y ?? 0);
    placedById.set(id, { x, y: (Math.min(...ys) + Math.max(...ys)) / 2, w });
  };

  const rootW = widthOf(root.id);
  for (const side of [1, -1] as const) {
    const group = rootChildren.filter((child) => sideOf.get(child) === side);
    if (group.length === 0) continue;
    const cursor = { v: 0 };
    for (const child of group) place(child, (side * rootW) / 2, side, cursor);
    // Center this side's block on the root.
    const ids: string[] = [];
    const collect = (id: string): void => {
      ids.push(id);
      for (const child of treeChildren.get(id) ?? []) collect(child);
    };
    for (const child of group) collect(child);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const id of ids) {
      const placed = placedById.get(id);
      if (!placed) continue;
      minY = Math.min(minY, placed.y);
      maxY = Math.max(maxY, placed.y);
    }
    const shift = -(minY + maxY) / 2;
    for (const id of ids) {
      const placed = placedById.get(id);
      if (placed) placedById.set(id, { ...placed, y: placed.y + shift });
    }
    for (const panel of rawPanels) {
      if (ids.includes(panel.parentId)) panel.y += shift;
    }
  }
  placedById.set(root.id, { x: 0, y: 0, w: rootW });

  const branchOf = (id: string): number => {
    let current: string | null = id;
    while (current !== null) {
      const branch = branchIndex.get(current);
      if (branch !== undefined) return branch;
      current = order.find((entry) => entry.id === current)?.parent ?? null;
    }
    return -1;
  };

  const nodes: MindmapLayoutNode[] = [];
  for (const entry of order) {
    const index = indexOf.get(entry.id);
    const node = index === undefined ? undefined : spec.nodes[index];
    const placed = placedById.get(entry.id);
    if (index === undefined || !node || !placed) continue;
    nodes.push({
      node,
      index,
      depth: entry.depth,
      branch: entry.depth === 0 ? -1 : branchOf(entry.id),
      x: placed.x,
      y: placed.y,
      w: placed.w,
      h: entry.depth === 0 ? ROOT_H : NODE_H,
      parentIndex: entry.parent === null ? null : indexOf.get(entry.parent) ?? null,
      inPanel: inPanel.has(entry.id)
    });
  }
  const resolvedPanels: MindmapPanel[] = [];
  for (const panel of rawPanels) {
    const parentIndex = indexOf.get(panel.parentId);
    if (parentIndex === undefined) continue;
    resolvedPanels.push({
      x: panel.x,
      y: panel.y,
      w: panel.w,
      h: panel.h,
      branch: branchOf(panel.parentId),
      parentIndex
    });
  }
  return { nodes, panels: resolvedPanels };
};

export const renderMindmapSvg = (spec: DiagramSpec): string => {
  const { nodes, panels } = layoutMindmap(spec);
  if (nodes.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"></svg>';
  }
  const byIndex = new Map(nodes.map((laid) => [laid.index, laid]));

  const PAD = 48;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const laid of nodes) {
    minX = Math.min(minX, laid.x - laid.w / 2);
    minY = Math.min(minY, laid.y - laid.h / 2);
    maxX = Math.max(maxX, laid.x + laid.w / 2);
    maxY = Math.max(maxY, laid.y + laid.h / 2);
  }
  for (const panel of panels) {
    minX = Math.min(minX, panel.x);
    minY = Math.min(minY, panel.y);
    maxX = Math.max(maxX, panel.x + panel.w);
    maxY = Math.max(maxY, panel.y + panel.h);
  }
  const width = Math.ceil(maxX - minX + PAD * 2);
  const height = Math.ceil(maxY - minY + PAD * 2);
  const ox = PAD - minX;
  const oy = PAD - minY;

  const branchStyle = (branch: number): (typeof BRANCHES)[number] =>
    BRANCHES[((branch % BRANCHES.length) + BRANCHES.length) % BRANCHES.length] ?? BRANCHES[0];

  const sCurve = (fromX: number, fromY: number, toX: number, toY: number): string => {
    const midX = (fromX + toX) / 2;
    return `M ${fromX.toFixed(1)} ${fromY.toFixed(1)} C ${midX.toFixed(1)} ${fromY.toFixed(1)}, ${midX.toFixed(1)} ${toY.toFixed(1)}, ${toX.toFixed(1)} ${toY.toFixed(1)}`;
  };

  const panelShapes: string[] = [];
  const edges: string[] = [];
  for (const panel of panels) {
    const style = branchStyle(panel.branch);
    panelShapes.push(
      `<rect x="${(panel.x + ox).toFixed(1)}" y="${(panel.y + oy).toFixed(1)}" width="${panel.w.toFixed(1)}" height="${panel.h.toFixed(1)}" rx="14" fill="${style.fill}" fill-opacity="0.45" stroke="${style.stroke}" stroke-opacity="0.4" stroke-width="1.5"/>`
    );
    const parent = byIndex.get(panel.parentIndex);
    if (parent) {
      const towardRight = panel.x >= parent.x;
      const fromX = parent.x + ox + ((towardRight ? 1 : -1) * parent.w) / 2;
      const toX = panel.x + ox + (towardRight ? 0 : panel.w);
      edges.push(
        `<path d="${sCurve(fromX, parent.y + oy, toX, panel.y + oy + panel.h / 2)}" fill="none" stroke="${style.stroke}" stroke-opacity="0.5" stroke-width="2"/>`
      );
    }
  }

  const boxes: string[] = [];
  for (const laid of nodes) {
    const x = laid.x + ox;
    const y = laid.y + oy;
    const style = branchStyle(laid.branch);
    const isRoot = laid.depth === 0;

    const parent = laid.parentIndex === null ? null : byIndex.get(laid.parentIndex);
    if (parent && !laid.inPanel) {
      const side = laid.x >= parent.x ? 1 : -1;
      edges.push(
        `<path d="${sCurve(parent.x + ox + (side * parent.w) / 2, parent.y + oy, x - (side * laid.w) / 2, y)}" fill="none" stroke="${style.stroke}" stroke-opacity="0.4" stroke-width="1.5"/>`
      );
    }

    const label = escapeXml(displayLabel(laid.node.label));
    const full = escapeXml(laid.node.label);
    const isLeafAction = laid.node.kind === 'action';
    const fill = isRoot ? '#0f172a' : isLeafAction ? '#ffffff' : style.fill;
    const stroke = isRoot ? '#020617' : style.stroke;
    const text = isRoot ? '#f8fafc' : '#0f172a';
    boxes.push(
      [
        `<g id="mindmap-s${laid.index}">`,
        `<title>${full}</title>`,
        `<rect x="${(x - laid.w / 2).toFixed(1)}" y="${(y - laid.h / 2).toFixed(1)}" width="${laid.w.toFixed(1)}" height="${laid.h}" rx="${isRoot ? 14 : 8}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
        `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="'Inter', ui-sans-serif, system-ui, sans-serif" font-size="${isRoot ? 15 : FONT_SIZE}" font-weight="${isRoot ? 600 : 500}" fill="${text}">${label}</text>`,
        '</g>'
      ].join('')
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(spec.title)}">`,
    ...panelShapes,
    ...edges,
    ...boxes,
    '</svg>'
  ].join('\n');
};
