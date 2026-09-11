import assert from 'node:assert/strict';
import test from 'node:test';
import {
  entryLines,
  findAllEhForms,
  findEhForm,
  findEntriesMarker,
  findFormSection,
  formSections,
  lineEndingFor,
  requireEhForm,
} from './form-document.ts';
import { buildEhForm } from '../../test-support/forms.mjs';

const note = [
  'Private preface',
  '##### Sessions',
  'ENTRIES:',
  'outside | form',
  '',
  '#### EH Daily Form',
  'date: 2026-09-10',
  '',
  '##### Sessions',
  'ENTRIES:',
  '07:00-08:00 | study | Project | inside',
  '',
  '##### Meals',
  '###### Breakfast',
  'ENTRIES:',
  'Eggs | 100',
  '#### END',
  'Private suffix',
].join('\r\n');

test('bounds form and sections without consuming private note text or nested headings', () => {
  const form = requireEhForm(note, 'daily');
  assert.equal(form.body.includes('inside'), true);
  assert.equal(form.body.includes('outside | form'), false);
  assert.equal(form.body.includes('Private suffix'), false);
  assert.deepEqual([...formSections(form.body).keys()], ['sessions', 'meals']);
  const sessions = findFormSection(form.body, 'Sessions');
  assert.deepEqual(entryLines(sessions.content), ['07:00-08:00 | study | Project | inside']);
});

test('extracts multiple complete forms in source order', () => {
  const budget = buildEhForm('budget', { fields: { 'period start': '2026-09-01', 'period end': '2026-09-30' } });
  const forms = findAllEhForms(`${note}\n${budget}`);
  assert.deepEqual(forms.map((form) => form.kind), ['daily', 'budget']);
  assert.equal(forms[0].text.endsWith('#### END'), true);
});

test('preserves CRLF detection and locates a complete-line ENTRIES marker', () => {
  assert.equal(lineEndingFor(note), '\r\n');
  assert.deepEqual(findEntriesMarker('instructional ENTRIES: text\nENTRIES:\nrow'), { start: 28, end: 36 });
});

test('reports missing headings and unmatched form endings separately', () => {
  assert.equal(findEhForm('plain note', 'daily'), null);
  assert.throws(() => requireEhForm('#### EH Daily Form\ndate: 2026-09-10', 'daily'), /no matching #### END/);
});
