import type {
  Edge as VisEdge,
  IdType,
  Network,
  Node as VisNode,
  Options as VisOptions
} from 'vis-network/standalone';
import type { DataSet } from 'vis-data/standalone';
import type {
  BehaviorGraphEdge,
  BehaviorGraphEdgeKind,
  BehaviorGraphView,
  BehaviorGraphViewNode
} from '$features/behavior-model/domain/services/BehaviorGraphModel';
import type {
  BehaviorGraphEdgeTheme,
  BehaviorGraphNodeTheme
} from '$features/behavior-model/presentation/view-models/BehaviorGraphTheme';

export type VisNetworkRuntime = typeof import('vis-network/standalone');

export type BehaviorGraphRendererCallbacks = {
  readonly onSelectedNodeChange?: (id: string | null) => void;
  readonly onSelectedEdgeChange?: (id: string | null) => void;
  readonly onStabilizationProgress?: (progress: number) => void;
  readonly onSettledChange?: (settled: boolean) => void;
};

export type BehaviorGraphRendererInput = {
  readonly graph: BehaviorGraphView;
  readonly selectedId: string | null;
  readonly selectedEdgeId: string | null;
  readonly labelsVisible: boolean;
  readonly nodeTheme: Record<BehaviorGraphViewNode['type'], BehaviorGraphNodeTheme>;
  readonly edgeTheme: Record<BehaviorGraphEdgeKind, BehaviorGraphEdgeTheme>;
};

type HighlightSnapshot = {
  readonly nodes: ReadonlySet<IdType>;
  readonly edges: ReadonlySet<IdType>;
};

type NodeVisualMode = 'base' | 'dimmed' | 'highlighted' | 'selected';
type EdgeVisualMode = 'base' | 'dimmed' | 'highlighted' | 'selected';

const IMPORTANT_EDGE_KINDS = new Set<BehaviorGraphEdgeKind>(['writes', 'emits', 'transitions']);
const DIMMED_NODE_OPACITY = 0.14;
const DIMMED_EDGE_OPACITY = 0.035;

const nodeSize = (degree: number): number => Math.max(13, Math.min(38, 13 + Math.sqrt(degree) * 6));

const hexToRgba = (color: string, alpha: number): string => {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return color;
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
};

