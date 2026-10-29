import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { createSchemaV1Database } from '../../test-support/database.mjs';
import { requireEhForm, dailyFormSections, formSections, findEntriesMarker, entryLines } from './form-document.ts';
import { inspectDailyNote, writeHistoricalDailyNote } from '../logger/daily-note.ts';
import { parseWeeklyPlan, writeWeeklyPlan } from '../logger/weekly.ts';
import { inspectBudgetForm, writeBudgetForm } from '../logger/budget.ts';
import { inspectMedicalForm, writeMedicalForm } from '../logger/medical.ts';
import { queryRows } from '../read-models/sql.ts';

const root = new URL('../../EH Forms/', import.meta.url);
const date = '2026-10-24';
const thresholds = { mealCalorieLimitKcal: 0, dailyCalorieLimitKcal: 0, minimumProteinG: 0 };
async function translated(file) { return (await readFile(new URL(`fa/${file}`, root), 'utf8')).replace(/\r\n/g, '\n'); }
function kindOf(file) { return ['daily', 'weekly', 'budget', 'medical'].find(kind => file.includes(kind)); }
function render(text, kind) {
  let result = text.replace('<% "unimported" %>', 'unimported').replace('<% tp.file.title %>', date);
  if (kind === 'weekly') result = result.replace(/^start date:.*$/m, `start date: ${date}`).replace(/^end date:.*$/m, 'end date: 2026-10-30');
  if (kind === 'budget') result = result.replace(/^period start:.*$/m, 'period start: 2026-10-01').replace(/^period end:.*$/m, 'period end: 2026-10-31');
  if (kind === 'medical') result = result.replace(/^report:.*$/m, 'report: گزارش آزمایشی');
  return result;
}
function input(sourceText) {
  return { sourceText, noteDate: date, todayDate: '2026-10-29', fileName: `${date}.md`, filePath: `آزمایش/${date}.md`,
    sourceChecksum: 'synthetic-persian-template', pluginVersion: 'test', nutritionThresholds: thresholds };
}
function fill(text, kind, sectionName, rows) {
  const form = requireEhForm(text, kind);
  const sections = kind === 'daily' ? dailyFormSections(form.body) : formSections(form.body);
  const section = sections.get(sectionName.toLowerCase());
  assert.ok(section, sectionName);
  const marker = findEntriesMarker(section.content);
  assert.ok(marker, sectionName);
  const entry = form.bodyStart + section.contentStart + marker.end;
  return text.slice(0, entry) + '\n' + rows.join('\n') + text.slice(entry);
}

