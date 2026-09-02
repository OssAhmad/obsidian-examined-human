import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { inspectBudgetForm, writeBudgetForm } from './budget.ts';

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
const schema = await readFile(new URL('../../migrations/000_create_schema_v1.sql', import.meta.url), 'utf8');
const SQL = await initSqlJs({ wasmBinary });

function fixture() {
  const db = new SQL.Database();
  db.run(schema);
  db.run(`
    INSERT INTO engagements (id, name, type_id, status_id) VALUES
      (1, 'Food', (SELECT id FROM engagement_types WHERE code = 'maintenance'), (SELECT id FROM engagement_statuses WHERE code = 'active')),
      (2, 'Freelance', (SELECT id FROM engagement_types WHERE code = 'career'), (SELECT id FROM engagement_statuses WHERE code = 'active'));
    INSERT INTO accounts (id, name, currency) VALUES (1, 'Main Account', 'USD');
  `);
  return db;
}

function form(overrides = '') {
  return `#### EH Budget Form
period start: 2026-09-01
period end: 2026-09-30

##### Budget Targets
ENTRIES:
USD | -300 | Food
USD | 1000 | Freelance

##### Expected Movements
ENTRIES:
2026-09-01 | USD | 1000 | Main Account | Freelance | monthly salary
2026-09-03 | USD | -700 | Main Account | Food | groceries
#### END${overrides}`;
}

test('Budget Form validates resolved names and atomically updates the same dated plan', () => {
  const db = fixture();
  try {
    const input = { fileName: 'September.md', filePath: 'Plans/September.md', sourceText: form(), sourceChecksum: 'one' };
    assert.deepEqual(inspectBudgetForm(db, input), {
      periodStart: '2026-09-01', periodEnd: '2026-09-30', targetCount: 2, expectedMovementCount: 2, updatedExistingBudget: false,
    });
    writeBudgetForm(db, input);
    const replacement = { ...input, fileName: 'Revised September.md', sourceChecksum: 'two', sourceText: form() };
    assert.equal(inspectBudgetForm(db, replacement).updatedExistingBudget, true);
    writeBudgetForm(db, replacement);
    assert.deepEqual(db.exec('SELECT source_file_name, source_checksum FROM budget_plans')[0].values, [['Revised September.md', 'two']]);
    assert.equal(db.exec('SELECT COUNT(*) FROM budget_targets')[0].values[0][0], 2);
    assert.equal(db.exec('SELECT COUNT(*) FROM expected_financial_movements')[0].values[0][0], 2);
  } finally { db.close(); }
});

test('Budget Form preserves non-overlapping periods and rejects partial overlap', () => {
  const db = fixture();
  try {
    writeBudgetForm(db, { fileName: 'September.md', filePath: 'Plans/September.md', sourceText: form(), sourceChecksum: 'one' });
    const october = form().replaceAll('2026-09', '2026-10');
    writeBudgetForm(db, { fileName: 'October.md', filePath: 'Plans/October.md', sourceText: october, sourceChecksum: 'two' });
    assert.equal(db.exec('SELECT COUNT(*) FROM budget_plans')[0].values[0][0], 2);
    const overlap = form().replace('period end: 2026-09-30', 'period end: 2026-10-10');
    assert.throws(() => inspectBudgetForm(db, {
      fileName: 'Overlapping.md', filePath: 'Plans/Overlapping.md', sourceText: overlap, sourceChecksum: 'three',
    }), /overlaps the existing budget/);
  } finally { db.close(); }
});

test('Budget Form rejects periods shorter than four days and expected movements outside the period', () => {
  const db = fixture();
  try {
    assert.throws(() => inspectBudgetForm(db, {
      fileName: 'Short.md', filePath: 'Short.md', sourceChecksum: 'short', sourceText: form().replace('period end: 2026-09-30', 'period end: 2026-09-03'),
    }), /at least four calendar days/);
    assert.throws(() => inspectBudgetForm(db, {
      fileName: 'Outside.md', filePath: 'Outside.md', sourceChecksum: 'outside', sourceText: form().replace('2026-09-03 | USD | -700', '2026-10-03 | USD | -700'),
    }), /outside the budget period/);
  } finally { db.close(); }
});