const contrastTextFor = (color: string): '#000000' | '#ffffff' => {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return '#000000';
  const channel = (part: string): number => {
    const value = Number.parseInt(part, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const red = channel(hex.slice(0, 2));
  const green = channel(hex.slice(2, 4));
  const blue = channel(hex.slice(4, 6));
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff';
};

const iterationsFor = (nodeCount: number): number => {
  if (nodeCount > 700) return 220;
  if (nodeCount > 300) return 280;
  return 180;
};

const stabilizationDeadlineFor = (nodeCount: number): number => {
  if (nodeCount > 700) return 2600;
  if (nodeCount > 300) return 3200;
  return 2400;
};

export class VisBehaviorGraphRenderer {
  private network: Network | null = null;
  private nodes: DataSet<VisNode, 'id'> | null = null;
  private edges: DataSet<VisEdge, 'id'> | null = null;
  private signature = '';
  private currentInput: BehaviorGraphRendererInput | null = null;
  private highlightFrame: number | null = null;
  private highlighted: HighlightSnapshot = { nodes: new Set(), edges: new Set() };
  private selectionEventsSuppressed = false;
  private stabilizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly settle = (): void => this.freezePhysics();

  constructor(
    private readonly runtime: VisNetworkRuntime,
    private readonly container: HTMLElement,
    private readonly callbacks: BehaviorGraphRendererCallbacks = {}
  ) {}

  render(input: BehaviorGraphRendererInput): void {
    this.currentInput = input;
    const signature = this.signatureFor(input);
    if (!this.network) {
      this.createNetwork(input, signature);
      return;
    }

    if (signature === this.signature) {
      this.select(input.selectedId, input.selectedEdgeId, false);
      return;
    }

    this.signature = signature;
    this.clearHighlight();
    this.nodes?.clear();
    this.edges?.clear();
    this.nodes?.add(this.toNodes(input));
    this.edges?.add(this.toEdges(input));
    this.startStabilization(input.graph.nodes.length);
    this.select(input.selectedId, input.selectedEdgeId, false);
  }

  relayout(nodeCount: number): void {
    if (!this.network) return;
    this.clearHighlight();
    this.startStabilization(nodeCount);
  }

  fit(): void {
    this.network?.fit({ animation: { duration: 220, easingFunction: 'easeInOutQuad' } });
  }

  zoomBy(factor: number): void {
    if (!this.network) return;
    const scale = Math.max(0.04, Math.min(5, this.network.getScale() * factor));
    this.network.moveTo({
      scale,
      animation: { duration: 120, easingFunction: 'easeInOutQuad' }
    });
  }

  focus(nodeId: string): void {
    this.network?.focus(nodeId, {
      scale: 1.08,
      animation: { duration: 260, easingFunction: 'easeInOutQuad' }
    });
  }

  select(nodeId: string | null, edgeId: string | null = null, focusSelection = true): void {
    if (!this.network) return;
    this.selectionEventsSuppressed = true;
    try {
      this.network.setSelection(
        { nodes: nodeId ? [nodeId] : [], edges: !nodeId && edgeId ? [edgeId] : [] },
        { highlightEdges: false }
      );
    } finally {
      this.selectionEventsSuppressed = false;
    }
    if (nodeId) {
      this.highlightNodeNeighborhood(nodeId, focusSelection);
      return;
    }
    if (edgeId) {
      this.highlightEdgeNeighborhood(edgeId, focusSelection);
      return;
    }
    this.clearHighlight();
  }

  destroy(): void {
    this.clearPendingWork();
    this.network?.destroy();
    this.network = null;
    this.nodes = null;
    this.edges = null;
  }

  private createNetwork(input: BehaviorGraphRendererInput, signature: string): void {
    const nodes = new this.runtime.DataSet<VisNode, 'id'>(this.toNodes(input));
    const edges = new this.runtime.DataSet<VisEdge, 'id'>(this.toEdges(input));
    this.nodes = nodes;
    this.edges = edges;
    const network = new this.runtime.Network(this.container, { nodes, edges }, this.options(input.graph.nodes.length));
    this.network = network;
    this.signature = signature;

    network.on('stabilizationProgress', (params?: { iterations: number; total: number }) => {
      if (!params?.total) return;
      const progress = Math.min(100, Math.round((params.iterations / params.total) * 100));
      this.callbacks.onStabilizationProgress?.(progress);
      if (progress >= 100) {
        setTimeout(() => this.freezePhysics(), 0);
      }
    });
    network.on('selectNode', (params?: { nodes: IdType[] }) => {
      if (this.selectionEventsSuppressed) return;
      const id = params?.nodes?.find((node): node is string => typeof node === 'string') ?? null;
      this.callbacks.onSelectedNodeChange?.(id);
      this.callbacks.onSelectedEdgeChange?.(null);
      if (id) this.highlightNodeNeighborhood(id, true);
    });
    network.on('selectEdge', (params?: { edges: IdType[] }) => {
      if (this.selectionEventsSuppressed) return;
      const id = params?.edges?.find((edge): edge is string => typeof edge === 'string') ?? null;
      this.callbacks.onSelectedNodeChange?.(null);
      this.callbacks.onSelectedEdgeChange?.(id);
      if (id) this.highlightEdgeNeighborhood(id, true);
    });
    network.on('deselectNode', () => {
      if (this.selectionEventsSuppressed) return;
      if (this.network?.getSelection().edges.length) return;
      this.callbacks.onSelectedNodeChange?.(null);
      this.clearHighlight();
    });
    network.on('deselectEdge', () => {
      if (this.selectionEventsSuppressed) return;
      if (this.network?.getSelection().nodes.length) return;
      this.callbacks.onSelectedEdgeChange?.(null);
      this.clearHighlight();
    });

    this.startStabilization(input.graph.nodes.length);
  }

  private startStabilization(nodeCount: number): void {
    if (!this.network) return;
    this.clearStabilizationTimeout();
    this.callbacks.onSettledChange?.(false);
    this.callbacks.onStabilizationProgress?.(0);
    this.network.off('stabilized', this.settle);
    this.network.once('stabilized', this.settle);
    this.network.setOptions(this.options(nodeCount));
    this.network.stabilize(iterationsFor(nodeCount));
    this.stabilizeTimeout = setTimeout(() => this.freezePhysics(), stabilizationDeadlineFor(nodeCount));
  }

  private freezePhysics(): void {
    if (!this.network) return;
    this.clearStabilizationTimeout();
    this.network.off('stabilized', this.settle);
    this.network.storePositions();
    this.network.stopSimulation();
    this.network.setOptions({ physics: false });
    this.callbacks.onStabilizationProgress?.(100);
    this.callbacks.onSettledChange?.(true);
  }

  private options(nodeCount: number): VisOptions {
    return {
      autoResize: true,
      interaction: {
        hover: false,
        tooltipDelay: 1000000,
        dragNodes: true,
        dragView: true,
        zoomView: true,
        multiselect: false,
        navigationButtons: false,
        keyboard: false
      },
      layout: {
        improvedLayout: nodeCount < 350
      },
      physics: {
        enabled: true,
        solver: 'forceAtlas2Based',
        stabilization: {
          enabled: true,
          iterations: iterationsFor(nodeCount),
          updateInterval: 40,
          fit: true
        },
        forceAtlas2Based: {
          gravitationalConstant: nodeCount > 500 ? -34 : -48,
          centralGravity: 0.014,
          springLength: nodeCount > 500 ? 95 : 120,
          springConstant: 0.055,
          damping: 0.74,
          avoidOverlap: nodeCount > 500 ? 0.25 : 0.45
        },
        adaptiveTimestep: true,
        minVelocity: 2.2,
        maxVelocity: 28
      },
      nodes: {
        chosen: true,
        scaling: { min: 13, max: 42 },
        shapeProperties: { borderRadius: 4 }
      },
      edges: {
        chosen: false,
        selectionWidth: 1
      }
    };
  }

  private toNodes(input: BehaviorGraphRendererInput): VisNode[] {
    return input.graph.nodes.map((node) => this.nodeFor(node, input, node.id === input.selectedId ? 'selected' : 'base'));
  }

  private nodeFor(
    node: BehaviorGraphViewNode,
    input: BehaviorGraphRendererInput,
    mode: NodeVisualMode
  ): VisNode {
    const showManyLabels = input.labelsVisible || input.graph.nodes.length < 90;
    const theme = input.nodeTheme[node.type];
    const dimmed = mode === 'dimmed';
    const selected = mode === 'selected';
    const highlighted = mode === 'highlighted' || selected;
    const showLabel = !dimmed && (showManyLabels || node.degree > 5 || node.type === 'feature' || highlighted);
    const hasLabelContainer = node.type !== 'feature' && showLabel;
    return {
      id: node.id,
      label: showLabel ? node.label : '',
      title: `${theme.label}: ${node.label}${node.detail ? `\n${node.detail}` : ''}`,
      value: Math.max(1, node.degree),
      size: nodeSize(node.degree),
      shape: node.type === 'feature' || !showLabel ? 'dot' : 'box',
      color: {
        background: dimmed ? hexToRgba(theme.fill, DIMMED_NODE_OPACITY) : theme.fill,
        border: dimmed ? hexToRgba(theme.stroke, 0.2) : selected ? '#020617' : theme.stroke,
        highlight: { background: theme.fill, border: '#020617' },
        hover: { background: theme.fill, border: theme.stroke }
      },
      borderWidth: selected ? 5 : highlighted ? 3.5 : 1.5,
      font: {
        color: hasLabelContainer ? contrastTextFor(theme.fill) : '#0f172a',
        size: selected ? 16 : highlighted ? 13 : 12,
        face: 'Inter, ui-sans-serif, system-ui, sans-serif',
        strokeWidth: hasLabelContainer || dimmed ? 0 : 4,
        strokeColor: 'rgba(255,255,255,0.92)'
      },
      margin: hasLabelContainer ? { top: 6, right: 10, bottom: 6, left: 10 } : undefined,
      widthConstraint: hasLabelContainer ? { maximum: 220 } : undefined,
      shadow: !dimmed && (highlighted || node.type === 'feature' || node.degree > 8)
    };
  }

  private toEdges(input: BehaviorGraphRendererInput): VisEdge[] {
    return input.graph.edges.map((edge) => this.edgeFor(edge, input.edgeTheme, 'base'));
  }

  private edgeFor(
    edge: BehaviorGraphEdge,
    edgeTheme: Record<BehaviorGraphEdgeKind, BehaviorGraphEdgeTheme>,
    mode: EdgeVisualMode
  ): VisEdge {
    const important = IMPORTANT_EDGE_KINDS.has(edge.kind);
    const opacity =
      mode === 'selected' ? 0.96 : mode === 'highlighted' ? 0.82 : mode === 'dimmed' ? DIMMED_EDGE_OPACITY : important ? 0.42 : 0.18;
    return {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      title: edge.label ?? edgeTheme[edge.kind].label,
      color: { color: edgeTheme[edge.kind].color, opacity },
      width: mode === 'selected' ? 3 : mode === 'highlighted' ? 2.2 : important ? 1.5 : 0.7,
      dashes: edge.kind === 'contains',
      arrows: { to: { enabled: edge.kind !== 'contains', scaleFactor: 0.45 } },
      smooth: false
    };
  }

  private highlightNodeNeighborhood(nodeId: string, focusSelection: boolean): void {
    if (!this.network || !this.nodes || !this.edges) return;
    if (this.highlightFrame !== null) cancelAnimationFrame(this.highlightFrame);
    this.highlightFrame = requestAnimationFrame(() => {
      const input = this.currentInput;
      if (!this.network || !this.nodes || !this.edges || !input) return;
      const connectedNodes = new Set<IdType>([
        nodeId,
        ...this.network
          .getConnectedNodes(nodeId)
          .filter((id): id is IdType => typeof id === 'string' || typeof id === 'number')
      ]);
      const connectedEdges = new Set<IdType>(this.network.getConnectedEdges(nodeId));
      this.applyFocusMask({ selectedNodeId: nodeId, highlightedNodes: connectedNodes, highlightedEdges: connectedEdges });
      if (focusSelection) this.fitNeighborhood(connectedNodes);
      this.highlighted = { nodes: connectedNodes, edges: connectedEdges };
      this.highlightFrame = null;
    });
  }

  private highlightEdgeNeighborhood(edgeId: string, focusSelection: boolean): void {
    if (!this.network || !this.nodes || !this.edges) return;
    if (this.highlightFrame !== null) cancelAnimationFrame(this.highlightFrame);
    this.highlightFrame = requestAnimationFrame(() => {
      const input = this.currentInput;
      if (!this.network || !this.nodes || !this.edges || !input) return;
      const selectedEdge = input.graph.edges.find((edge) => edge.id === edgeId);
      if (!selectedEdge) return;
      const connectedNodes = new Set<IdType>([selectedEdge.from, selectedEdge.to]);
      const connectedEdges = new Set<IdType>([edgeId]);
      for (const nodeId of [selectedEdge.from, selectedEdge.to]) {
        for (const neighbor of this.network.getConnectedNodes(nodeId)) {
          if (typeof neighbor === 'string' || typeof neighbor === 'number') connectedNodes.add(neighbor);
        }
        for (const edge of this.network.getConnectedEdges(nodeId)) connectedEdges.add(edge);
      }
      this.applyFocusMask({ selectedEdgeId: edgeId, highlightedNodes: connectedNodes, highlightedEdges: connectedEdges });
      if (focusSelection) this.fitNeighborhood(connectedNodes);
      this.highlighted = { nodes: connectedNodes, edges: connectedEdges };
      this.highlightFrame = null;
    });
  }

  private applyFocusMask({
    selectedNodeId,
    selectedEdgeId,
    highlightedNodes,
    highlightedEdges
  }: {
    readonly selectedNodeId?: string;
    readonly selectedEdgeId?: string;
    readonly highlightedNodes: ReadonlySet<IdType>;
    readonly highlightedEdges: ReadonlySet<IdType>;
  }): void {
    if (!this.nodes || !this.edges) return;
    const input = this.currentInput;
    if (!input) return;
    this.nodes.update(
      input.graph.nodes.map((node) => {
        const mode: NodeVisualMode =
          node.id === selectedNodeId ? 'selected' : highlightedNodes.has(node.id) ? 'highlighted' : 'dimmed';
        return this.nodeFor(node, input, mode);
      })
    );
    this.edges.update(
      input.graph.edges.map((edge) => {
        const mode: EdgeVisualMode =
          edge.id === selectedEdgeId ? 'selected' : highlightedEdges.has(edge.id) ? 'highlighted' : 'dimmed';
        return this.edgeFor(edge, input.edgeTheme, mode);
      })
    );
  }

  private fitNeighborhood(nodeIds: ReadonlySet<IdType>): void {
    if (!this.network || nodeIds.size === 0) return;
    this.network.fit({
      nodes: [...nodeIds],
      minZoomLevel: 0.24,
      maxZoomLevel: 1.18,
      animation: { duration: 320, easingFunction: 'easeInOutQuad' }
    });
  }

  private clearHighlight(): void {
    this.clearPendingHighlight();
    this.restoreHighlightBase();
    this.highlighted = { nodes: new Set(), edges: new Set() };
  }

  private restoreHighlightBase(): void {
    if (!this.nodes || !this.edges) return;
    const input = this.currentInput;
    if (!input) return;
    this.nodes.update(input.graph.nodes.map((node) => this.nodeFor(node, input, node.id === input.selectedId ? 'selected' : 'base')));
    this.edges.update(input.graph.edges.map((edge) => this.edgeFor(edge, input.edgeTheme, 'base')));
  }

  private clearPendingWork(): void {
    this.clearPendingHighlight();
    this.clearStabilizationTimeout();
  }

  private clearPendingHighlight(): void {
    if (this.highlightFrame !== null) {
      cancelAnimationFrame(this.highlightFrame);
      this.highlightFrame = null;
    }
  }

  private clearStabilizationTimeout(): void {
    if (this.stabilizeTimeout) {
      clearTimeout(this.stabilizeTimeout);
      this.stabilizeTimeout = null;
    }
  }

  private signatureFor(input: BehaviorGraphRendererInput): string {
    return `${input.graph.nodes.map((node) => node.id).join('|')}::${input.graph.edges.map((edge) => edge.id).join('|')}::labels=${input.labelsVisible}`;
  }
}
