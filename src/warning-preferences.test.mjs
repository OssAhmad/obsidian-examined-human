import test from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARD_WARNING_KEYS, sanitizeDismissedWarningKeys } from './warning-preferences.ts';

test('dismissed warning preferences retain only unique known warning keys', () => {
  assert.deepEqual(sanitizeDismissedWarningKeys([
    DASHBOARD_WARNING_KEYS.calendarDataQuality,
    'unknown-warning',
    DASHBOARD_WARNING_KEYS.calendarDataQuality,
    42,
    DASHBOARD_WARNING_KEYS.financeUnresolvedTransactions,
  ]), [
    DASHBOARD_WARNING_KEYS.calendarDataQuality,
    DASHBOARD_WARNING_KEYS.financeUnresolvedTransactions,
  ]);
  assert.deepEqual(sanitizeDismissedWarningKeys(null), []);
});
