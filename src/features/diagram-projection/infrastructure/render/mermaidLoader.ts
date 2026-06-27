/**
 * Lazy, one-time loader for the Mermaid runtime. Mermaid is heavy and
 * browser-only, so it is dynamic-imported (kept out of the main bundle, same
 * pattern as the vis-network renderer) and initialized exactly once across all
 * diagram instances.
 */

type MermaidApi = (typeof import('mermaid'))['default'];

let promise: Promise<MermaidApi> | null = null;

export const loadMermaid = (): Promise<MermaidApi> => {
  if (!promise) {
    promise = import('mermaid').then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
        flowchart: { useMaxWidth: true }
      });
      return mod.default;
    });
  }
  return promise;
};
