import '../test-support/plugin-module-hooks.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
const { MedicalDashboardView } = await import('./MedicalDashboardView.ts');
const { ReleaseNotesModal } = await import('./ReleaseNotesModal.ts');
const { ExaminedHumanSettingTab } = await import('./settings.ts');
import { createSchemaV1Database } from '../test-support/database.mjs';
import { queryMedicalDashboardPage } from './read-models/medical.ts';

globalThis.window = { requestAnimationFrame: callback => callback() };
function fixture(items, overrides={}) {
  const listeners=new Set();
  const opened=[];
  const plugin={ settings:{databasePath:'EH.db'},
    watchSourceUpdates(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    async refreshViews(){await view.refresh();},
    database:{
      async medicalDashboardPage(){return {needsMigration:false,total:items.length,items};},
      async medicalReport(_path,id){return {report:{report_id:id,performed:'2026-10-20',reported:'2026-10-21',measurements_state:'recorded',procedures_state:'none'},
        measurements:[{name:`Z-first-${id}`,value_text:'12',unit_at_time:'mm',notes:'first imported row'},{name:`A-second-${id}`,value_text:'no',unit_at_time:null,notes:'second imported row'}],procedures:[]};},
      async dailyHealth(){return {medicationState:'none',symptomsState:'unrecorded',intakes:[],occurrences:[]};},
      ...overrides,
    },
  };
  const app={workspace:{async openLinkText(path){opened.push(path);}}};
  const view=new MedicalDashboardView({app},plugin);
  return {view,listeners,opened};
}
function report(id,date='2026-10-21') {return {key:`report:${id}`,kind:'report',reportId:id,date,title:`Report ${id}`,sourcePath:`Medical/${id}.md`};}
function selected(view){return view.contentEl.all().find(el=>el.className==='examined-human-medical-report');}

test('Medical Dashboard navigates reports on the right and renders selected entries inline in imported order',async()=>{
  const {view,opened}=fixture([report(2),report(1)]);
  await view.onOpen();
  assert.equal(view.getDisplayText(),'Medical Dashboard');
  const layout=view.contentEl.all().find(el=>el.className==='examined-human-medical-layout');
  assert.equal(layout.children[0].tag,'main');assert.equal(layout.children[1].tag,'aside');
  assert.match(selected(view).text(),/Report 2/);
  assert.ok(selected(view).text().indexOf('Z-first-2')<selected(view).text().indexOf('A-second-2'));
  const nav=layout.children[1].all().filter(el=>el.tag==='button');nav[1].trigger('click');await view.refresh();
  assert.match(selected(view).text(),/Z-first-1/);assert.doesNotMatch(selected(view).text(),/Z-first-2/);
  selected(view).all().find(el=>el.tag==='button').trigger('click');
  assert.deepEqual(opened,['Medical/1.md']);await view.onClose();
});
test('Daily medical logs preserve none versus unrecorded; background changes retain the selected rendered report',async()=>{
  const day={key:'daily:2026-10-25',kind:'daily',reportId:null,date:'2026-10-25',title:'Daily medical log',sourcePath:'Journal/2026-10-25.md'};
  const {view,listeners}=fixture([day]);await view.onOpen();
  assert.match(selected(view).text(),/Recording state: none/);assert.match(selected(view).text(),/Recording state: unrecorded/);
  const original=selected(view);for(const listener of listeners)listener('Updated data available');
  assert.equal(selected(view),original);await view.refresh();assert.match(selected(view).text(),/none/);
  await view.onClose();assert.equal(listeners.size,0);
});
test('empty and unmigrated databases show actionable dashboard states',async()=>{
  const empty=fixture([]);await empty.view.onOpen();assert.match(empty.view.contentEl.text(),/No imported medical records/);
  const missing=fixture([],{async medicalDashboardPage(){return {needsMigration:true,total:0,items:[]};}});
  await missing.view.onOpen();assert.match(missing.view.contentEl.text(),/Settings.*Medical database migration/);
});
test('medical report pages retain all reports and are bounded with deterministic pagination',()=>{
  const db=createSchemaV1Database();try{
    for(let i=1;i<=55;i++){
      db.run("INSERT INTO reports(id,report_timestamp,report_type,title,relative_path) VALUES (?,'2026-10-20','medical',?,'')",[i,`Report ${i}`]);
      db.run("INSERT INTO medical_report_imports(report_id,source_file_path,source_checksum,measurements_state,procedures_state,plugin_version) VALUES (?,?,'test','unrecorded','none','test')",[i,`Medical/${i}.md`]);
    }
    const a=queryMedicalDashboardPage(db,0),b=queryMedicalDashboardPage(db,1);
    assert.equal(a.total,55);assert.equal(a.items.length,50);assert.equal(b.items.length,5);
    assert.equal(new Set([...a.items,...b.items].map(r=>r.key)).size,55);
  }finally{db.close();}
});
test('migration is exposed in shared Settings definitions and is absent from command registration',async()=>{
  const definitions=new ExaminedHumanSettingTab({},{}).getSettingDefinitions();
  const flatten=items=>items.flatMap(item=>[item,...flatten(item.items??[])]);
  const all=flatten(definitions);
  assert.ok(all.some(item=>item.name==='Medical database migration'&&typeof item.render==='function'));
  assert.ok(all.some(item=>item.name==='What’s new'));
  const main=await readFile(new URL('./main.ts',import.meta.url),'utf8');
  assert.doesNotMatch(main,/id: 'upgrade-medical-database'/);assert.match(main,/id: 'open-medical-dashboard', name: 'Medical Dashboard'/);
});
test('release notes show changes and acknowledge only when dismissed',()=>{
  let dismissed=0;const modal=new ReleaseNotesModal({},()=>{dismissed++;});modal.open();
  assert.match(modal.contentEl.text(),/Medical Dashboard/);assert.match(modal.contentEl.text(),/Settings/);
  assert.equal(dismissed,0);modal.close();assert.equal(dismissed,1);
});
