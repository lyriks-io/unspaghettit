import type { SearchEntityKind } from '../domain/SearchDoc';

/**
 * Presentation metadata per result kind: a human label, an SVG path (24×24,
 * stroke-style to match the app's icon set — multiple sub-paths allowed in one
 * `d`), and a Tailwind text-color accent for the icon. Pure lookup table; no
 * behavior. The component renders `<svg><path d={meta.icon} /></svg>`.
 */
export type SearchKindMeta = {
  readonly label: string;
  readonly icon: string;
  readonly accent: string;
};

const META: Record<SearchEntityKind, SearchKindMeta> = {
  project: {
    label: 'Project',
    icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    accent: 'text-violet-600'
  },
  domain: {
    label: 'Domain',
    icon: 'M12 3 3 8l9 5 9-5z M3 8v8l9 5 9-5V8',
    accent: 'text-fuchsia-600'
  },
  feature: {
    label: 'Feature',
    icon: 'M5 4h11l3 3v13H5z M5 9h14 M5 14h14',
    accent: 'text-brand-600'
  },
  surface: {
    label: 'Surface',
    icon: 'M3 5h18v14H3z M3 9h18',
    accent: 'text-sky-600'
  },
  action: {
    label: 'Action',
    icon: 'M13 3 4 14h7l-1 7 9-11h-7z',
    accent: 'text-emerald-600'
  },
  state: {
    label: 'State',
    icon: 'M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z M5 7v10c0 1.7 3.1 3 7 3s7-1.3 7-3V7',
    accent: 'text-indigo-600'
  },
  rule: {
    label: 'Rule',
    icon: 'M12 3 4 6v6c0 5 4 7 8 9 4-2 8-4 8-9V6z',
    accent: 'text-rose-600'
  },
  invariant: {
    label: 'Invariant',
    icon: 'M6 11h12v9H6z M9 11V8a3 3 0 0 1 6 0v3',
    accent: 'text-red-600'
  },
  effect: {
    label: 'Effect',
    icon: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5 18 18',
    accent: 'text-teal-600'
  },
  parameter: {
    label: 'Parameter',
    icon: 'M9 4v16 M15 4v16 M4 9h16 M4 15h16',
    accent: 'text-amber-600'
  },
  transition: {
    label: 'Transition',
    icon: 'M5 12h13 M13 6l6 6-6 6',
    accent: 'text-cyan-600'
  },
  event: {
    label: 'Event',
    icon: 'M4 12a8 8 0 0 1 16 0 M7 12a5 5 0 0 1 10 0 M11.5 12h1',
    accent: 'text-pink-600'
  },
  entity: {
    label: 'Entity',
    icon: 'M12 3 3 7.5v9L12 21l9-4.5v-9z M3 7.5 12 12l9-4.5 M12 12v9',
    accent: 'text-blue-600'
  },
  'entity-field': {
    label: 'Field',
    icon: 'M4 7h16 M4 12h10 M4 17h7',
    accent: 'text-blue-500'
  },
  'value-set': {
    label: 'Value set',
    icon: 'M4 6h16 M4 12h16 M4 18h16 M2 6h.01 M2 12h.01 M2 18h.01',
    accent: 'text-purple-600'
  },
  resource: {
    label: 'Resource',
    icon: 'M4 5h16v6H4z M4 13h16v6H4z M7.5 8h.01 M7.5 16h.01',
    accent: 'text-lime-600'
  },
  persona: {
    label: 'Persona',
    icon: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0',
    accent: 'text-orange-600'
  },
  scenario: {
    label: 'Scenario',
    icon: 'M9 3v6l-5 8.5A2 2 0 0 0 6 21h12a2 2 0 0 0 2-3.5L15 9V3 M8 3h8',
    accent: 'text-green-600'
  },
  'acceptance-criterion': {
    label: 'Acceptance criterion',
    icon: 'M6 3h9l4 4v14H6z M14 3v4h4 M9 13l2 2 4-4',
    accent: 'text-sky-600'
  }
};

export const searchKindMeta = (kind: SearchEntityKind): SearchKindMeta => META[kind];
