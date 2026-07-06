/**
 * Lazy, one-time loader for the Mermaid runtime. Mermaid is heavy and
 * browser-only, so it is dynamic-imported (kept out of the main bundle, same
 * pattern as the vis-network renderer) and initialized exactly once across all
 * diagram instances.
 *
 * The theme is the dashboard's own palette (the same slate/cyan family as the
 * interactive behavior graph), applied through Mermaid's `base` theme so every
 * dialect (statechart, sequence, ER, flowchart, mindmap) reads as one
 * system instead of stock Mermaid.
 */

type MermaidApi = (typeof import('mermaid'))['default'];

const FONT = "'Inter', ui-sans-serif, system-ui, sans-serif";

/** Soft categorical tints for mindmap branches (dark labels stay readable). */
const BRANCH_TINTS = [
  '#cffafe',
  '#dbeafe',
  '#ede9fe',
  '#fce7f3',
  '#ffedd5',
  '#fef3c7',
  '#dcfce7',
  '#ccfbf1'
] as const;

const branchScale = (): Record<string, string> =>
  Object.fromEntries(BRANCH_TINTS.map((tint, index) => [`cScale${index}`, tint]));

let promise: Promise<MermaidApi> | null = null;

export const loadMermaid = (): Promise<MermaidApi> => {
  if (!promise) {
    promise = import('mermaid').then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        // On a parse failure, throw only. Without this, Mermaid appends its
        // error diagram to document.body and the orphaned node quietly grows
        // the page (a phantom window scrollbar).
        suppressErrorRendering: true,
        theme: 'base',
        themeVariables: {
          fontFamily: FONT,
          fontSize: '14px',
          // Default node: light cyan card with a brand border and dark text
          // (statechart states, ER entity headers, kind-less flowchart nodes).
          primaryColor: '#cffafe',
          primaryBorderColor: '#0e7490',
          primaryTextColor: '#164e63',
          secondaryColor: '#ecfeff',
          tertiaryColor: '#f8fafc',
          lineColor: '#64748b',
          textColor: '#334155',
          edgeLabelBackground: '#f1f5f9',
          clusterBkg: '#f8fafc',
          clusterBorder: '#e2e8f0',
          noteBkgColor: '#fef9c3',
          noteBorderColor: '#ca8a04',
          // Sequence: dark actor cards (the behavior graph's feature color)
          // over brand-cyan signals.
          actorBkg: '#0f172a',
          actorBorder: '#020617',
          actorTextColor: '#f8fafc',
          actorLineColor: '#cbd5e1',
          signalColor: '#0e7490',
          signalTextColor: '#334155',
          activationBkgColor: '#a5f3fc',
          activationBorderColor: '#0e7490',
          sequenceNumberColor: '#ffffff',
          // ER attribute rows alternate very softly.
          attributeBackgroundColorOdd: '#ffffff',
          attributeBackgroundColorEven: '#f8fafc',
          // Mindmap branch colors.
          ...branchScale()
        },
        flowchart: { useMaxWidth: true, curve: 'basis', padding: 10, nodeSpacing: 42, rankSpacing: 56 },
        sequence: { useMaxWidth: true, mirrorActors: false, actorMargin: 90, messageMargin: 44 },
        er: { useMaxWidth: true, diagramPadding: 24, entityPadding: 16, minEntityWidth: 140 },
        mindmap: { useMaxWidth: true, padding: 14 },
        state: { useMaxWidth: true }
      });
      return mod.default;
    });
  }
  return promise;
};
