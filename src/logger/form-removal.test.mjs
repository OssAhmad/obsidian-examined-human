import assert from 'node:assert/strict';
import test from 'node:test';
import { removeImportedFormBlock } from './form-removal.ts';

function form(kind, identity, lineEnding = '\n') {
  const label = kind[0].toUpperCase() + kind.slice(1);
  return [`#### EH ${label} Form`, identity, '##### Notes', 'keep this bounded', '#### END'].join(lineEnding);
}

test('removes only the exact imported form and preserves other form kinds and private text', () => {
  const daily = form('daily', 'date: 2026-09-12');
  const weekly = form('weekly', 'start date: 2026-09-14');
  const sourceText = `Private preface\n\n${daily}\n\nPrivate middle\n\n${weekly}\nPrivate suffix`;
  const updated = removeImportedFormBlock({ kind: 'daily', expectedFormText: daily, sourceText });
  assert.equal(updated, `Private preface\n\nPrivate middle\n\n${weekly}\nPrivate suffix`);
});

test('preserves CRLF and removes at most the adjacent separator', () => {
  const budget = form('budget', 'period start: 2026-09-01', '\r\n');
  const sourceText = `Before\r\n\r\n${budget}\r\n\r\nAfter\r\n\r\nStill after`;
  assert.equal(
    removeImportedFormBlock({ kind: 'budget', expectedFormText: budget, sourceText }),
    'Before\r\n\r\nAfter\r\n\r\nStill after',
  );
});

test('removes a final form without leaving a duplicate trailing blank line', () => {
  const daily = form('daily', 'date: 2026-09-12');
  assert.equal(
    removeImportedFormBlock({ kind: 'daily', expectedFormText: daily, sourceText: `Before\n\n${daily}` }),
    'Before\n',
  );
});

test('refuses cleanup when the imported form changed after validation', () => {
  const daily = form('daily', 'date: 2026-09-12');
  const changed = daily.replace('keep this bounded', 'edited during import');
  assert.throws(
    () => removeImportedFormBlock({ kind: 'daily', expectedFormText: daily, sourceText: changed }),
    /changed or disappeared/,
  );
});

test('refuses ambiguous duplicate exact blocks', () => {
  const weekly = form('weekly', 'start date: 2026-09-14');
  assert.throws(
    () => removeImportedFormBlock({ kind: 'weekly', expectedFormText: weekly, sourceText: `${weekly}\n${weekly}` }),
    /duplicate copies/,
  );
});
