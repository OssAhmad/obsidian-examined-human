import type { Database, SqlValue } from 'sql.js';
import { queryRows, validateSchemaContract } from './sql.ts';
import { nullableNumber, nullableText } from './values.ts';

function validateDashboardSchema(db: Database, dashboard: string, contract: Record<string, string[]>): void {
  validateSchemaContract(db, contract, {
    missingSource: (table) => `${dashboard} requires table or view "${table}".`,
    missingColumns: (table, missing) => `${dashboard} source "${table}" is missing: ${missing.join(', ')}.`,
  });
}

const EXERCISE_DASHBOARD_COLUMNS: Record<string, string[]> = {
  sessions: ['id', 'engagement_id', 'date', 'duration_minutes', 'session_type_id', 'notes'],
  session_types: ['id', 'code'],
  engagements: ['id', 'name'],
  exercises: ['id', 'name', 'category'],
  session_exercises: ['id', 'session_id', 'exercise_id'],
  exercise_sets: [
    'id', 'session_exercise_id', 'weight', 'reps', 'distance', 'duration_minutes',
    'duration_seconds', 'pain_level',
  ],
  muscles: ['id', 'name', 'body_region'],
  exercise_muscles: ['exercise_id', 'muscle_id', 'role'],
};

export interface ExerciseDailyRecord {
  date: string;
  workoutCount: number;
  totalMinutes: number;
  setCount: number;
}

export interface ExercisePerformanceRecord {
  exerciseId: number;
  exerciseName: string;
  category: string | null;
  workoutCount: number;
  setCount: number;
  maxWeight: number | null;
  maxReps: number | null;
  loadVolume: number;
  totalDistance: number;
  measuredDurationMinutes: number;
  lastDate: string;
}

export interface ExerciseMuscleRecord {
  muscleName: string;
  bodyRegion: string | null;
  role: string | null;
  exposureSets: number;
  workoutCount: number;
}

export interface ExerciseWorkoutRecord {
  id: number;
  date: string;
  engagementName: string;
  durationMinutes: number;
  exerciseCount: number;
  setCount: number;
  loadVolume: number;
  totalDistance: number;
  measuredDurationMinutes: number;
  notes: string | null;
}

export interface ExerciseDashboardQueryResult {
  startDate: string | null;
  endDate: string;
  workoutCount: number;
  trainingDays: number;
  totalMinutes: number;
  detailedWorkoutCount: number;
  totalSets: number;
  setsWithoutMeasurements: number;
  painRecordedSets: number;
  daily: ExerciseDailyRecord[];
  exercises: ExercisePerformanceRecord[];
  muscles: ExerciseMuscleRecord[];
  recentWorkouts: ExerciseWorkoutRecord[];
}


