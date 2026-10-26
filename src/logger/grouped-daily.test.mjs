import assert from 'node:assert/strict';
import test from 'node:test';
import { replacementDatabase,replacementInput } from '../../test-support/daily-reimport.mjs';
import { inspectDailyNote,writeHistoricalDailyNote } from './daily-note.ts';
import { writeHealthCatalog } from './medical.ts';
import { dailyFormSections,entryLines,requireEhForm } from '../forms/form-document.ts';
import { prepareFinanceEntryStage } from './finance-entry-stage.ts';
import { prepareValuationRateStage } from './valuation-rate-stage.ts';
import { queryRows } from '../read-models/sql.ts';

function nested(input){
  const rates=input.sourceText.slice(input.sourceText.indexOf('##### Valuation Rates'),input.sourceText.indexOf('#### END'));
  input.sourceText=input.sourceText.replace(rates,'').replace('##### Transactions','##### Financial\n###### Transactions')
    .replace('##### Exercise Details',rates.replace('##### Valuation Rates','###### Valuation Rates')+'##### Exercise Details');
  input.sourceText=input.sourceText.replace('##### Financial','##### Medical\n###### Medication\nENTRIES:\n08:30 | Demo tablet | 1 | taken with water\n###### Symptoms\nENTRIES:\nnone\n##### Financial');
  return input;
}
test('grouped Medical and Financial import and reimport preserve canonical entries and replace omissions',()=>{
  const db=replacementDatabase();try{
    writeHealthCatalog(db,{kind:'medication',name:'Demo tablet',unit:'tablet',valueType:'',aliases:[]});
    const input=nested(replacementInput());const preview=inspectDailyNote(db,input);
    assert.equal(preview.ready,true,preview.errors.join('\n'));
    assert.equal(preview.preview.transactions.length,1);assert.equal(preview.preview.health.intakes.length,1);
    writeHistoricalDailyNote(db,input);
    assert.equal(queryRows(db,'SELECT * FROM medication_intakes').length,1);assert.equal(queryRows(db,'SELECT * FROM transactions').length,1);
    const changed={...input,replaceExisting:true,sourceText:input.sourceText.replace('08:30 | Demo tablet | 1 | taken with water','none').replace('12.5 | Cash | Practice | original money','-3 | Cash | Practice | revised')};
    writeHistoricalDailyNote(db,changed);
    assert.equal(queryRows(db,'SELECT * FROM medication_intakes').length,0);assert.equal(queryRows(db,'SELECT amount FROM transactions')[0].amount,-3);
    assert.equal(queryRows(db,'SELECT medication_state FROM daily_health')[0].medication_state,'none');
    const duplicate={...changed,sourceText:changed.sourceText.replace('##### Medical','##### Medication\nENTRIES:\nnone\n##### Medical')};
    const invalid=inspectDailyNote(db,duplicate);assert.equal(invalid.ready,false);assert.match(invalid.errors.join('\n'),/Duplicate Daily section/);
    assert.throws(()=>dailyFormSections(input.sourceText.replace('###### Symptoms','###### Allergies')),/Unknown Medical subsection/);
  }finally{db.close();}
});
test('financial staging edits nested leaves with CRLF while preserving sibling rows and external text',async()=>{
  const source=['Preface','#### EH Daily Form','date: 2026-10-20','##### Financial','###### Transactions','ENTRIES:','1 | Cash | Practice | old','###### Valuation Rates','ENTRIES:','##### Medical','###### Symptoms','ENTRIES:','none','#### END','Suffix'].join('\r\n');
  const common={noteDate:'2026-10-20',fileName:'x.md',filePath:'Journal/x.md',sourceText:source};
  const financial=await prepareFinanceEntryStage({...common,line:'-2 | Cash | Practice | new'});
  const rates=await prepareValuationRateStage({...common,sourceText:financial.updatedText,lines:['USD | 1']});
  const sections=dailyFormSections(requireEhForm(rates.updatedText,'daily').body);
  assert.deepEqual(entryLines(sections.get('transactions').content),['-2 | Cash | Practice | new','1 | Cash | Practice | old']);
  assert.deepEqual(entryLines(sections.get('valuation rates').content),['USD | 1']);
  assert.deepEqual(entryLines(sections.get('symptoms').content),['none']);
  assert.ok(rates.updatedText.startsWith('Preface\r\n'));assert.ok(rates.updatedText.endsWith('\r\nSuffix'));
  assert.doesNotMatch(rates.updatedText,/(?<!\r)\n/);
});
test('financial staging creates a missing nested Transactions section without escaping the Financial boundary',async()=>{
  const sourceText='#### EH Daily Form\ndate: 2026-10-20\n##### Financial\n###### Valuation Rates\nENTRIES:\nUSD | 1\n##### Sessions\nENTRIES:\n#### END';
  const result=await prepareFinanceEntryStage({noteDate:'2026-10-20',fileName:'x.md',filePath:'x.md',sourceText,line:'1 | Cash | Practice | new'});
  const sections=dailyFormSections(requireEhForm(result.updatedText,'daily').body);
  assert.deepEqual(entryLines(sections.get('valuation rates').content),['USD | 1']);
  assert.equal(entryLines(sections.get('transactions').content).length,1);assert.equal(entryLines(sections.get('sessions').content).length,0);
});