test('all eight Persian templates preserve machine headings, keys, commands and empty entry areas', async () => {
  const english = (await readdir(root)).filter(file => file.endsWith('.md')).sort();
  const persian = (await readdir(new URL('fa/', root))).filter(file => file !== 'README.md').sort();
  assert.equal(english.length, 8);
  assert.deepEqual(persian, english);
  for (const file of english) {
    const original = (await readFile(new URL(file, root), 'utf8')).replace(/\r\n/g, '\n');
    const text = await translated(file);
    assert.match(text, /[\u0600-\u06ff]/u, file);
    assert.doesNotMatch(text, /[\u202a-\u202e\u2066-\u2069]/u, `${file}: no bidi control characters in syntax`);
    assert.deepEqual(text.match(/^#{4,6} .+$/gm), original.match(/^#{4,6} .+$/gm), file);
    assert.deepEqual(text.match(/^EH form:.*$/gm), original.match(/^EH form:.*$/gm), file);
    assert.equal((text.match(/^ENTRIES:$/gm) ?? []).length, (original.match(/^ENTRIES:$/gm) ?? []).length, file);
    const keys = source => [...source.matchAll(/^(?:- )?(date|start date|end date|period start|period end|mood|energy|stress|weight_kg|fasted|dieted|notes|is_leisure|score|report|performed|reported|source|report id|Total|Main outcome|Important deadline|Constraint or risk):/gm)].map(match => match[0]);
    assert.deepEqual(keys(text), keys(original), `${file}: machine field keys`);
    const commands = source => [...source.matchAll(/`([A-Z_]+)\s*\|([^`]+)`/g)].filter(match => match[1].includes('_')).map(match => [match[1], match[2].split('|').length]);
    assert.deepEqual(commands(text), commands(original), `${file}: command names and arities`);
    const form = requireEhForm(text, kindOf(file));
    for (const content of form.body.split(/^#{5,6} .+$/m)) {
      if (/^ENTRIES:$/m.test(content)) assert.deepEqual(entryLines(content), [], `${file}: no accidental sample entries`);
    }
    if (file.includes('minimal')) assert.doesNotMatch(text, /> \[!info\]|نمونه|توضیحات بیشتر/um, file);
  }
});

test('all translated explained and minimal templates validate with blank entries after date/title substitution', async () => {
  for (const file of (await readdir(root)).filter(file => file.endsWith('.md'))) {
    const kind = kindOf(file);
    const text = render(await translated(file), kind);
    const db = createSchemaV1Database();
    try {
      if (kind === 'daily') {
        const preview = inspectDailyNote(db, input(text));
        assert.equal(preview.ready, true, `${file}: ${preview.errors.join('\n')}`);
        writeHistoricalDailyNote(db, input(text));
        assert.equal(queryRows(db, 'SELECT * FROM sessions').length, 0, file);
      } else if (kind === 'weekly') {
        const plan = parseWeeklyPlan(db, { ...input(text), weekStartDate: date });
        assert.deepEqual(plan.sessions, [], file);
        assert.deepEqual(plan.commitments, [], file);
      } else if (kind === 'budget') {
        const preview = inspectBudgetForm(db, input(text));
        assert.equal(preview.targetCount, 0, file);
        assert.equal(preview.expectedMovementCount, 0, file);
      } else {
        const preview = inspectMedicalForm(db, input(text));
        assert.equal(preview.title, 'گزارش آزمایشی');
        assert.deepEqual(preview.measurements, [], file);
        assert.deepEqual(preview.procedures, [], file);
      }
    } finally { db.close(); }
  }
});

test('Persian records and notes import unchanged through Daily, Weekly, Budget and Medical templates', async () => {
  for (const minimal of [true, false]) {
    const db = createSchemaV1Database();
    const file = (kind, explained = `${kind} form with explanations`) => `the ${minimal ? `minimal ${kind} form` : explained}.md`;
    try {
      let daily = render(await translated(file('daily')), 'daily');
      daily = daily.replace(/^notes:$/m, 'notes: یادداشت فارسی با نیم‌فاصله');
      daily = fill(daily, 'daily', 'Admin Events', [
        'ENGAGEMENT_CREATE | پژوهش فارسی | practice | active | شرح فعالیت',
        'ACCOUNT_CREATE | حساب نقدی | cash | USD |',
        'FOOD_CREATE | خوراک آزمایشی | نمونه | 100 | 10 | 10 | 2 | 0 | | | توضیح خوراک | [خوراک نمونه]',
        'MEDICATION_CREATE | داروی نمونه | قرص | [داروی آزمایشی]',
        'SYMPTOM_CREATE | سردرد | [درد سر]',
        'MEASUREMENT_CREATE | سنجهٔ آزمایشی | number | واحد نمونه | [نام جایگزین سنجه]',
        'MEASUREMENT_CREATE | یافتهٔ متنی | text | | []',
        'PROCEDURE_CREATE | اقدام نمونه | [اقدام آزمایشی]',
      ]);
      daily = fill(daily, 'daily', 'Sessions', ['09:00-10:00 | پژوهش فارسی | مطالعهٔ متن فارسی']);
      daily = fill(daily, 'daily', 'Medication', ['08:30 | داروی آزمایشی | 1 | صرفاً دادهٔ ساختگی برای آزمون']);
      daily = fill(daily, 'daily', 'Symptoms', ['10:30 | درد سر | ثبت شرح فارسی']);
      daily = fill(daily, 'daily', 'Transactions', ['-12.5 | حساب نقدی | پژوهش فارسی | خرید آزمایشی']);
      daily = daily.replace('###### Breakfast\nis_leisure:\nENTRIES:', '###### Breakfast\nis_leisure:\nENTRIES:\nخوراک نمونه | 100');
      const preview = inspectDailyNote(db, input(daily));
      assert.equal(preview.ready, true, preview.errors.join('\n'));
      writeHistoricalDailyNote(db, input(daily));
      assert.equal(queryRows(db, 'SELECT notes FROM sessions')[0].notes, 'مطالعهٔ متن فارسی');
      assert.equal(queryRows(db, 'SELECT name FROM medications')[0].name, 'داروی نمونه');
      assert.equal(queryRows(db, 'SELECT unit_at_time FROM medication_intakes')[0].unit_at_time, 'قرص');
      assert.equal(queryRows(db, 'SELECT notes FROM symptom_entries')[0].notes, 'ثبت شرح فارسی');
      assert.equal(queryRows(db, 'SELECT description FROM transactions')[0].description, 'خرید آزمایشی');

      let weekly = render(await translated(file('weekly')), 'weekly');
      weekly = weekly.replace('- Main outcome:', '- Main outcome: نتیجهٔ اصلی فارسی')
        .replace('##### Commitments\n', '##### Commitments\n2 | پژوهش فارسی | تکمیل بخش اول\n');
      weekly = weekly.split('\n').map(line => {
        if (!line.startsWith('| Saturday |')) return line;
        const cells = line.split('|'); cells[2] = ' study ; پژوهش فارسی ; برنامهٔ فارسی '; return cells.join('|');
      }).join('\n');
      const plan = parseWeeklyPlan(db, { ...input(weekly), weekStartDate: date });
      assert.equal(plan.mainOutcome, 'نتیجهٔ اصلی فارسی');
      assert.equal(plan.commitments[0].commitmentText, 'تکمیل بخش اول');
      assert.equal(plan.sessions[0].notes, 'برنامهٔ فارسی');
      writeWeeklyPlan(db, { ...input(weekly), weekStartDate: date });

      let budget = render(await translated(file('budget', 'budget form with explanantions')), 'budget');
      budget = fill(budget, 'budget', 'Budget Targets', ['USD | -300 | پژوهش فارسی']);
      budget = fill(budget, 'budget', 'Expected Movements', ['2026-10-28 | USD | -40 | حساب نقدی | پژوهش فارسی | خرید برنامه‌ریزی‌شده']);
      assert.equal(inspectBudgetForm(db, input(budget)).targetCount, 1);
      writeBudgetForm(db, input(budget));
      assert.equal(queryRows(db, 'SELECT description FROM expected_financial_movements')[0].description, 'خرید برنامه‌ریزی‌شده');

      let medical = render(await translated(file('medical')), 'medical');
      medical = fill(medical, 'medical', 'Measurements', ['نام جایگزین سنجه | <5 | صرفاً مقدار ساختگی', 'یافتهٔ متنی | عبارت فارسی با عدم‌قطعیت | یادداشت منبع']);
      medical = fill(medical, 'medical', 'Procedures', ['اقدام آزمایشی | شرح اقدام ثبت‌شده']);
      const result = writeMedicalForm(db, { ...input(medical), filePath: 'گزارش‌ها/گزارش فارسی.md' });
      assert.equal(result.measurementCount, 2);
      assert.equal(queryRows(db, 'SELECT value_text FROM measurements ORDER BY source_ordinal')[1].value_text, 'عبارت فارسی با عدم‌قطعیت');
      assert.equal(queryRows(db, 'SELECT notes FROM report_procedures')[0].notes, 'شرح اقدام ثبت‌شده');
    } finally { db.close(); }
  }
});
