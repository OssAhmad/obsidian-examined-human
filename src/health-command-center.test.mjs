import '../test-support/plugin-module-hooks.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSchemaV1Database } from '../test-support/database.mjs';
import { queryCommandCatalog } from './read-models/command-catalog.ts';
import { writeHealthCatalog } from './logger/medical.ts';
const { CommandCenterView } = await import('./CommandCenterView.ts');

globalThis.window = { requestAnimationFrame: callback => callback() };
function fixture(db) {
  let refreshes = 0;
  const plugin = {
    settings: { databasePath: 'EH.db' },
    watchSourceUpdates: () => () => {},
    async refreshViews() { refreshes++; },
    database: {
      async commandCatalog() { return queryCommandCatalog(db); },
      async foodLibrary() { return []; },
      async financialDashboard() { throw new Error('No finance fixture'); },
    },
  };
  const view = new CommandCenterView({ app: {} }, plugin);
  const button = name => view.contentEl.all().find(el => el.tag === 'button' && el.textContent === name);
  return { view, button, refreshes: () => refreshes };
}

test('Health browser shows canonical units/types/aliases, filters, switches categories and uses shared Refresh', async () => {
  const db = createSchemaV1Database();
  try {
    writeHealthCatalog(db, { kind: 'measurement', name: 'Glucose', unit: 'mg/dL', valueType: 'number', aliases: ['Sugar'] });
    writeHealthCatalog(db, { kind: 'symptom', name: 'Headache', unit: '', valueType: '', aliases: ['Head pain'] });
    const { view, button, refreshes } = fixture(db);
    await view.onOpen();
    button('Health (2)').trigger('click');
    assert.match(view.contentEl.text(), /Glucose/);
    assert.match(view.contentEl.text(), /mg\/dL/);
    assert.match(view.contentEl.text(), /number/);
    assert.match(view.contentEl.text(), /sugar/);
    assert.equal(button('Add measurement').disabled, false);
    const search = view.contentEl.all().find(el => el.type === 'search');
    search.value = 'missing'; search.trigger('input');
    assert.match(view.contentEl.text(), /No matching catalog records/);
    search.value = 'sugar'; search.trigger('input');
    assert.doesNotMatch(view.contentEl.text(), /No matching catalog records/);
    button('Symptoms (1)').trigger('click');
    assert.match(view.contentEl.text(), /Headache/);
    assert.equal(button('Add symptom').disabled, false);
    button('Procedures (0)').trigger('click');
    assert.match(view.contentEl.text(), /No canonical procedures yet/);
    assert.doesNotMatch(view.contentEl.text(), /People/);
    button('Refresh').trigger('click');
    assert.equal(refreshes(), 1);
    await view.onClose();
  } finally { db.close(); }
});

test('missing health schema leaves other Command Center libraries usable and offers migration guidance', async () => {
  const db = createSchemaV1Database();
  try {
    db.run('DROP TABLE marker_aliases');
    const catalog = queryCommandCatalog(db);
    assert.equal(catalog.health.available, false);
    assert.deepEqual(catalog.health.entries, { measurement: [], procedure: [], medication: [], symptom: [] });
    const { view, button } = fixture(db);
    await view.onOpen();
    await view.showHealthCatalog();
    assert.match(view.contentEl.text(), /Settings.*Update to schema v1/);
    assert.equal(button('Add measurement').disabled, true);
    button('Foods (0)').trigger('click');
    assert.match(view.contentEl.text(), /No canonical foods yet/);
    await view.onClose();
  } finally { db.close(); }
});
