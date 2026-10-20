import { createSchemaV1Database } from './database.mjs';

export function replacementDatabase() {
  const db = createSchemaV1Database();
  db.run(`
    INSERT INTO engagements (name, type_id, status_id)
      SELECT 'Practice', type.id, status.id FROM engagement_types type, engagement_statuses status
      WHERE type.code = 'practice' AND status.code = 'active';
    INSERT INTO accounts (name, currency) VALUES ('Cash', 'USD');
    INSERT INTO exercises (name) VALUES ('Run');
    INSERT INTO foods (name, calories_kcal_per_100g, protein_g_per_100g,
      carbs_g_per_100g, fat_g_per_100g, salt_g_per_100g) VALUES ('Eggs', 150, 12, 1, 10, 0);
  `);
  return db;
}

export function replacementNote(date = '2026-08-20') {
  return `#### EH Daily Form
date: ${date}
##### Daily Metrics
mood: 1
notes: original metrics
##### Sessions
ENTRIES:
07:00-08:00 | exercise | Practice | original workout
09:00-10:00 | Practice | original study
##### Meals
###### Breakfast
is_leisure: 0
ENTRIES:
Eggs | 100
###### Lunch
is_leisure: 0
ENTRIES:
###### Dinner
is_leisure: 0
ENTRIES:
###### Snacks
is_leisure: 0
ENTRIES:
##### Transactions
ENTRIES:
12.5 | Cash | Practice | original money
##### Exercise Details
ENTRIES:
Run | [30min, 5km] | original sets
##### Milestones
ENTRIES:
Practice | First run ${date} | distance_km | 5 | 07:00-08:00
##### Stoicism
score: 4
notes: original stoicism
##### Admin Events
ENTRIES:
##### Valuation Rates
ENTRIES:
USD | 1
Gold | 2000
#### END`;
}

export function replacementInput(date = '2026-08-20') {
  return {
    noteDate: date, todayDate: '2026-08-22', fileName: `${date}.md`,
    filePath: `Journal/${date}.md`, sourceText: replacementNote(date),
    sourceChecksum: `original-${date}`, pluginVersion: 'test',
    nutritionThresholds: { mealCalorieLimitKcal: 0, dailyCalorieLimitKcal: 0, minimumProteinG: 0 },
  };
}
