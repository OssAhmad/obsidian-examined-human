export const DASHBOARD_WARNING_KEYS = {
  calendarDataQuality: 'calendar-data-quality',
  engagementUnresolvedTransactions: 'engagement-unresolved-transactions',
  financeUnresolvedTransactions: 'finance-unresolved-transactions',
  nutritionIncompleteMealEvidence: 'nutrition-incomplete-meal-evidence',
  exerciseIncompleteDetails: 'exercise-incomplete-details',
} as const;

const KNOWN_WARNING_KEYS = new Set<string>(Object.values(DASHBOARD_WARNING_KEYS));

export function sanitizeDismissedWarningKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((key): key is string => (
    typeof key === 'string' && KNOWN_WARNING_KEYS.has(key)
  )))];
}
