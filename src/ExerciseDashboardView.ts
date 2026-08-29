import { moment, Notice, WorkspaceLeaf } from 'obsidian';
import {
  createDashboardMetric,
  createDashboardPanel,
  DashboardViewBase,
  formatDashboardDate,
  formatDashboardDuration,
  formatDashboardNumber,
  humanizeDashboardCode,
  renderDashboardBars,
  renderDashboardTrend,
} from './DashboardViewBase.ts';
import { renderDismissibleWarning } from './dismissible-warning.ts';
import type ExaminedHumanPlugin from './main.ts';
import type { ExerciseDashboardQueryResult, ExerciseWorkoutRecord } from './examined-human-query.ts';
import { SessionDetailsModal } from './SessionDetailsModal.ts';
import { DASHBOARD_WARNING_KEYS } from './warning-preferences.ts';

export const EXAMINED_HUMAN_EXERCISE_DASHBOARD_VIEW_TYPE = 'examined-human-exercise-dashboard';

export class ExerciseDashboardView extends DashboardViewBase<ExerciseDashboardQueryResult> {
  constructor(leaf: WorkspaceLeaf, plugin: ExaminedHumanPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return EXAMINED_HUMAN_EXERCISE_DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Examined Human — Exercise';
  }

  getIcon(): string {
    return 'dumbbell';
  }

  protected dashboardTitle(): string {
    return 'Exercise';
  }

  protected loadDashboard(startDate: string | null, endDate: string): Promise<ExerciseDashboardQueryResult> {
    return this.plugin.database.exerciseDashboard(this.plugin.settings.databasePath, startDate, endDate);
  }

  protected renderDashboard(result: ExerciseDashboardQueryResult): void {
    this.renderToolbar(`${this.periodLabel()} · Canonical workouts and optional set-level detail`);
    const metrics = this.contentEl.createDiv({ cls: 'examined-human-domain-metrics' });
    createDashboardMetric(metrics, 'Workouts', formatDashboardNumber(result.workoutCount, 0), `${result.trainingDays} training days`);
    createDashboardMetric(metrics, 'Logged time', formatDashboardDuration(result.totalMinutes), 'Canonical workout session duration');
    createDashboardMetric(metrics, 'Detailed workouts', formatDashboardNumber(result.detailedWorkoutCount, 0), `${result.workoutCount - result.detailedWorkoutCount} without exercise rows`);
    createDashboardMetric(metrics, 'Sets', formatDashboardNumber(result.totalSets, 0), `${result.exercises.length} distinct exercises`);
    createDashboardMetric(
      metrics,
      'Measured sets',
      formatDashboardNumber(result.totalSets - result.setsWithoutMeasurements, 0),
      `${result.setsWithoutMeasurements} sets without load, reps, distance, or duration`,
      result.setsWithoutMeasurements > 0 ? 'warning' : 'positive',
    );
    createDashboardMetric(metrics, 'Pain observations', formatDashboardNumber(result.painRecordedSets, 0), 'Set-level pain values recorded');

    if (result.detailedWorkoutCount < result.workoutCount) {
      renderDismissibleWarning(
        this.contentEl,
        this.plugin,
        DASHBOARD_WARNING_KEYS.exerciseIncompleteDetails,
        `${result.workoutCount - result.detailedWorkoutCount} workout sessions have time evidence but no structured exercise details. They remain included in workout and duration totals.`,
        'examined-human-domain-warning',
      );
    }

    const panels = this.contentEl.createDiv({ cls: 'examined-human-domain-panel-grid' });
    this.renderActivityTrend(panels, result);
    this.renderExerciseMix(panels, result);
    this.renderMuscleCoverage(panels, result);
    this.renderPerformanceTable(panels, result);
    this.renderRecentWorkouts(panels, result);
  }

  private renderActivityTrend(container: HTMLElement, result: ExerciseDashboardQueryResult): void {
    const records = result.daily.slice(-20);
    const panel = createDashboardPanel(container, 'Workout duration', 'Latest 20 training days in the selected period');
    renderDashboardTrend(panel, records.map((day) => ({
      label: moment(day.date, 'YYYY-MM-DD', true).format('MMM D'),
      value: day.totalMinutes,
      displayValue: formatDashboardDuration(day.totalMinutes),
      ariaLabel: `${formatDashboardDate(day.date)}, ${day.workoutCount} workouts and ${day.setCount} sets`,
    })));
  }

  private renderExerciseMix(container: HTMLElement, result: ExerciseDashboardQueryResult): void {
    const panel = createDashboardPanel(container, 'Exercise volume', 'Set counts; load volume appears in the performance table');
    renderDashboardBars(panel, result.exercises.slice(0, 14).map((exercise) => ({
      label: exercise.exerciseName,
      value: exercise.setCount,
      displayValue: `${exercise.setCount} sets`,
      detail: `${exercise.workoutCount} workouts · ${humanizeDashboardCode(exercise.category)}`,
    })));
  }

