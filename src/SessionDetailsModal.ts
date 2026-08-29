import { App, Modal } from 'obsidian';
import type {
  CalendarEvent,
  ExerciseSetDetails,
  SessionExerciseDetails,
  SessionMilestoneDetails,
} from './events.ts';
import { formatExerciseNumber, formatMinutesAsClock, formatTimeOfDay } from './events.ts';

interface ExerciseTableColumn {
  label: string;
  value: (set: ExerciseSetDetails) => string;
}

export class SessionDetailsModal extends Modal {
  constructor(app: App, private event: CalendarEvent) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('examined-human-session-modal');
    contentEl.createEl('h2', { text: this.event.title });

    if (this.event.dataWarning) {
      const warning = contentEl.createDiv({ cls: 'examined-human-data-warning' });
      warning.createEl('strong', { text: 'Database correction required' });
      warning.createDiv({ text: this.event.dataWarning });
    }

    if (this.event.planningWarnings && this.event.planningWarnings.length > 0) {
      const warning = contentEl.createDiv({ cls: 'examined-human-planning-warning' });
      warning.createEl('strong', { text: 'Planning details' });
      const list = warning.createEl('ul');
      for (const message of this.event.planningWarnings) list.createEl('li', { text: message });
    }

    const details = contentEl.createEl('dl', { cls: 'examined-human-session-details' });
    this.addDetail(details, 'Date', this.event.date);
    const timeSuffix = this.event.timeEstimated ? ' (estimated display slot)' : '';
    this.addDetail(
      details,
      'Time',
      `${formatTimeOfDay(this.event.startMinutes)}–${formatTimeOfDay(this.event.endMinutes)}${timeSuffix}`,
    );
    this.addDetail(details, 'Duration', formatMinutesAsClock(this.event.durationMinutes));
    this.addDetail(details, 'Session type', this.event.sessionType);
    this.addDetail(details, 'Engagement', this.event.engagementName);
    this.addDetail(details, 'Engagement type', this.event.engagementType || '—');
    this.addDetail(details, 'Source', this.event.sourceKind === 'planned' ? 'Planned journal note' : 'Imported Examined Human data');

    if (this.event.sessionType.trim().toLowerCase() === 'exercise' || this.event.exerciseDetails) {
      this.renderExerciseDetails(contentEl);
    }

    if (this.event.milestoneDetails && this.event.milestoneDetails.length > 0) {
      this.renderMilestoneDetails(contentEl);
    }

    contentEl.createEl('h3', { text: 'Notes' });
    contentEl.createDiv({ cls: 'examined-human-session-notes', text: this.event.notes?.trim() || 'No notes recorded.' });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addDetail(parent: HTMLElement, label: string, value: string): void {
    parent.createEl('dt', { text: label });
    parent.createEl('dd', { text: value });
  }

  private renderExerciseDetails(parent: HTMLElement): void {
    parent.createEl('h3', { text: 'Exercises' });
    if (!this.event.exerciseDetails) {
      parent.createDiv({
        cls: 'examined-human-exercise-empty',
        text: this.event.sourceKind === 'planned'
          ? 'Planned exercise targets are not imported yet.'
          : 'Exercise details are unavailable in this database.',
      });
      return;
    }
    if (this.event.exerciseDetails.length === 0) {
      parent.createDiv({ cls: 'examined-human-exercise-empty', text: 'No exercises are attached to this session.' });
      return;
    }

    const list = parent.createDiv({ cls: 'examined-human-exercise-list' });
    for (const exercise of this.event.exerciseDetails) this.renderExercise(list, exercise);
  }

  private renderExercise(parent: HTMLElement, exercise: SessionExerciseDetails): void {
    const card = parent.createEl('section', { cls: 'examined-human-exercise-card' });
    const heading = card.createDiv({ cls: 'examined-human-exercise-heading' });
    heading.createEl('h4', { text: exercise.name || 'Unnamed exercise' });
    if (exercise.category) heading.createSpan({ cls: 'examined-human-exercise-category', text: exercise.category });

    if (exercise.sets.length === 0) {
      card.createDiv({ cls: 'examined-human-exercise-empty', text: 'No sets recorded.' });
      return;
    }

    const columns = this.exerciseColumns(exercise.sets);
    const wrapper = card.createDiv({ cls: 'examined-human-exercise-table-wrap' });
    const table = wrapper.createEl('table', { cls: 'examined-human-exercise-table' });
    const headerRow = table.createEl('thead').createEl('tr');
    for (const column of columns) headerRow.createEl('th', { text: column.label });

    const body = table.createEl('tbody');
    for (const set of exercise.sets) {
      const row = body.createEl('tr');
      for (const column of columns) row.createEl('td', { text: column.value(set) });
    }
  }

  private renderMilestoneDetails(parent: HTMLElement): void {
    parent.createEl('h3', { text: 'Milestones' });
    const list = parent.createDiv({ cls: 'examined-human-milestone-list' });
    for (const milestone of this.event.milestoneDetails ?? []) {
      this.renderMilestone(list, milestone);
    }
  }

  private renderMilestone(parent: HTMLElement, milestone: SessionMilestoneDetails): void {
    const card = parent.createEl('section', { cls: 'examined-human-milestone-card' });
    const heading = card.createDiv({ cls: 'examined-human-milestone-heading' });
    heading.createEl('h4', { text: milestone.name || 'Unnamed milestone' });
    if (milestone.date) heading.createSpan({ cls: 'examined-human-milestone-date', text: milestone.date });

    if (milestone.measurements.length > 0) {
      const measurements = card.createEl('dl', { cls: 'examined-human-milestone-measurements' });
      for (const measurement of milestone.measurements) {
        measurements.createEl('dt', { text: measurement.metricName || 'Measurement' });
        const value = measurement.measurementDate
          ? `${measurement.metricValue || '-'} | ${measurement.measurementDate}`
          : measurement.metricValue || '-';
        measurements.createEl('dd', { text: value });
        if (measurement.notes) {
          measurements.createEl('dt', { text: 'Measurement notes' });
          measurements.createEl('dd', { text: measurement.notes });
        }
      }
    }
    if (milestone.notes) card.createDiv({ cls: 'examined-human-milestone-notes', text: milestone.notes });
  }

  private exerciseColumns(sets: ExerciseSetDetails[]): ExerciseTableColumn[] {
    const columns: ExerciseTableColumn[] = [{
      label: 'Set',
      value: (set) => set.setNumber == null ? '—' : formatExerciseNumber(set.setNumber),
    }];
    if (sets.some((set) => set.weight != null)) {
      columns.push({ label: 'Weight', value: (set) => this.exerciseValue(set.weight) });
    }
    if (sets.some((set) => set.reps != null)) {
      columns.push({ label: 'Reps', value: (set) => this.exerciseValue(set.reps) });
    }
    if (sets.some((set) => set.distance != null)) {
      columns.push({ label: 'Distance', value: (set) => this.exerciseValue(set.distance) });
    }
    if (sets.some((set) => set.durationMinutes != null)) {
      columns.push({
        label: 'Duration',
        value: (set) => set.durationMinutes == null ? '—' : `${formatExerciseNumber(set.durationMinutes)} min`,
      });
    }
    if (sets.some((set) => set.notes)) {
      columns.push({ label: 'Notes', value: (set) => set.notes || '—' });
    }
    return columns;
  }

  private exerciseValue(value: number | null): string {
    return value == null ? '—' : formatExerciseNumber(value);
  }
}
