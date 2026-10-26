import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createSchemaV1Database } from '../../test-support/database.mjs';
import { replacementInput } from '../../test-support/daily-reimport.mjs';
import { inspectDailyNote, writeHistoricalDailyNote } from './daily-note.ts';
import { writeHealthCatalog, writeMedicalForm } from './medical.ts';
import { queryDailyHealth, queryMedicalDashboardPage, queryMedicalReport } from '../read-models/medical.ts';

test('five unimported review notes can populate both dashboards through the normal form writers', async () => {
  const db = createSchemaV1Database();
  try {
    for (const entry of [
      { kind: 'person', name: 'EH example person' },
      { kind: 'measurement', name: 'EH example glucose', unit: 'mg/dL', valueType: 'number' },
      { kind: 'measurement', name: 'EH example urine result', valueType: 'qualitative' },
      { kind: 'measurement', name: 'EH example imaging impression', valueType: 'text' },
      { kind: 'procedure', name: 'EH example imaging' },
      { kind: 'medication', name: 'EH example 10 mg tablet', unit: 'tablet' },
      { kind: 'symptom', name: 'EH example headache' },
    ]) writeHealthCatalog(db, { unit: '', valueType: '', aliases: [], ...entry });

    for (const day of ['20', '21', '22', '24', '25']) {
      const date = `2026-10-${day}`;
      const sourceText = await readFile(new URL(`../../docs/examples/medical-dashboard-review/${date}.md`, import.meta.url), 'utf8');
      assert.match(sourceText, /EH form: unimported/);
      const input = { ...replacementInput(date), todayDate: '2026-10-26', sourceText };
      const inspection = inspectDailyNote(db, input);
      assert.equal(inspection.ready, true, `${date}: ${inspection.errors.join('\n')}`);
      writeHistoricalDailyNote(db, input);
      const result = writeMedicalForm(db, input);
      const report = queryMedicalReport(db, result.reportId);
      assert.ok(report.measurements.length >= 1);
      if (day === '20') assert.equal(report.measurements[0].name, 'EH example urine result');
      if (day === '24') assert.equal(report.measurements.length, 3);
    }
    const dashboard = queryMedicalDashboardPage(db, 0);
    assert.equal(dashboard.total, 10);
    assert.equal(dashboard.items.filter(item => item.kind === 'report').length, 5);
    assert.equal(dashboard.items.filter(item => item.kind === 'daily').length, 5);
    assert.equal(queryDailyHealth(db, '2026-10-21').medicationState, 'none');
    assert.equal(queryDailyHealth(db, '2026-10-21').symptomsState, 'none');
    assert.equal(queryDailyHealth(db, '2026-10-24').medicationState, 'unrecorded');
    assert.equal(queryDailyHealth(db, '2026-10-25').symptomsState, 'unrecorded');
  } finally { db.close(); }
});
