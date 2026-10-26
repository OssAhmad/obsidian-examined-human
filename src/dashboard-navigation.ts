import type { Workspace, WorkspaceLeaf } from 'obsidian';

export const DASHBOARD_SIDEBAR_VIEW_TYPE = 'examined-human-dashboard-sidebar';
export const STOA_ICON = 'examined-human-stoa';
export const STOA_ICON_SVG = '<path d="M12 32 50 12 88 32H12ZM17 39h66M12 88h76M17 79h66M24 43v30m17-30v30m18-30v30m17-30v30" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>';

export const DASHBOARDS = [
  { viewType: 'examined-human', label: 'Calendar', icon: 'calendar-clock', color: 'calendar' },
  { viewType: 'examined-human-daily-assessment', label: 'Daily Assessment', icon: 'sun', color: 'daily' },
  { viewType: 'examined-human-weekly-assessment', label: 'Weekly Assessment', icon: 'calendar-range', color: 'weekly' },
  { viewType: 'examined-human-engagement-dashboard', label: 'Engagements', icon: 'target', color: 'engagements' },
  { viewType: 'examined-human-financial-dashboard', label: 'Finance', icon: 'wallet', color: 'finance' },
  { viewType: 'examined-human-nutrition-dashboard', label: 'Nutrition', icon: 'utensils', color: 'nutrition' },
  { viewType: 'examined-human-exercise-dashboard', label: 'Exercise', icon: 'dumbbell', color: 'exercise' },
  { viewType: 'examined-human-records', label: 'Medical', icon: 'heart-pulse', color: 'medical' },
  { viewType: 'examined-human-command-center', label: 'Command Center', icon: 'sliders-horizontal', color: 'commands' },
] as const;

export type DashboardViewType = typeof DASHBOARDS[number]['viewType'];

export function isDashboardViewType(type: string): type is DashboardViewType {
  return DASHBOARDS.some((dashboard) => dashboard.viewType === type);
}

export function opensDashboardInNewTab(event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'button'>): boolean {
  return event.ctrlKey || event.metaKey || event.button === 1;
}

type DashboardWorkspace = Pick<Workspace, 'getMostRecentLeaf' | 'getLeaf' | 'revealLeaf'>;

/** Use the recent main leaf even while the sidebar has keyboard focus. */
export async function navigateToDashboard(
  workspace: DashboardWorkspace,
  type: DashboardViewType,
  newTab = false,
): Promise<WorkspaceLeaf> {
  if (!isDashboardViewType(type)) throw new Error(`Unknown Examined Human dashboard: ${String(type)}`);
  const recent = workspace.getMostRecentLeaf();
  const state = recent?.getViewState();
  // Preserve notes, other plugins, and pinned dashboards when choosing a target.
  const reusable = recent && state && isDashboardViewType(state.type)
    && (!state.pinned || state.type === type);
  const leaf = !newTab && reusable ? recent : workspace.getLeaf('tab');
  if (leaf.getViewState().type !== type) {
    await leaf.setViewState({ type, active: true });
  }
  await workspace.revealLeaf(leaf);
  return leaf;
}
