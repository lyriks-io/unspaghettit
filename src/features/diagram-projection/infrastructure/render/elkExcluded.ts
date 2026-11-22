/**
 * Stands in for elkjs, which mermaid 12 depends on for its ELK layouts.
 *
 * elkjs is EPL-2.0 OR GPL-3.0-or-later. The dashboard draws every diagram with
 * mermaid's dagre layout (mermaidLoader.ts), and the alias in vite.config.ts
 * points mermaid's lazily loaded ELK chunk here, so the built dashboard
 * carries no elkjs: neither on its own nor inside a product that ships it
 * (Lyriks bundles the dashboard and lists only permissive third-party code).
 * If a diagram ever asks for ELK, it says why it cannot.
 */
export default class ElkExcluded {
  constructor() {
    throw new Error('The ELK layout is not bundled: draw this diagram with the dagre layout.');
  }
}
