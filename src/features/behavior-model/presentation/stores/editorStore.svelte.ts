import { browser } from '$app/environment';
import type {
  ActionId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import type { SurfacePanelTab } from '$features/maturity/domain/MaturityReport';
import { emit } from '$shared/events/eventBus';

export type TopLevelTab =
  | 'build'
  | 'resources'
  | 'data'
  | 'events'
  | 'transitions'
  | 'invariants';
export type InsightTab = 'simulator' | 'maturity' | 'implementation';

const RAIL_TAB_KEY = 'unspa:editor:rail-tab';
const RAIL_COLLAPSED_KEY = 'unspa:editor:rail-collapsed';

const readRailTab = (): InsightTab => {
  if (!browser) return 'maturity';
  const v = window.localStorage.getItem(RAIL_TAB_KEY);
  return v === 'simulator' || v === 'maturity' || v === 'implementation' ? v : 'maturity';
};

const readRailCollapsed = (): boolean => {
  if (!browser) return false;
  return window.localStorage.getItem(RAIL_COLLAPSED_KEY) === '1';
};

/**
 * Editor-wide UI state. Externalized so deep links (e.g. clicking a
 * maturity issue) can drive surface selection, action expansion, and
 * tab switching from anywhere in the app.
 */
class EditorStore {
  selectedSurfaceId = $state<SurfaceId | null>(null);
  selectedCapabilityId = $state<ActionId | null>(null);
  surfacePanelTab = $state<SurfacePanelTab>('actions');
  topLevelTab = $state<TopLevelTab>('build');
  railTab = $state<InsightTab>(readRailTab());
  railCollapsed = $state<boolean>(readRailCollapsed());

  /**
   * Focus target the editor observer scrolls into view and pulses. Set by
   * `navigateTo` whenever a deep-link is triggered. The token is bumped every
   * call so re-clicking the same anchor still fires the effect.
   */
  focusTarget = $state<string | null>(null);
  focusToken = $state(0);

  selectSurface(id: SurfaceId | null): void {
    this.selectedSurfaceId = id;
    this.selectedCapabilityId = null;
    if (id) emit('editor.surface.selected', { surfaceId: String(id) });
  }

  selectCapability(id: ActionId | null): void {
    this.selectedCapabilityId = id;
  }

  setSurfacePanelTab(tab: SurfacePanelTab): void {
    this.surfacePanelTab = tab;
    emit('editor.panel.switched', { tab });
  }

  setTopLevelTab(tab: TopLevelTab): void {
    this.topLevelTab = tab;
  }

  setRailTab(tab: InsightTab): void {
    this.railTab = tab;
    if (browser) window.localStorage.setItem(RAIL_TAB_KEY, tab);
  }

  setRailCollapsed(collapsed: boolean): void {
    this.railCollapsed = collapsed;
    if (browser) window.localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? '1' : '0');
  }

  toggleRail(): void {
    this.setRailCollapsed(!this.railCollapsed);
  }

  openRail(tab: InsightTab): void {
    this.setRailTab(tab);
    this.setRailCollapsed(false);
  }

  /**
   * Single entry point for deep-link navigation. Switches surface, expands a
   * action, opens the right SurfacePanel tab, and jumps back to the
   * Build top-level tab so the changes are visible.
   */
  navigateTo(target: {
    surfaceId?: SurfaceId | string;
    actionId?: ActionId | string;
    surfacePanelTab?: SurfacePanelTab;
  }): void {
    this.topLevelTab = 'build';
    if (target.surfaceId) {
      this.selectSurface(target.surfaceId as SurfaceId);
    }
    if (target.actionId) {
      this.selectCapability(target.actionId as ActionId);
    }
    if (target.surfacePanelTab) {
      this.surfacePanelTab = target.surfacePanelTab;
    }

    // Most specific target first → most useful to scroll/highlight.
    if (target.actionId) {
      this.focusTarget = `action:${target.actionId}`;
    } else if (target.surfaceId && target.surfacePanelTab) {
      this.focusTarget = `tab:${target.surfaceId}:${target.surfacePanelTab}`;
    } else if (target.surfaceId) {
      this.focusTarget = `surface:${target.surfaceId}`;
    } else if (target.surfacePanelTab) {
      this.focusTarget = `tab:${target.surfacePanelTab}`;
    }
    this.focusToken += 1;
  }

  reset(): void {
    this.selectedSurfaceId = null;
    this.selectedCapabilityId = null;
    this.surfacePanelTab = 'actions';
    this.topLevelTab = 'build';
  }
}

export const editorStore = new EditorStore();
