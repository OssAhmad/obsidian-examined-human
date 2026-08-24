import { moment, WorkspaceLeaf } from 'obsidian';
import {
  createDashboardMetric,
  createDashboardPanel,
  DashboardViewBase,
  formatDashboardDate,
  formatDashboardNumber,
  formatDashboardPercent,
  humanizeDashboardCode,
  renderDashboardBars,
  renderDashboardTrend,
} from './DashboardViewBase.ts';
import { renderDismissibleWarning } from './dismissible-warning.ts';
import type EqhCalendarPlugin from './main.ts';
import type { NutritionDashboardQueryResult, NutritionDailyRecord } from './eqh-query.ts';
import { DASHBOARD_WARNING_KEYS } from './warning-preferences.ts';

export const EQH_NUTRITION_DASHBOARD_VIEW_TYPE = 'eqh-nutrition-dashboard';

function average(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value != null && Number.isFinite(value));
  return available.length > 0 ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
}

function latestDailyRecords(records: NutritionDailyRecord[]): NutritionDailyRecord[] {
  return records.slice(-24);
}

export class NutritionDashboardView extends DashboardViewBase<NutritionDashboardQueryResult> {
  constructor(leaf: WorkspaceLeaf, plugin: EqhCalendarPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return EQH_NUTRITION_DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'EH Dashboards — Nutrition';
  }

  getIcon(): string {
    return 'utensils';
  }

  protected dashboardTitle(): string {
    return 'Nutrition';
  }

  protected loadDashboard(startDate: string | null, endDate: string): Promise<NutritionDashboardQueryResult> {
    return this.plugin.database.nutritionDashboard(this.plugin.settings.databasePath, startDate, endDate);
  }

  protected renderDashboard(result: NutritionDashboardQueryResult): void {
    this.renderToolbar(`${this.periodLabel()} · Effective daily nutrition and 10% leisure-meal target`);
    const avgCalories = average(result.daily.map((day) => day.calories));
    const avgProtein = average(result.daily.map((day) => day.proteinG));
    const adherenceRate = result.dietedEvaluatedDays > 0
      ? result.dietedDays / result.dietedEvaluatedDays
      : null;
    const debt = result.leisureDebt;
    const metrics = this.contentEl.createDiv({ cls: 'eqh-domain-metrics' });
    createDashboardMetric(metrics, 'Recorded days', formatDashboardNumber(result.recordedDays, 0), `${result.missingCaloriesDays} without calories`);
    createDashboardMetric(metrics, 'Average calories', avgCalories == null ? '—' : `${formatDashboardNumber(avgCalories, 0)} kcal`, 'Days with a calorie value');
    createDashboardMetric(metrics, 'Average protein', avgProtein == null ? '—' : `${formatDashboardNumber(avgProtein, 1)} g`, 'Days with a protein value');
    createDashboardMetric(
      metrics,
      'Diet adherence',
      formatDashboardPercent(adherenceRate),
      `${result.dietedDays} of ${result.dietedEvaluatedDays} evaluable days`,
      adherenceRate != null && adherenceRate >= 0.8 ? 'positive' : undefined,
    );
    createDashboardMetric(
      metrics,
      'Leisure-meal rate',
      formatDashboardPercent(debt.leisureRate),
      `${debt.leisureMeals} of ${debt.countedMeals} assessed meal opportunities`,
      debt.leisureRate != null && debt.leisureRate > debt.targetRate ? 'warning' : 'positive',
    );
    createDashboardMetric(
      metrics,
      'Leisure debt',
      debt.assessedDays > 0 ? `${formatDashboardNumber(debt.debtMeals, 1)} meals` : '—',
      debt.assessedDays > 0 ? `${debt.balanceDays} fully dieted days to reach 10%` : 'No schema-v5 meal assessments yet',
      debt.debtMeals > 0 ? 'negative' : debt.assessedDays > 0 ? 'positive' : undefined,
    );

    if (debt.assessedDays < result.recordedDays) {
      renderDismissibleWarning(
        this.contentEl,
        this.plugin,
        DASHBOARD_WARNING_KEYS.nutritionIncompleteMealEvidence,
        `Leisure debt uses ${debt.assessedDays} schema-v5 assessed meal days; ${result.recordedDays - debt.assessedDays} nutrition days do not contain meal-level leisure evidence. Diet adherence still uses their recorded dieted value.`,
        'eqh-domain-warning',
      );
    }

    const panels = this.contentEl.createDiv({ cls: 'eqh-domain-panel-grid' });
    this.renderCalorieTrend(panels, result);
    this.renderProteinTrend(panels, result);
    this.renderMealMix(panels, result);
    this.renderFoods(panels, result);
    this.renderRecentDays(panels, result);
  }

