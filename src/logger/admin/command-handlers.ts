import type { Database } from 'sql.js';
import { normalizeValuationUnit } from '../../domain/valuation.ts';
import {
  ensureAlias,
  lastInsertId,
  moveAlias,
  parseAliases,
  queryRows,
  removeAlias,
  requireIsoDate,
  resolveEntity,
  resolveTaxonomy,
  taxonomyCodes,
} from '../database-utils.ts';
import { validateAdminCommandArguments } from './command-registry.ts';

export interface AdminEvent {
  command: string;
  args: string[];
  raw: string;
}

type MutableTypeTable = 'session_types' | 'engagement_types';

function addType(db: Database, table: MutableTypeTable, args: string[], command: string): void {
  const code = args[0].trim().toLowerCase();
  const label = args[1].trim();
  const description = args[2]?.trim() || null;
  if (!code) throw new Error(`${command} code is empty.`);
  if (!label) throw new Error(`${command} label is empty.`);
  const existing = queryRows(db, `SELECT id FROM ${table} WHERE code = ? COLLATE NOCASE`, [code])[0];
  if (existing) {
    db.run(`UPDATE ${table} SET label = ?, description = ?, is_active = 1 WHERE id = ?`, [
      label, description, Number(existing.id),
    ]);
    return;
  }
  db.run(`INSERT INTO ${table} (code, label, description, is_active, sort_order)
    VALUES (?, ?, ?, 1, COALESCE((SELECT MAX(sort_order) + 10 FROM ${table}), 10))`, [
    code, label, description,
  ]);
}

function removeType(db: Database, table: MutableTypeTable, rawCode: string, command: string): void {
  const code = rawCode.trim().toLowerCase();
  if (!code) throw new Error(`${command} code is empty.`);
  const existing = queryRows(db, `SELECT id, is_active FROM ${table} WHERE code = ? COLLATE NOCASE`, [code])[0];
  if (!existing) throw new Error(`Unknown type '${rawCode}'.`);
  if (Number(existing.is_active) === 0) throw new Error(`Type '${code}' is already inactive.`);
  db.run(`UPDATE ${table} SET is_active = 0 WHERE id = ?`, [Number(existing.id)]);
}

function optionalIsoDate(value: string, label: string): string | null {
  if (!value.trim()) return null;
  requireIsoDate(value, label);
  return value;
}

function requiredNonNegativeNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative number.`);
  return parsed;
}

function optionalNonNegativeNumber(value: string, label: string): number | null {
  if (!value.trim()) return null;
  return requiredNonNegativeNumber(value, label);
}

function assertFoodNameAvailable(db: Database, name: string, exceptId: number | null = null): void {
  const normalized = name.trim();
  if (!normalized) throw new Error('Food name is empty.');
  const rows = queryRows(db, `
    SELECT id, name FROM foods WHERE name = ? COLLATE NOCASE
    UNION ALL
    SELECT food.id, food.name FROM food_aliases AS alias
      JOIN foods AS food ON food.id = alias.food_id
      WHERE alias.alias = ? COLLATE NOCASE
  `, [normalized, normalized]);
  if (rows.some((row) => Number(row.id) !== exceptId)) {
    throw new Error(`Food name '${normalized}' is already used by a canonical food or food alias.`);
  }
}

function assertFoodAliasDoesNotShadowCanonicalName(db: Database, alias: string): void {
  const canonical = queryRows(db, 'SELECT name FROM foods WHERE name = ? COLLATE NOCASE LIMIT 1', [alias.trim()])[0];
  if (canonical) throw new Error(`Food alias '${alias.trim()}' conflicts with canonical food '${String(canonical.name)}'.`);
}

export function applyAdminEvents(db: Database, events: AdminEvent[], noteDate: string, errors: string[]): void {
  for (const event of events) {
    const argumentError = validateAdminCommandArguments(event.command, event.args.length);
    if (argumentError) {
      errors.push(argumentError);
      continue;
    }
    try {
      const args = event.args;
      if (event.command === 'SESSION_TYPE_ADD') {
        addType(db, 'session_types', args, event.command);
      } else if (event.command === 'SESSION_TYPE_REMOVE') {
        removeType(db, 'session_types', args[0], event.command);
      } else if (event.command === 'ENGAGEMENT_TYPE_ADD') {
        addType(db, 'engagement_types', args, event.command);
      } else if (event.command === 'ENGAGEMENT_TYPE_REMOVE') {
        removeType(db, 'engagement_types', args[0], event.command);
      } else if (event.command === 'ENGAGEMENT_CREATE') {
        const [name, typeRaw, statusRaw, notes] = args;
        if (!name) throw new Error('ENGAGEMENT_CREATE name is empty.');
        if (resolveEntity(db, name, 'engagements')) throw new Error(`Engagement already exists: ${name}`);
        const type = resolveTaxonomy(db, 'engagement_types', typeRaw);
        const status = resolveTaxonomy(db, 'engagement_statuses', statusRaw);
        if (!type) throw new Error(`Unknown engagement type '${typeRaw}'. Supported: ${taxonomyCodes(db, 'engagement_types').join(', ')}.`);
        if (!status) throw new Error(`Unknown engagement status '${statusRaw}'. Supported: ${taxonomyCodes(db, 'engagement_statuses').join(', ')}.`);
        db.run('INSERT INTO engagements (name, type_id, status_id, notes, start_date) VALUES (?, ?, ?, ?, ?)', [name, type.id, status.id, notes, noteDate]);
      } else if (event.command === 'ENGAGEMENT_COMPLETE' || event.command === 'ENGAGEMENT_PAUSE') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        const code = event.command === 'ENGAGEMENT_COMPLETE' ? 'completed' : 'paused';
        const status = resolveTaxonomy(db, 'engagement_statuses', code);
        if (!status) throw new Error(`Database has no active '${code}' engagement status.`);
        db.run(
          event.command === 'ENGAGEMENT_COMPLETE'
            ? 'UPDATE engagements SET status_id = ?, completion_date = ? WHERE id = ?'
            : 'UPDATE engagements SET status_id = ? WHERE id = ?',
          event.command === 'ENGAGEMENT_COMPLETE'
            ? [status.id, noteDate, engagement.id]
            : [status.id, engagement.id],
        );
      } else if (event.command === 'ENGAGEMENT_RENAME') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        if (!args[1]) throw new Error('ENGAGEMENT_RENAME new name is empty.');
        db.run('UPDATE engagements SET name = ? WHERE id = ?', [args[1], engagement.id]);
      } else if (event.command === 'ENGAGEMENT_UPDATE') {
        const [raw, newName, typeRaw, statusRaw, startDate, targetDate, completionDate, notes, aliases] = args;
        const engagement = resolveEntity(db, raw, 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${raw}`);
        const type = resolveTaxonomy(db, 'engagement_types', typeRaw);
        const status = resolveTaxonomy(db, 'engagement_statuses', statusRaw);
        if (!type) throw new Error(`Unknown engagement type '${typeRaw}'.`);
        if (!status) throw new Error(`Unknown engagement status '${statusRaw}'.`);
        const finalName = newName || engagement.name;
        db.run(`UPDATE engagements SET name = ?, type_id = ?, status_id = ?, start_date = ?, target_date = ?, completion_date = ?, notes = ? WHERE id = ?`, [
          finalName, type.id, status.id, startDate || null, targetDate || null,
          completionDate || null, notes, engagement.id,
        ]);
        const updated = { id: engagement.id, name: finalName };
        for (const alias of parseAliases(aliases)) ensureAlias(db, 'engagements', updated, alias);
      } else if (event.command === 'ENGAGEMENT_ALIAS' || event.command === 'ENGAGEMENT_ALIAS_ADD') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        for (const alias of parseAliases(args[1])) ensureAlias(db, 'engagements', engagement, alias);
      } else if (event.command === 'ENGAGEMENT_ALIAS_REMOVE') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        removeAlias(db, 'engagements', engagement, args[1]);
      } else if (event.command === 'ENGAGEMENT_ALIAS_MOVE') {
        const destination = resolveEntity(db, args[1], 'engagements');
        if (!destination) throw new Error(`Unknown destination engagement: ${args[1]}`);
        moveAlias(db, 'engagements', args[0], destination);
      } else if (event.command === 'ENGAGEMENT_SET_STATUS') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        const status = resolveTaxonomy(db, 'engagement_statuses', args[1]);
        if (!status) throw new Error(`Unknown engagement status '${args[1]}'. Supported: ${taxonomyCodes(db, 'engagement_statuses').join(', ')}.`);
        db.run('UPDATE engagements SET status_id = ? WHERE id = ?', [status.id, engagement.id]);
      } else if (event.command === 'ENGAGEMENT_SET_DATES') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        const startDate = optionalIsoDate(args[1], 'Engagement start date');
        const targetDate = optionalIsoDate(args[2], 'Engagement target date');
        db.run('UPDATE engagements SET start_date = ?, target_date = ? WHERE id = ?', [startDate, targetDate, engagement.id]);
      } else if (event.command === 'ENGAGEMENT_SET_NOTES') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        db.run('UPDATE engagements SET notes = ? WHERE id = ?', [args[1] || null, engagement.id]);
      } else if (event.command === 'ENGAGEMENT_REOPEN') {
        const engagement = resolveEntity(db, args[0], 'engagements');
        if (!engagement) throw new Error(`Unknown engagement: ${args[0]}`);
        const status = resolveTaxonomy(db, 'engagement_statuses', 'active');
        if (!status) throw new Error("Database has no active 'active' engagement status.");
        db.run('UPDATE engagements SET status_id = ?, completion_date = NULL WHERE id = ?', [status.id, engagement.id]);
      } else if (event.command === 'EXERCISE_CREATE') {
        if (!args[0]) throw new Error('EXERCISE_CREATE name is empty.');
        if (resolveEntity(db, args[0], 'exercises')) throw new Error(`Exercise already exists: ${args[0]}`);
        db.run('INSERT INTO exercises (name, category) VALUES (?, ?)', [args[0], args[1] || null]);
      } else if (event.command === 'EXERCISE_UPDATE') {
        const [raw, newName, category, aliases] = args;
        const exercise = resolveEntity(db, raw, 'exercises');
        if (!exercise) throw new Error(`Unknown exercise: ${raw}`);
        const finalName = newName || exercise.name;
        db.run('UPDATE exercises SET name = ?, category = ? WHERE id = ?', [finalName, category || null, exercise.id]);
        const updated = { id: exercise.id, name: finalName };
        for (const alias of parseAliases(aliases)) ensureAlias(db, 'exercises', updated, alias);
      } else if (event.command === 'EXERCISE_RENAME') {
        const exercise = resolveEntity(db, args[0], 'exercises');
        if (!exercise) throw new Error(`Unknown exercise: ${args[0]}`);
        if (!args[1]) throw new Error('EXERCISE_RENAME new name is empty.');
        db.run('UPDATE exercises SET name = ? WHERE id = ?', [args[1], exercise.id]);
      } else if (event.command === 'EXERCISE_ALIAS' || event.command === 'EXERCISE_ALIAS_ADD') {
        const exercise = resolveEntity(db, args[0], 'exercises');
        if (!exercise) throw new Error(`Unknown exercise: ${args[0]}`);
        for (const alias of parseAliases(args[1])) ensureAlias(db, 'exercises', exercise, alias);
      } else if (event.command === 'EXERCISE_ALIAS_REMOVE') {
        const exercise = resolveEntity(db, args[0], 'exercises');
        if (!exercise) throw new Error(`Unknown exercise: ${args[0]}`);
        removeAlias(db, 'exercises', exercise, args[1]);
      } else if (event.command === 'EXERCISE_ALIAS_MOVE') {
        const destination = resolveEntity(db, args[1], 'exercises');
        if (!destination) throw new Error(`Unknown destination exercise: ${args[1]}`);
        moveAlias(db, 'exercises', args[0], destination);
      } else if (event.command === 'ACCOUNT_CREATE') {
        if (!args[0]) throw new Error('ACCOUNT_CREATE name is empty.');
        if (resolveEntity(db, args[0], 'accounts')) throw new Error(`Account already exists: ${args[0]}`);
        if (args.length === 3) {
          db.run('INSERT INTO accounts (name, type, address) VALUES (?, ?, ?)', args);
        } else {
          db.run('INSERT INTO accounts (name, type, currency, address) VALUES (?, ?, ?, ?)', [args[0], args[1] || null, args[2] ? normalizeValuationUnit(args[2]) : null, args[3] || null]);
        }
      } else if (event.command === 'ACCOUNT_ALIAS' || event.command === 'ACCOUNT_ALIAS_ADD') {
        const account = resolveEntity(db, args[0], 'accounts');
        if (!account) throw new Error(`Unknown account: ${args[0]}`);
        for (const alias of parseAliases(args[1])) ensureAlias(db, 'accounts', account, alias);
      } else if (event.command === 'ACCOUNT_ALIAS_REMOVE') {
        const account = resolveEntity(db, args[0], 'accounts');
        if (!account) throw new Error(`Unknown account: ${args[0]}`);
        removeAlias(db, 'accounts', account, args[1]);
      } else if (event.command === 'ACCOUNT_ALIAS_MOVE') {
        const destination = resolveEntity(db, args[1], 'accounts');
        if (!destination) throw new Error(`Unknown destination account: ${args[1]}`);
        moveAlias(db, 'accounts', args[0], destination);
      } else if (event.command === 'ACCOUNT_UPDATE') {
        const [raw, newName, type, aliases] = args;
        const account = resolveEntity(db, raw, 'accounts');
        if (!account) throw new Error(`Unknown account: ${raw}`);
        const finalName = newName || account.name;
        db.run('UPDATE accounts SET name = ?, type = ? WHERE id = ?', [finalName, type || null, account.id]);
        const updated = { id: account.id, name: finalName };
        for (const alias of parseAliases(aliases)) ensureAlias(db, 'accounts', updated, alias);
      } else if (event.command === 'ACCOUNT_RENAME') {
        const account = resolveEntity(db, args[0], 'accounts');
        if (!account) throw new Error(`Unknown account: ${args[0]}`);
        if (!args[1]) throw new Error('ACCOUNT_RENAME new name is empty.');
        db.run('UPDATE accounts SET name = ? WHERE id = ?', [args[1], account.id]);
      } else if (event.command === 'ACCOUNT_SET_TYPE') {
        const account = resolveEntity(db, args[0], 'accounts');
        if (!account) throw new Error(`Unknown account: ${args[0]}`);
        db.run('UPDATE accounts SET type = ? WHERE id = ?', [args[1] || null, account.id]);
      } else if (event.command === 'ACCOUNT_SET_CURRENCY') {
        const account = resolveEntity(db, args[0], 'accounts');
        if (!account) throw new Error(`Unknown account: ${args[0]}`);
        db.run('UPDATE accounts SET currency = ? WHERE id = ?', [args[1] ? normalizeValuationUnit(args[1]) : null, account.id]);
      } else if (event.command === 'ACCOUNT_SET_ADDRESS') {
        const account = resolveEntity(db, args[0], 'accounts');
        if (!account) throw new Error(`Unknown account: ${args[0]}`);
        db.run('UPDATE accounts SET address = ? WHERE id = ?', [args[1] || null, account.id]);
      } else if (event.command === 'FOOD_CREATE') {
        const [name, category, calories, protein, carbs, fat, salt, fiber, cholesterol, notes, aliases = ''] = args;
        assertFoodNameAvailable(db, name);
        db.run(`
          INSERT INTO foods (
            name, category, calories_kcal_per_100g, protein_g_per_100g,
            carbs_g_per_100g, fat_g_per_100g, salt_g_per_100g,
            fiber_g_per_100g, cholesterol_mg_per_100g, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          name.trim(), category || null,
          requiredNonNegativeNumber(calories, 'Food calories per 100 g'),
          requiredNonNegativeNumber(protein, 'Food protein per 100 g'),
          requiredNonNegativeNumber(carbs, 'Food carbs per 100 g'),
          requiredNonNegativeNumber(fat, 'Food fat per 100 g'),
          requiredNonNegativeNumber(salt, 'Food salt per 100 g'),
          optionalNonNegativeNumber(fiber, 'Food fiber per 100 g'),
          optionalNonNegativeNumber(cholesterol, 'Food cholesterol per 100 g'),
          notes || null,
        ]);
        const food = { id: lastInsertId(db), name: name.trim() };
        for (const alias of parseAliases(aliases)) {
          assertFoodAliasDoesNotShadowCanonicalName(db, alias);
          ensureAlias(db, 'foods', food, alias);
        }
      } else if (event.command === 'FOOD_UPDATE') {
        const [raw, category, calories, protein, carbs, fat, salt, fiber, cholesterol, notes] = args;
        const food = resolveEntity(db, raw, 'foods');
        if (!food) throw new Error(`Unknown food: ${raw}`);
        db.run(`
          UPDATE foods SET
            category = ?, calories_kcal_per_100g = ?, protein_g_per_100g = ?,
            carbs_g_per_100g = ?, fat_g_per_100g = ?, salt_g_per_100g = ?,
            fiber_g_per_100g = ?, cholesterol_mg_per_100g = ?, notes = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `, [
          category || null,
          requiredNonNegativeNumber(calories, 'Food calories per 100 g'),
          requiredNonNegativeNumber(protein, 'Food protein per 100 g'),
          requiredNonNegativeNumber(carbs, 'Food carbs per 100 g'),
          requiredNonNegativeNumber(fat, 'Food fat per 100 g'),
          requiredNonNegativeNumber(salt, 'Food salt per 100 g'),
          optionalNonNegativeNumber(fiber, 'Food fiber per 100 g'),
          optionalNonNegativeNumber(cholesterol, 'Food cholesterol per 100 g'),
          notes || null,
          food.id,
        ]);
      } else if (event.command === 'FOOD_RENAME') {
        const food = resolveEntity(db, args[0], 'foods');
        if (!food) throw new Error(`Unknown food: ${args[0]}`);
        assertFoodNameAvailable(db, args[1], food.id);
        db.run('UPDATE foods SET name = ?, updated_at = datetime(\'now\') WHERE id = ?', [args[1].trim(), food.id]);
      } else if (event.command === 'FOOD_DELETE') {
        const food = resolveEntity(db, args[0], 'foods');
        if (!food) throw new Error(`Unknown food: ${args[0]}`);
        db.run('DELETE FROM foods WHERE id = ?', [food.id]);
      } else if (event.command === 'FOOD_ALIAS_ADD') {
        const food = resolveEntity(db, args[0], 'foods');
        if (!food) throw new Error(`Unknown food: ${args[0]}`);
        for (const alias of parseAliases(args[1])) {
          assertFoodAliasDoesNotShadowCanonicalName(db, alias);
          ensureAlias(db, 'foods', food, alias);
        }
      } else if (event.command === 'FOOD_ALIAS_REMOVE') {
        const food = resolveEntity(db, args[0], 'foods');
        if (!food) throw new Error(`Unknown food: ${args[0]}`);
        for (const alias of parseAliases(args[1])) removeAlias(db, 'foods', food, alias);
      } else if (event.command === 'FOOD_ALIAS_MOVE') {
        const destination = resolveEntity(db, args[1], 'foods');
        if (!destination) throw new Error(`Unknown destination food: ${args[1]}`);
        for (const alias of parseAliases(args[0])) moveAlias(db, 'foods', alias, destination);
      }
    } catch (error) {
      errors.push(`${event.command}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

