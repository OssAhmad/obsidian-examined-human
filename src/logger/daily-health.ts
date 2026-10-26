import type { Database } from 'sql.js';
import { dailyFormSections } from '../forms/form-document.ts';
import { assertMedicalSchema, hasMedicalSchema } from '../read-models/medical.ts';
import { healthSection, healthFields, resolveHealth } from './medical.ts';

export function inspectDailyHealth(db: Database, body: string) {
  const sections = dailyFormSections(body);
  if (sections.has('medication') || sections.has('symptoms')) assertMedicalSchema(db);
  const medication = healthSection(sections.get('medication')?.content);
  const symptoms = healthSection(sections.get('symptoms')?.content);
  function time(value: string): string {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`Health time must be HH:mm: ${value}`);
    return value;
  }
  const intakes = medication.lines.map(line => {
    const [rawTime, name, rawAmount, notes] = healthFields(line, 4);
    const medication = resolveHealth(db, 'medication', name);
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(rawAmount) || !Number.isFinite(Number(rawAmount)) || Number(rawAmount) <= 0) throw new Error('Medication amount must be a positive number in its canonical dose unit.');
    return { time: time(rawTime), medicationId: medication.id, name: medication.name, amount: Number(rawAmount), unit: medication.unit, notes };
  });
  const occurrences = symptoms.lines.map(line => {
    const [rawTime, name, notes] = healthFields(line, 3);
    const symptom = resolveHealth(db, 'symptom', name);
    return { time: time(rawTime), symptomId: symptom.id, name: symptom.name, notes };
  });
  return { medicationState: medication.state, symptomsState: symptoms.state, intakes, occurrences };
}
export type DailyHealth = ReturnType<typeof inspectDailyHealth>;
export function writeDailyHealth(db: Database, date: string, health: DailyHealth): void {
  if (!hasMedicalSchema(db)) return;
  db.run('INSERT INTO daily_health (date,medication_state,symptoms_state) VALUES (?,?,?)', [date, health.medicationState, health.symptomsState]);
  health.intakes.forEach((i, ordinal) => db.run(`INSERT INTO medication_intakes
    (date,time,medication_id,amount,unit_at_time,notes,source_ordinal) VALUES (?,?,?,?,?,?,?)`, [date, i.time, i.medicationId, i.amount, i.unit, i.notes, ordinal]));
  health.occurrences.forEach((s, ordinal) => db.run('INSERT INTO symptom_entries (date,time,symptom_id,notes,source_ordinal) VALUES (?,?,?,?,?)', [date, s.time, s.symptomId, s.notes, ordinal]));
}
