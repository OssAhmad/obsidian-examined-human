import '../../test-support/plugin-module-hooks.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TFile, TFolder } from '../../test-support/obsidian-stub.mjs';
import { createSchemaV1Database, SQL } from '../../test-support/database.mjs';
import { writeHealthCatalog, writeMedicalForm } from './medical.ts';
import { queryRows } from '../read-models/sql.ts';
const { LoggerService } = await import('./service.ts');

function harness() {
  const db=createSchemaV1Database();
  writeHealthCatalog(db,{ kind:'measurement',name:'Finding',unit:'',valueType:'text',aliases:[] });
  const sourceText='#### EH Medical Form\nreport: Example\nperformed:\nreported:\nsource:\n##### Measurements\nENTRIES:\nFinding | Old finding | Original notes\n##### Procedures\nENTRIES:\nnone\n#### END';
  const input={ sourceText,filePath:'Medical/example.md',sourceChecksum:'old',pluginVersion:'test' };
  writeMedicalForm(db,input);
  const original=db.export(); db.close();
  const state={ bytes:original.slice(),text:sourceText.replace('Old finding','New finding'),backups:new Map(),folders:new Set(),walSize:0,writes:0,onBackup:null,failBackup:false,failVerify:false,corrupt:false };
  const source=new TFile(input.filePath), database=new TFile('EH.db');
  const app={ vault:{
    getAbstractFileByPath(path) { return path===source.path?source:path===database.path?database:state.folders.has(path)?new TFolder(path):null; },
    async read(){ return state.text; },
    async createFolder(path){state.folders.add(path);},
    async readBinary(){ if(state.corrupt){state.corrupt=false;return new Uint8Array([1,2]).buffer;} return state.bytes.slice().buffer; },
    async modifyBinary(_file,bytes){ state.bytes=new Uint8Array(bytes).slice(); state.writes++; if(state.failVerify&&state.writes===1)state.corrupt=true; },
    adapter:{
      async stat(path){return path.endsWith('-wal')?(state.walSize?{type:'file',size:state.walSize}:null):state.folders.has(path)?{type:'folder'}:null;},
      async exists(path){return state.backups.has(path)||state.folders.has(path);},
      async mkdir(path){state.folders.add(path);},
      async writeBinary(path,bytes){if(state.failBackup)throw new Error('backup failure');state.backups.set(path,new Uint8Array(bytes).slice());if(state.onBackup)await state.onBackup();},
    },
  }};
  return {service:new LoggerService(app,'test'),state,original,request:{ databasePath:'EH.db',filePath:source.path,sourceText:state.text,replaceExisting:true }};
}
test('medical service requires reviewed checksum and backs up exact original bytes; concurrent duplicate confirmations are refused',async()=>{
  const {service,state,original,request}=harness();
  await assert.rejects(service.importMedical(request),/Preview and confirm/);
  const preview=await service.inspectMedical(request);assert.deepEqual(state.bytes,original);
  const confirmed={...request,expectedDatabaseChecksum:preview.databaseChecksum};
  const results=await Promise.allSettled([service.importMedical(confirmed),service.importMedical(confirmed)]);
  assert.equal(results[0].status,'fulfilled'); assert.equal(results[1].status,'rejected');
  assert.equal(state.writes,1);assert.deepEqual([...state.backups.values()][0],original);
  const db=new SQL.Database(state.bytes);try{assert.equal(queryRows(db,'SELECT value_text FROM measurements')[0].value_text,'New finding');}finally{db.close();}
});
test('medical service refuses changed note/database, nonempty WAL and failed backup including changes while backing up',async()=>{
  for(const failure of ['note','database','wal','backup','note-during-backup','database-during-backup','wal-during-backup']){
    const {service,state,original,request}=harness();const preview=await service.inspectMedical(request);let expected=original;
    const edit=()=>{const db=new SQL.Database(state.bytes);db.run("UPDATE reports SET title='External edit'");state.bytes=db.export();expected=state.bytes.slice();db.close();};
    if(failure==='note')state.text+='edited';if(failure==='database')edit();if(failure==='wal')state.walSize=100;if(failure==='backup')state.failBackup=true;
    if(failure==='note-during-backup')state.onBackup=()=>{state.text+='edited';};if(failure==='database-during-backup')state.onBackup=edit;if(failure==='wal-during-backup')state.onBackup=()=>{state.walSize=100;};
    await assert.rejects(service.importMedical({...request,expectedDatabaseChecksum:preview.databaseChecksum}));
    assert.equal(state.writes,0,failure);assert.deepEqual(state.bytes,expected,failure);
  }
});
test('medical service restores database after persisted-byte verification failure',async()=>{
  const {service,state,original,request}=harness();const preview=await service.inspectMedical(request);state.failVerify=true;
  await assert.rejects(service.importMedical({...request,expectedDatabaseChecksum:preview.databaseChecksum}),/original was restored/);
  assert.deepEqual(state.bytes,original);assert.equal(state.backups.size,1);
});

test('existing review database upgrades to single-owner schema only after checksum confirmation', async () => {
  const { service, state } = harness();
  const db = createSchemaV1Database();
  db.run('DELETE FROM schema_migrations WHERE version=7; CREATE TABLE people(id INTEGER PRIMARY KEY, name TEXT NOT NULL); ALTER TABLE reports ADD COLUMN person_id INTEGER REFERENCES people(id);');
  state.bytes = db.export(); db.close();
  const original = state.bytes.slice();
  const preview = await service.inspectMedicalUpgrade('EH.db');
  assert.equal(preview.needed, true);
  assert.deepEqual(state.bytes, original);
  await assert.rejects(service.upgradeMedical('EH.db', 'stale checksum'), /changed after preview/);
  await service.upgradeMedical('EH.db', preview.databaseChecksum);
  assert.deepEqual([...state.backups.values()][0], original);
  assert.equal(state.writes, 1);
  const updated = new SQL.Database(state.bytes);
  try {
    assert.equal(queryRows(updated, 'PRAGMA table_info(reports)').some(row => row.name === 'person_id'), false);
    assert.deepEqual(queryRows(updated, "SELECT name FROM sqlite_master WHERE name='people'"), []);
    assert.deepEqual(queryRows(updated, 'PRAGMA foreign_key_check'), []);
  } finally { updated.close(); }
  assert.equal((await service.inspectMedicalUpgrade('EH.db')).needed, false);
});