  private renderMuscleCoverage(container: HTMLElement, result: ExerciseDashboardQueryResult): void {
    const panel = createDashboardPanel(container, 'Muscle coverage', 'Exposure sets can count once for each mapped muscle');
    renderDashboardBars(panel, result.muscles.slice(0, 14).map((muscle) => ({
      label: muscle.muscleName,
      value: muscle.exposureSets,
      displayValue: `${muscle.exposureSets} exposures`,
      detail: `${muscle.workoutCount} workouts · ${humanizeDashboardCode(muscle.bodyRegion)} · ${humanizeDashboardCode(muscle.role)}`,
    })));
  }

  private renderPerformanceTable(container: HTMLElement, result: ExerciseDashboardQueryResult): void {
    const panel = createDashboardPanel(container, 'Exercise performance', 'Recorded maxima and additive measurements; units follow the source database', true);
    if (result.exercises.length === 0) {
      panel.createDiv({ cls: 'examined-human-domain-empty', text: 'No structured exercises were recorded in this period.' });
      return;
    }
    const table = panel.createEl('table', { cls: 'examined-human-domain-table' });
    const head = table.createEl('thead').createEl('tr');
    for (const label of ['Exercise', 'Workouts', 'Sets', 'Max weight', 'Max reps', 'Load × reps', 'Distance', 'Timed', 'Last']) {
      head.createEl('th', { text: label });
    }
    const body = table.createEl('tbody');
    for (const exercise of result.exercises.slice(0, 24)) {
      const row = body.createEl('tr');
      row.createEl('td', { text: exercise.exerciseName });
      row.createEl('td', { text: formatDashboardNumber(exercise.workoutCount, 0) });
      row.createEl('td', { text: formatDashboardNumber(exercise.setCount, 0) });
      row.createEl('td', { text: exercise.maxWeight == null ? '—' : formatDashboardNumber(exercise.maxWeight, 2) });
      row.createEl('td', { text: exercise.maxReps == null ? '—' : formatDashboardNumber(exercise.maxReps, 0) });
      row.createEl('td', { text: formatDashboardNumber(exercise.loadVolume, 1) });
      row.createEl('td', { text: formatDashboardNumber(exercise.totalDistance, 2) });
      row.createEl('td', { text: formatDashboardDuration(exercise.measuredDurationMinutes) });
      row.createEl('td', { text: formatDashboardDate(exercise.lastDate) });
    }
  }

  private renderRecentWorkouts(container: HTMLElement, result: ExerciseDashboardQueryResult): void {
    const panel = createDashboardPanel(container, 'Recent workouts', 'Select a workout to open its full session and exercise details', true);
    if (result.recentWorkouts.length === 0) {
      panel.createDiv({ cls: 'examined-human-domain-empty', text: 'No workouts were recorded in this period.' });
      return;
    }
    const table = panel.createEl('table', { cls: 'examined-human-domain-table' });
    const head = table.createEl('thead').createEl('tr');
    for (const label of ['Date', 'Engagement', 'Time', 'Exercises', 'Sets', 'Load × reps', 'Distance', 'Notes']) {
      head.createEl('th', { text: label });
    }
    const body = table.createEl('tbody');
    for (const workout of result.recentWorkouts) {
      const row = body.createEl('tr');
      row.createEl('td', { text: formatDashboardDate(workout.date) });
      const engagement = row.createEl('td');
      const detailsButton = engagement.createEl('button', {
        cls: 'examined-human-domain-table-link',
        text: workout.engagementName,
        attr: {
          'aria-label': `Open exercise details for ${workout.engagementName} on ${formatDashboardDate(workout.date)}`,
        },
      });
      detailsButton.addEventListener('click', () => {
        void this.openWorkoutDetails(workout, detailsButton);
      });
      row.createEl('td', { text: formatDashboardDuration(workout.durationMinutes) });
      row.createEl('td', { text: formatDashboardNumber(workout.exerciseCount, 0) });
      row.createEl('td', { text: formatDashboardNumber(workout.setCount, 0) });
      row.createEl('td', { text: formatDashboardNumber(workout.loadVolume, 1) });
      row.createEl('td', { text: formatDashboardNumber(workout.totalDistance, 2) });
      row.createEl('td', { text: workout.notes ?? '—' });
    }
  }

  private async openWorkoutDetails(workout: ExerciseWorkoutRecord, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      const result = await this.plugin.database.sessionsBetween(
        this.plugin.settings.databasePath,
        workout.date,
        workout.date,
        moment().format('YYYY-MM-DD'),
        false,
      );
      const event = result.events.find((candidate) => candidate.id === String(workout.id));
      if (!event) throw new Error('The selected workout is no longer available. Refresh the dashboard and try again.');
      new SessionDetailsModal(this.app, event).open();
    } catch (error) {
      new Notice(`Could not open workout details: ${error instanceof Error ? error.message : String(error)}`, 9000);
    } finally {
      button.disabled = false;
    }
  }
}
