import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { parseValuationRateEntries, writeHistoricalValuationRates } from './valuation-rates.ts';

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
const schema = await readFile(new URL('../../migrations/000_create_schema_v1.sql', import.meta.url), 'utf8');
const SQL = await initSqlJs({ wasmBinary });

test('valuation rates normalize units, reject duplicates, and retain each dated partial set', () => {
  const errors = [];
  const parsed = parseValuationRateEntries([' usd | 1 ', 'Apartment | 2300000'], errors);
  assert.deepEqual(errors, []);
  assert.deepEqual(parsed.map((rate) => [rate.unitKey, rate.value]), [['USD', 1], ['APARTMENT', 2300000]]);
  const duplicateErrors = [];
  parseValuationRateEntries(['USD | 1', ' usd | 1.1'], duplicateErrors);
  assert.match(duplicateErrors.join('\n'), /duplicate unit/i);

  const db = new SQL.Database();
  try {
    db.run(schema);
    assert.equal(writeHistoricalValuationRates(db, {
      noteDate: '2026-01-06', fileName: '2026-01-06.md', filePath: 'Journal/2026-01-06.md', sourceChecksum: 'jan',
    }, parsed), 2);
    const february = parseValuationRateEntries(['EUR | 1.1'], []);
    assert.equal(writeHistoricalValuationRates(db, {
      noteDate: '2026-02-01', fileName: '2026-02-01.md', filePath: 'Journal/2026-02-01.md', sourceChecksum: 'feb',
    }, february), 1);
    assert.deepEqual(db.exec('SELECT rate_date FROM valuation_rate_sets ORDER BY rate_date')[0].values, [['2026-01-06'], ['2026-02-01']]);
    assert.throws(() => writeHistoricalValuationRates(db, {
      noteDate: '2026-01-06', fileName: 'replacement.md', filePath: 'replacement.md', sourceChecksum: 'replacement',
    }, february), /already finalized/);
  } finally {
    db.close();
  }
});
