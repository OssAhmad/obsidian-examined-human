import assert from 'node:assert/strict';
import test from 'node:test';
import { unresolvedReferencesFromErrors } from './unresolved-references.ts';

test('groups repeated unresolved references while retaining their contexts', () => {
  const references = unresolvedReferencesFromErrors([
    "Unknown engagement in session #1: 'Writing'.",
    "Unknown engagement in transaction #2: 'Writing'.",
    'Breakfast food "Lentil soup" is not in the Food Library. Add a canonical food or food alias before importing.',
    "Unknown exercise: 'Kettlebell swing'.",
  ]);
  assert.deepEqual(references, [
    { key: 'engagement:writing', kind: 'engagement', rawName: 'Writing', contexts: ['Session #1', 'Transaction #2'] },
    { key: 'exercise:kettlebell swing', kind: 'exercise', rawName: 'Kettlebell swing', contexts: ['Exercise details'] },
    { key: 'food:lentil soup', kind: 'food', rawName: 'Lentil soup', contexts: ['Meals'] },
  ]);
});
