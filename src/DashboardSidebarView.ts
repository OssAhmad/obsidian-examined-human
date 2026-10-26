import { moment, Notice, setIcon, WorkspaceLeaf } from 'obsidian';
import { DASHBOARDS, DASHBOARD_SIDEBAR_VIEW_TYPE, STOA_ICON, opensDashboardInNewTab } from './dashboard-navigation.ts';
import { DASHBOARD_COLORS, formatMinutesAsClock } from './events.ts';
import type { DashboardNavigationServices } from './plugin-services.ts';
import { ReadingView } from './refresh/reading-view.ts';

export class DashboardSidebarView extends ReadingView {
  private generation = 0;
  private dashboardButtons = new Map<string, HTMLButtonElement>();

  constructor(leaf: WorkspaceLeaf, private plugin: DashboardNavigationServices) { super(leaf, plugin); }
  getViewType(): string { return DASHBOARD_SIDEBAR_VIEW_TYPE; }
  getDisplayText(): string { return 'Examined Human'; }
  getIcon(): string { return STOA_ICON; }

  async onOpen(): Promise<void> {
    this.startReadingUpdates();
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.updateActiveDashboard()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.updateActiveDashboard()));
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.generation++;
    this.stopReadingUpdates();
    this.dashboardButtons.clear();
    this.contentEl.empty();
  }

  protected async refreshContent(): Promise<void> {
    const generation = ++this.generation;
    this.contentEl.empty();
    this.contentEl.addClass('examined-human-dashboard-sidebar');
    this.dashboardButtons.clear();

    const header = this.contentEl.createDiv({ cls: 'eh-navigation-header' });
    setIcon(header.createSpan({ cls: 'eh-navigation-emblem', attr: { 'aria-hidden': 'true' } }), STOA_ICON);
    header.createEl('h2', { text: 'Examined Human' });
    const refresh = header.createEl('button', {
      cls: 'clickable-icon eh-navigation-refresh',
      attr: { 'aria-label': 'Refresh all EH dashboards', title: 'Refresh all EH dashboards' },
    });
    setIcon(refresh, 'refresh-cw');
    refresh.addEventListener('click', () => {
      refresh.disabled = true;
      void this.plugin.refreshViews().catch(error => new Notice(String(error))).finally(() => { refresh.disabled = false; });
    });

    const summary = this.contentEl.createEl('section', {
      cls: 'eh-navigation-summary', attr: { 'aria-label': 'Recorded activity through today', 'aria-live': 'polite' },
    });
    summary.createDiv({ text: 'Loading recorded activity…', cls: 'eh-navigation-muted' });

    const nav = this.contentEl.createEl('nav', { cls: 'eh-navigation-list', attr: { 'aria-label': 'EH dashboards' } });
    for (const dashboard of DASHBOARDS) {
      const row = nav.createDiv({ cls: 'eh-navigation-row' });
      row.style.setProperty('--eh-dashboard-color', DASHBOARD_COLORS[dashboard.color]);
      const button = row.createEl('button', {
        cls: 'eh-navigation-dashboard',
        attr: { title: `${dashboard.label} · Ctrl/Cmd-click to open a new tab` },
      });
      setIcon(button.createSpan({ cls: 'eh-navigation-icon', attr: { 'aria-hidden': 'true' } }), dashboard.icon);
      button.createSpan({ text: dashboard.label, cls: 'eh-navigation-label' });
      button.addEventListener('click', event => this.openDashboard(dashboard.viewType, opensDashboardInNewTab(event)));
      button.addEventListener('auxclick', event => {
        if (event.button !== 1) return;
        event.preventDefault();
        this.openDashboard(dashboard.viewType, true);
      });
      this.dashboardButtons.set(dashboard.viewType, button);

      const newTab = row.createEl('button', {
        cls: 'eh-navigation-new-tab',
        attr: { 'aria-label': `Open ${dashboard.label} in a new tab`, title: `Open ${dashboard.label} in a new tab` },
      });
      setIcon(newTab, 'arrow-up-right');
      newTab.addEventListener('click', () => this.openDashboard(dashboard.viewType, true));
    }
    this.contentEl.createEl('p', {
      cls: 'eh-navigation-hint', text: 'Select a dashboard to switch in the current EH tab. Use ↗ to open a separate tab.',
    });
    this.updateActiveDashboard();

    try {
      const result = await this.plugin.database.dashboardOverview(this.plugin.settings.databasePath, moment().format('YYYY-MM-DD'));
      if (generation !== this.generation) return;
      const count = (value: number): string => new Intl.NumberFormat().format(value);
      summary.empty();
      const time = summary.createDiv({ cls: 'eh-navigation-time' });
      time.createEl('strong', { text: formatMinutesAsClock(result.totalMinutes) });
      time.createSpan({ text: ' time logged', cls: 'eh-navigation-muted' });
      summary.createDiv({
        cls: 'eh-navigation-counts',
        text: `${count(result.sessionCount)} session${result.sessionCount === 1 ? '' : 's'} across ${count(result.engagementCount)} engagement${result.engagementCount === 1 ? '' : 's'}`,
      });
      summary.createDiv({
        cls: 'eh-navigation-muted',
        text: `${count(result.recordedDays)} recorded day${result.recordedDays === 1 ? '' : 's'} · All time through today`,
      });
      summary.setAttribute('title', 'Imported sessions only; planned sessions are excluded. Time is shown as hours:minutes and sums recorded non-negative durations.');
    } catch (error) {
      if (generation !== this.generation) return;
      summary.empty();
      summary.createDiv({ cls: 'eh-navigation-muted', text: 'Activity summary unavailable. Check the database in EH Settings.' });
      summary.setAttribute('title', error instanceof Error ? error.message : String(error));
    }
  }

  private updateActiveDashboard(): void {
    const type = this.app.workspace.getMostRecentLeaf()?.getViewState().type;
    for (const [viewType, button] of this.dashboardButtons) {
      if (viewType === type) {
        button.addClass('is-active');
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeClass('is-active');
        button.removeAttribute('aria-current');
      }
    }
  }

  private openDashboard(type: typeof DASHBOARDS[number]['viewType'], newTab: boolean): void {
    void this.plugin.openDashboard(type, newTab).catch(error => new Notice(`Could not open dashboard: ${String(error)}`));
  }
}
