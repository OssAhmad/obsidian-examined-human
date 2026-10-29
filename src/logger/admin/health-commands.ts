import type { Database } from 'sql.js';
import { queryHealthCatalog, type HealthCatalogKind } from '../../read-models/medical.ts';
import { parseAliases } from '../database-utils.ts';
import { writeHealthCatalog } from '../medical.ts';

export const HEALTH_COMMAND_KINDS = {
  MEASUREMENT: 'measurement', PROCEDURE: 'procedure',
  MEDICATION: 'medication', SYMPTOM: 'symptom',
} as const satisfies Record<string, HealthCatalogKind>;

/** Catalog edits participate in the ordinary Daily preview/import transaction. */
export function applyHealthAdminCommand(db: Database, command: string, args: string[]): boolean {
  const match = /^(MEASUREMENT|PROCEDURE|MEDICATION|SYMPTOM)_(CREATE|UPDATE)$/.exec(command);
  if (!match) return false;
  const kind = HEALTH_COMMAND_KINDS[match[1] as keyof typeof HEALTH_COMMAND_KINDS];
  const update = match[2] === 'UPDATE';
  const catalog = queryHealthCatalog(db, kind);
  const previous = update ? catalog.filter(row => [row.name, ...row.aliases]
    .some(name => name.toLowerCase() === args[0].trim().toLowerCase())) : [];
  if (update && previous.length !== 1) throw new Error(`Expected one existing ${kind}: ${args[0]}.`);
  const fields = update ? args.slice(1) : args;
  const name = fields[0];
  const valueType = kind === 'measurement' ? fields[1] : '';
  const unit = kind === 'measurement' ? fields[2] : kind === 'medication' ? fields[1] : '';
  const aliasesIndex = kind === 'measurement' ? 3 : kind === 'medication' ? 2 : 1;
  const aliases = parseAliases(fields[aliasesIndex] ?? '');
  writeHealthCatalog(db, {
    kind, id: previous[0]?.id, name, unit, valueType, aliases,
  });
  return true;
}
