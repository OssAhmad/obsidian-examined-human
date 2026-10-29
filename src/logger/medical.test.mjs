import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { SQL, createSchemaV1Database, schemaV1Sql } from '../../test-support/database.mjs';
import { inspectMedicalForm, writeMedicalForm, writeHealthCatalog, healthFields } from './medical.ts';
import { inspectDailyHealth } from './daily-health.ts';
import { queryRows } from '../read-models/sql.ts';
import { queryRecordsPage, queryMedicalReport, hasMedicalSchema } from '../read-models/medical.ts';
import { runDatabaseTransaction } from './persistence/sqlite-transaction.ts';
import { formsInText } from '../form-discovery.ts';
import { fileHasCompletedImportableForms } from '../form-status.ts';
import { writeHistoricalDailyNote, inspectDailyNote } from './daily-note.ts';
import { replacementDatabase, replacementInput } from '../../test-support/daily-reimport.mjs';

export function seedHealth(db) {
  for (const input of [
    { kind: 'measurement', name: 'Glucose', unit: 'mg/dL', valueType: 'number', aliases: ['Sugar'] },
    { kind: 'measurement', name: 'Urine blood', valueType: 'qualitative' },
    { kind: 'measurement', name: 'Impression', valueType: 'text' },
    { kind: 'procedure', name: 'Ultrasound' },
    { kind: 'medication', name: 'Example 10 mg tablet', unit: 'tablet' },
    { kind: 'symptom', name: 'Headache', aliases: ['Head pain'] },
  ]) writeHealthCatalog(db, { unit: '', valueType: 'number', aliases: [], ...input });
}
export function medicalInput(overrides = {}) {
  return { filePath: 'Medical/report.md', sourceChecksum: 'reviewed-source', pluginVersion: 'test', sourceText: `
#### EH Medical Form
report: Example report
performed: 2026-10-18 to 2026-10-20
reported: 2026-10-21
source:
##### Measurements
ENTRIES:
Sugar | <92 | First result; original report retained.
Glucose | 96 | Second result on another date.
Urine blood | no | Source says negative.
Impression | Written finding with uncertainty. | Verbatim impression.
##### Procedures
ENTRIES:
Ultrasound | Documented procedure.
#### END`, ...overrides };
}
test('medical schema upgrade preserves legacy IDs, results and references with valid foreign keys', async () => {
  const db = new SQL.Database();
  try {
    db.run(schemaV1Sql.split('-- Run inside LoggerService')[0] + 'COMMIT; PRAGMA foreign_keys=ON;');
    db.run("INSERT INTO reports VALUES (8,'2020-01-01','lab',NULL,'Old report','old.pdf'); INSERT INTO markers VALUES (7,'Legacy test','mg/dL','old range'); INSERT INTO measurements VALUES (6,8,7,12.5,'old notes','specific range','H');");
    const sql = await readFile(new URL('../../migrations/006_add_medical_forms_schema_v1.sql', import.meta.url), 'utf8');
    runDatabaseTransaction(db, db => db.run(sql));
    assert.equal(hasMedicalSchema(db), true);
    assert.deepEqual(queryRows(db, 'SELECT id,report_id,marker_id,value,value_text,unit_at_time,notes,reference_range_at_time,flag FROM measurements'), [{ id:6, report_id:8, marker_id:7, value:12.5, value_text:'12.5', unit_at_time:'mg/dL', notes:'old notes', reference_range_at_time:'specific range', flag:'H' }]);
    assert.equal(queryRows(db, 'PRAGMA user_version')[0].user_version, 1);
  } finally { db.close(); }
});
test('medical import preserves qualitative/text/limit values, repeated observations and units; preview is read-only', () => {
  const db = createSchemaV1Database();
  try {
    seedHealth(db); const input = medicalInput(); const before = db.export();
    const preview = inspectMedicalForm(db, input);
    assert.equal(preview.measurements.length, 4); assert.deepEqual(db.export(), before);
    const result = writeMedicalForm(db, input);
    const stored = queryMedicalReport(db, result.reportId);
    assert.equal(stored.measurements[0].comparator, '<');
    assert.equal(stored.measurements[0].unit_at_time, 'mg/dL');
    assert.equal(stored.measurements[2].value, null); assert.equal(stored.measurements[2].value_text, 'no');
    assert.equal(stored.measurements[3].value_text, 'Written finding with uncertainty.');
    assert.equal(queryRecordsPage(db, 0).forms[0].kind, 'Medical');
    writeHealthCatalog(db, { kind:'measurement', id:1, name:'Glucose', unit:'different unit', valueType:'number', aliases:[] });
    assert.equal(queryMedicalReport(db, result.reportId).measurements[0].unit_at_time, 'mg/dL');
  } finally { db.close(); }
});
test('reimport replaces only one owned report, removes omissions and retains catalog and other reports', () => {
  const db = createSchemaV1Database();
  try {
    seedHealth(db); const input = medicalInput(); const first = writeMedicalForm(db, input);
    writeMedicalForm(db, medicalInput({ filePath:'Medical/other.md' }));
    assert.throws(() => writeMedicalForm(db, input), /explicitly confirm/);
    const replacement = { ...input, replaceExisting:true, sourceText: input.sourceText.replace(/Sugar \|[^\n]*\nGlucose \|[^\n]*\nUrine blood \|[^\n]*\nImpression \|[^\n]*/, 'none').replace('Ultrasound | Documented procedure.', '') };
    const result = writeMedicalForm(db, replacement);
    assert.equal(result.reportId, first.reportId); assert.equal(result.replaced, true);
    assert.equal(queryMedicalReport(db, first.reportId).measurements.length, 0);
    assert.equal(queryRows(db, 'SELECT * FROM measurements').length, 4);
    assert.equal(queryRows(db, 'SELECT * FROM markers').length, 3);
    assert.equal(queryMedicalReport(db, first.reportId).report.measurements_state, 'none');
    assert.equal(queryMedicalReport(db, first.reportId).report.procedures_state, 'unrecorded');
    const moved = { ...replacement, filePath:'Moved/report.md', sourceText:replacement.sourceText.replace('report: Example report', `report: Corrected title\nreport id: ${first.reportId}`) };
    assert.equal(writeMedicalForm(db, moved).reportId, first.reportId);
  } finally { db.close(); }
});
test('malformed or ambiguous medical entries fail without changing stored reports', () => {
  const db = createSchemaV1Database();
  try {
    seedHealth(db); const input=medicalInput(); writeMedicalForm(db,input);
    for (const text of [input.sourceText.replace('Sugar | <92', 'Unknown | <92'), input.sourceText.replace('Sugar | <92','Sugar | negative'), input.sourceText.replace('reported: 2026-10-21','reported: 2026-02-30'), input.sourceText.replace('ENTRIES:\nSugar','ENTRIES:\nnone\nSugar'), input.sourceText.replace('##### Measurements','##### Measurements\nENTRIES:\n##### Measurements')]) {
      const before = queryRows(db, 'SELECT * FROM measurements');
      assert.throws(() => writeMedicalForm(db, { ...input, replaceExisting:true, sourceText:text }));
      assert.deepEqual(queryRows(db, 'SELECT * FROM measurements'), before);
    }
  } finally { db.close(); }
});
test('Daily health requires canonical names, exact time and explicit none; replacement removes only that day', () => {
  const db = replacementDatabase();
  try {
    seedHealth(db); writeMedicalForm(db,medicalInput()); const input=replacementInput();
    const body='##### Medication\nENTRIES:\n08:30 | Example 10 mg tablet | 1 | oral\n##### Symptoms\nENTRIES:\n10:30 | Head pain | affected work';
    input.sourceText=input.sourceText.replace('#### END',body+'\n#### END');
    assert.equal(inspectDailyNote(db,input).ready,true);
    writeHistoricalDailyNote(db,input);
    const page=queryRecordsPage(db,0); assert.equal(page.days.length,1); assert.match(page.days[0].medication[0], /1 tablet/); assert.match(page.days[0].symptoms[0], /Headache/);
    assert.throws(() => inspectDailyHealth(db, body.replace('08:30','unknown')), /HH:mm/);
    const replacement={ ...input, replaceExisting:true, sourceText:input.sourceText.replace('08:30 | Example 10 mg tablet | 1 | oral','none').replace('10:30 | Head pain | affected work','') };
    writeHistoricalDailyNote(db,replacement);
    assert.equal(queryRecordsPage(db,0).days[0].medicationState,'none');
    assert.equal(queryRecordsPage(db,0).days[0].symptomsState,'unrecorded');
    assert.equal(queryRows(db,'SELECT * FROM medication_intakes').length,0);
    assert.equal(queryRows(db,'SELECT * FROM medical_report_imports').length,1);
    assert.equal(queryRows(db,'SELECT * FROM measurements').length,4);
  } finally { db.close(); }
});
test('Medical discovery and mixed-file completion include medical receipts; escaped fields preserve text', () => {
  const input=medicalInput();
  const forms=formsInText({ name:'report.md',path:input.filePath },input.sourceText);
  assert.equal(forms[0].kind,'medical');
  assert.equal(fileHasCompletedImportableForms(forms,input.filePath,[],[]),false);
  assert.equal(fileHasCompletedImportableForms(forms,input.filePath,[],[],[input.filePath]),true);
  const mixed = [...forms, { kind:'daily',date:'2026-10-21',startDate:null }];
  assert.equal(fileHasCompletedImportableForms(mixed,input.filePath,[],[],[input.filePath]),false);
  assert.equal(fileHasCompletedImportableForms(mixed,input.filePath,[{date:'2026-10-21',filePath:input.filePath}],[],[input.filePath]),true);
  assert.deepEqual(healthFields('Impression | Text \\| still value | line one\\nline two',3),['Impression','Text | still value','line one\nline two']);
});
test('all four shipped example forms import in memory and produce four records and two distinct health days', async () => {
  const db=createSchemaV1Database();
  try {
    for (const input of [
      {kind:'measurement',name:'EH example glucose',unit:'mg/dL',valueType:'number'},
      {kind:'measurement',name:'EH example urine result',valueType:'qualitative'},
      {kind:'measurement',name:'EH example imaging impression',valueType:'text'},
      {kind:'procedure',name:'EH example imaging'},
      {kind:'medication',name:'EH example 10 mg tablet',unit:'tablet'},
      {kind:'symptom',name:'EH example headache'},
    ]) writeHealthCatalog(db,{unit:'',valueType:'number',aliases:[],...input});
    for(const file of ['01 Lab.md','02 Imaging.md']){
      const sourceText=await readFile(new URL('../../docs/examples/health/'+file,import.meta.url),'utf8');
      writeMedicalForm(db,{filePath:'EH examples/'+file,sourceText,sourceChecksum:'example',pluginVersion:'test'});
    }
    for(const date of ['2026-10-23','2026-10-24']){
      const sourceText=await readFile(new URL('../../docs/examples/health/'+date+'.md',import.meta.url),'utf8');
      const input={...replacementInput(),noteDate:date,todayDate:'2026-10-25',fileName:date+'.md',filePath:'EH examples/'+date+'.md',sourceText};
      const preview=inspectDailyNote(db,input);assert.equal(preview.ready,true,preview.errors.join('\n'));
      writeHistoricalDailyNote(db,input);
    }
    const page=queryRecordsPage(db,0);assert.equal(page.forms.length,4);assert.equal(page.days.length,2);
    assert.equal(page.days[0].medicationState,'none');assert.equal(page.days[1].medication.length,1);
    assert.equal(queryRecordsPage(db,1).forms.length,0);
  } finally{db.close();}
});
test('record listing works on older databases without optional planning or health tables',()=>{
  const db=new SQL.Database();
  try{assert.deepEqual(queryRecordsPage(db,0),{forms:[],days:[]});}finally{db.close();}
});