  private renderCalorieTrend(container: HTMLElement, result: NutritionDashboardQueryResult): void {
    const records = latestDailyRecords(result.daily).filter((day) => day.calories != null);
    const panel = createDashboardPanel(container, 'Calories', 'Latest 24 recorded days in the selected period');
    renderDashboardTrend(panel, records.map((day) => ({
      label: moment(day.date, 'YYYY-MM-DD', true).format('MMM D'),
      value: day.calories ?? 0,
      displayValue: `${formatDashboardNumber(day.calories ?? 0, 0)}`,
      ariaLabel: `${formatDashboardDate(day.date)}, calories`,
    })));
  }

  private renderProteinTrend(container: HTMLElement, result: NutritionDashboardQueryResult): void {
    const records = latestDailyRecords(result.daily).filter((day) => day.proteinG != null);
    const panel = createDashboardPanel(container, 'Protein', 'Latest 24 recorded days in the selected period');
    renderDashboardTrend(panel, records.map((day) => ({
      label: moment(day.date, 'YYYY-MM-DD', true).format('MMM D'),
      value: day.proteinG ?? 0,
      displayValue: `${formatDashboardNumber(day.proteinG ?? 0, 0)} g`,
      ariaLabel: `${formatDashboardDate(day.date)}, protein`,
    })));
  }

  private renderMealMix(container: HTMLElement, result: NutritionDashboardQueryResult): void {
    const panel = createDashboardPanel(container, 'Meal-type calories', 'Structured schema-v5 food rows; snacks affect daily calories but not leisure count');
    renderDashboardBars(panel, result.mealTypes.map((meal) => ({
      label: humanizeDashboardCode(meal.mealType),
      value: meal.calories,
      displayValue: `${formatDashboardNumber(meal.calories, 0)} kcal`,
      detail: `${meal.itemCount} foods · ${formatDashboardNumber(meal.proteinG, 1)} g protein · ${meal.leisureMeals} leisure`,
    })));
  }

  private renderFoods(container: HTMLElement, result: NutritionDashboardQueryResult): void {
    const panel = createDashboardPanel(container, 'Top foods by calories', 'Structured food items in the selected period');
    renderDashboardBars(panel, result.topFoods.slice(0, 12).map((food) => ({
      label: food.food,
      value: food.calories,
      displayValue: `${formatDashboardNumber(food.calories, 0)} kcal`,
      detail: `${food.timesLogged} logs · ${formatDashboardNumber(food.proteinG, 1)} g protein`,
    })));
  }

  private renderRecentDays(container: HTMLElement, result: NutritionDashboardQueryResult): void {
    const records = [...result.daily].reverse().slice(0, 20);
    const panel = createDashboardPanel(container, 'Recent nutrition days', 'Effective values prefer schema-v5 assessment snapshots', true);
    if (records.length === 0) {
      panel.createDiv({ cls: 'eqh-domain-empty', text: 'No nutrition days were recorded in this period.' });
      return;
    }
    const table = panel.createEl('table', { cls: 'eqh-domain-table' });
    const head = table.createEl('thead').createEl('tr');
    for (const label of ['Date', 'Calories', 'Protein', 'Dieted', 'Leisure meals', 'Evidence']) head.createEl('th', { text: label });
    const body = table.createEl('tbody');
    for (const day of records) {
      const row = body.createEl('tr');
      row.createEl('td', { text: formatDashboardDate(day.date) });
      row.createEl('td', { text: day.calories == null ? '—' : `${formatDashboardNumber(day.calories, 0)} kcal` });
      row.createEl('td', { text: day.proteinG == null ? '—' : `${formatDashboardNumber(day.proteinG, 1)} g` });
      row.createEl('td', { text: day.dieted == null ? '—' : day.dieted === 1 ? 'Yes' : 'No' });
      row.createEl('td', { text: day.leisureMeals == null ? '—' : `${day.leisureMeals} / ${day.countedMeals ?? 0}` });
      row.createEl('td', { text: humanizeDashboardCode(day.dietedSource) });
    }
  }
}
