import type { Database } from 'sql.js';
import { validateSchemaContract } from './sql.ts';

export const CORE_READ_SCHEMA = {
  sessions: ['id', 'engagement_id', 'date', 'start_time', 'end_time', 'duration_minutes', 'session_type_id', 'notes'],
  session_types: ['id', 'code'],
  engagements: ['id', 'name', 'type_id'],
  engagement_types: ['id', 'code'],
};

export function validateSchema(db: Database): void {
  validateSchemaContract(db, CORE_READ_SCHEMA, {
    missingSource: (table) => `Required table "${table}" was not found.`,
    missingColumns: (table, missing) => `Table "${table}" is missing: ${missing.join(', ')}.`,
  });
}