export function queryExerciseDashboard(
  db: Database,
  startDate: string | null,
  endDate: string,
): ExerciseDashboardQueryResult {
  validateDashboardSchema(db, 'Exercise Dashboard', EXERCISE_DASHBOARD_COLUMNS);
  const rangeParams: SqlValue[] = [startDate, startDate, endDate];
  const workoutPredicate = `(session_type.code = 'exercise'
    OR EXISTS (SELECT 1 FROM session_exercises AS detail WHERE detail.session_id = session_row.id))`;

  const daily = queryRows(db, `
    SELECT session_row.date,
           COUNT(*) AS workout_count,
           COALESCE(SUM(CASE WHEN session_row.duration_minutes >= 0 THEN session_row.duration_minutes ELSE 0 END), 0) AS total_minutes,
           COALESCE(SUM((SELECT COUNT(*)
             FROM session_exercises AS link
             JOIN exercise_sets AS set_row ON set_row.session_exercise_id = link.id
             WHERE link.session_id = session_row.id)), 0) AS set_count
    FROM sessions AS session_row
    LEFT JOIN session_types AS session_type ON session_type.id = session_row.session_type_id
    WHERE ${workoutPredicate}
      AND (? IS NULL OR session_row.date >= ?)
      AND session_row.date <= ?
    GROUP BY session_row.date
    ORDER BY session_row.date
  `, rangeParams).map((row): ExerciseDailyRecord => ({
    date: String(row.date),
    workoutCount: Number(row.workout_count ?? 0),
    totalMinutes: Number(row.total_minutes ?? 0),
    setCount: Number(row.set_count ?? 0),
  }));

  const exercises = queryRows(db, `
    SELECT exercise.id AS exercise_id,
           exercise.name AS exercise_name,
           exercise.category,
           COUNT(DISTINCT session_row.id) AS workout_count,
           COUNT(set_row.id) AS set_count,
           MAX(set_row.weight) AS max_weight,
           MAX(set_row.reps) AS max_reps,
           COALESCE(SUM(CASE
             WHEN set_row.weight IS NOT NULL AND set_row.reps IS NOT NULL THEN set_row.weight * set_row.reps
             ELSE 0 END), 0) AS load_volume,
           COALESCE(SUM(set_row.distance), 0) AS total_distance,
           COALESCE(SUM(COALESCE(set_row.duration_minutes, set_row.duration_seconds / 60.0, 0)), 0) AS measured_duration_minutes,
           MAX(session_row.date) AS last_date
    FROM session_exercises AS link
    JOIN sessions AS session_row ON session_row.id = link.session_id
    LEFT JOIN session_types AS session_type ON session_type.id = session_row.session_type_id
    JOIN exercises AS exercise ON exercise.id = link.exercise_id
    LEFT JOIN exercise_sets AS set_row ON set_row.session_exercise_id = link.id
    WHERE ${workoutPredicate}
      AND (? IS NULL OR session_row.date >= ?)
      AND session_row.date <= ?
    GROUP BY exercise.id, exercise.name, exercise.category
    ORDER BY workout_count DESC, set_count DESC, exercise.name COLLATE NOCASE
  `, rangeParams).map((row): ExercisePerformanceRecord => ({
    exerciseId: Number(row.exercise_id),
    exerciseName: String(row.exercise_name),
    category: nullableText(row.category),
    workoutCount: Number(row.workout_count ?? 0),
    setCount: Number(row.set_count ?? 0),
    maxWeight: nullableNumber(row.max_weight),
    maxReps: nullableNumber(row.max_reps),
    loadVolume: Number(row.load_volume ?? 0),
    totalDistance: Number(row.total_distance ?? 0),
    measuredDurationMinutes: Number(row.measured_duration_minutes ?? 0),
    lastDate: String(row.last_date),
  }));

  const muscles = queryRows(db, `
    SELECT muscle.name AS muscle_name,
           muscle.body_region,
           mapping.role,
           COUNT(set_row.id) AS exposure_sets,
           COUNT(DISTINCT session_row.id) AS workout_count
    FROM exercise_muscles AS mapping
    JOIN muscles AS muscle ON muscle.id = mapping.muscle_id
    JOIN session_exercises AS link ON link.exercise_id = mapping.exercise_id
    JOIN sessions AS session_row ON session_row.id = link.session_id
    LEFT JOIN session_types AS session_type ON session_type.id = session_row.session_type_id
    LEFT JOIN exercise_sets AS set_row ON set_row.session_exercise_id = link.id
    WHERE ${workoutPredicate}
      AND (? IS NULL OR session_row.date >= ?)
      AND session_row.date <= ?
    GROUP BY muscle.id, muscle.name, muscle.body_region, mapping.role
    ORDER BY exposure_sets DESC, muscle.name COLLATE NOCASE
  `, rangeParams).map((row): ExerciseMuscleRecord => ({
    muscleName: String(row.muscle_name),
    bodyRegion: nullableText(row.body_region),
    role: nullableText(row.role),
    exposureSets: Number(row.exposure_sets ?? 0),
    workoutCount: Number(row.workout_count ?? 0),
  }));

  const recentWorkouts = queryRows(db, `
    SELECT session_row.id,
           session_row.date,
           session_row.duration_minutes,
           session_row.notes,
           engagement.name AS engagement_name,
           COUNT(DISTINCT link.exercise_id) AS exercise_count,
           COUNT(set_row.id) AS set_count,
           COALESCE(SUM(CASE
             WHEN set_row.weight IS NOT NULL AND set_row.reps IS NOT NULL THEN set_row.weight * set_row.reps
             ELSE 0 END), 0) AS load_volume,
           COALESCE(SUM(set_row.distance), 0) AS total_distance,
           COALESCE(SUM(COALESCE(set_row.duration_minutes, set_row.duration_seconds / 60.0, 0)), 0) AS measured_duration_minutes
    FROM sessions AS session_row
    LEFT JOIN session_types AS session_type ON session_type.id = session_row.session_type_id
    JOIN engagements AS engagement ON engagement.id = session_row.engagement_id
    LEFT JOIN session_exercises AS link ON link.session_id = session_row.id
    LEFT JOIN exercise_sets AS set_row ON set_row.session_exercise_id = link.id
    WHERE ${workoutPredicate}
      AND (? IS NULL OR session_row.date >= ?)
      AND session_row.date <= ?
    GROUP BY session_row.id, session_row.date, session_row.duration_minutes, session_row.notes, engagement.name
    ORDER BY session_row.date DESC, session_row.id DESC
    LIMIT 20
  `, rangeParams).map((row): ExerciseWorkoutRecord => ({
    id: Number(row.id),
    date: String(row.date),
    engagementName: String(row.engagement_name),
    durationMinutes: Math.max(0, Number(row.duration_minutes ?? 0)),
    exerciseCount: Number(row.exercise_count ?? 0),
    setCount: Number(row.set_count ?? 0),
    loadVolume: Number(row.load_volume ?? 0),
    totalDistance: Number(row.total_distance ?? 0),
    measuredDurationMinutes: Number(row.measured_duration_minutes ?? 0),
    notes: nullableText(row.notes),
  }));

  const quality = queryRows(db, `
    SELECT COUNT(set_row.id) AS total_sets,
           SUM(CASE WHEN set_row.weight IS NULL
                     AND set_row.reps IS NULL
                     AND set_row.distance IS NULL
                     AND set_row.duration_minutes IS NULL
                     AND set_row.duration_seconds IS NULL THEN 1 ELSE 0 END) AS missing_measurement_sets,
           SUM(CASE WHEN set_row.pain_level IS NOT NULL THEN 1 ELSE 0 END) AS pain_recorded_sets
    FROM exercise_sets AS set_row
    JOIN session_exercises AS link ON link.id = set_row.session_exercise_id
    JOIN sessions AS session_row ON session_row.id = link.session_id
    WHERE (? IS NULL OR session_row.date >= ?)
      AND session_row.date <= ?
  `, rangeParams)[0];
  const workoutCount = daily.reduce((sum, day) => sum + day.workoutCount, 0);

  return {
    startDate,
    endDate,
    workoutCount,
    trainingDays: daily.length,
    totalMinutes: daily.reduce((sum, day) => sum + day.totalMinutes, 0),
    detailedWorkoutCount: recentWorkouts.length >= workoutCount
      ? recentWorkouts.filter((workout) => workout.exerciseCount > 0).length
      : Number(queryRows(db, `
          SELECT COUNT(DISTINCT session_row.id) AS detailed_count
          FROM sessions AS session_row
          JOIN session_exercises AS link ON link.session_id = session_row.id
          WHERE (? IS NULL OR session_row.date >= ?)
            AND session_row.date <= ?
        `, rangeParams)[0]?.detailed_count ?? 0),
    totalSets: Number(quality?.total_sets ?? 0),
    setsWithoutMeasurements: Number(quality?.missing_measurement_sets ?? 0),
    painRecordedSets: Number(quality?.pain_recorded_sets ?? 0),
    daily,
    exercises,
    muscles,
    recentWorkouts,
  };
}

