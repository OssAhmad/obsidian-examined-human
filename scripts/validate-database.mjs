import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { inspectDatabase, querySessions } from '../src/examined-human-query.ts';

const databasePath = process.argv[2];
if (!databasePath) {
  console.error('Usage: npm run validate:database -- /path/to/EH.db');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
const SQL = await initSqlJs({ wasmBinary });
const db = new SQL.Database(await readFile(databasePath));

try {
  db.run('PRAGMA query_only = ON');
  const inspection = inspectDatabase(db);
  const mapped = inspection.firstDate && inspection.lastDate
    ? querySessions(db, inspection.firstDate, inspection.lastDate, inspection.firstDate, false)
    : { events: [], issues: [], dayStates: {} };
  const canonicalEvents = mapped.events.filter((event) => event.sourceKind !== 'planned');
  const plannedEvents = mapped.events.filter((event) => event.sourceKind === 'planned');
  const linkedMilestones = canonicalEvents.reduce(
    (total, event) => total + (event.milestoneDetails?.length ?? 0),
    0,
  );
  const chorCount = canonicalEvents.filter((event) => event.sessionType.toLowerCase() === 'chor').length;

  console.log(JSON.stringify({
    integrity: inspection.integrity,
    sessionCount: inspection.sessionCount,
    distinctDays: inspection.distinctDays,
    firstDate: inspection.firstDate,
    lastDate: inspection.lastDate,
    mappedSessions: canonicalEvents.length,
    plannedSessions: plannedEvents.length,
    linkedMilestones,
    awaitingFinalizationDays: Object.values(mapped.dayStates).filter((state) => state.overdue).length,
    dataIssues: mapped.issues.length,
    chorCount,
  }, null, 2));
} finally {
  db.close();
}
