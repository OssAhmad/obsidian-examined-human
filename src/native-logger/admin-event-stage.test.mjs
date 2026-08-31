import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareAdminEventStage } from './admin-event-stage.ts';

const command = 'ENGAGEMENT_COMPLETE | Project Alpha';

function input(sourceText) {
  return {
    noteDate: '2026-08-25',
    fileName: '2026-08-25.md',
    filePath: 'Journal/2026-08-25.md',
    sourceText,
    sourceChecksum: 'source-checksum',
    command,
  };
}

test('stages an Admin Event directly below an existing ENTRIES marker', () => {
  const source = `Private template\n\n#### EH Form\n\n##### Sessions\nENTRIES:\n\n##### Admin Events\nENTRIES:\nACCOUNT_ALIAS | Cash | Wallet\n\n#### END\n\nPrivate footer`;
  const preview = prepareAdminEventStage(input(source));
  assert.match(preview.updatedText, /ENTRIES:\nENGAGEMENT_COMPLETE \| Project Alpha\nACCOUNT_ALIAS/);
  assert.match(preview.updatedText, /^Private template/m);
  assert.match(preview.updatedText, /Private footer$/);
});

test('creates an Admin Events section inside the bounded EH Form when missing', () => {
  const source = `#### EH Form\n\n##### Sessions\nENTRIES:\n\n#### END`;
  const preview = prepareAdminEventStage(input(source));
  assert.match(preview.updatedText, /##### Admin Events\nENTRIES:\nENGAGEMENT_COMPLETE \| Project Alpha\n#### END/);
});

test('stages a dependent create and alias pair together in command order', () => {
  const preview = prepareAdminEventStage({
    ...input(`#### EH Form\n\n##### Sessions\nENTRIES:\n\n#### END`),
    commands: [
      'ENGAGEMENT_CREATE | Project Alpha | academic | active |',
      'ENGAGEMENT_ALIAS_ADD | Project Alpha | [Alpha]',
    ],
  });
  assert.deepEqual(preview.commands, [
    'ENGAGEMENT_CREATE | Project Alpha | academic | active |',
    'ENGAGEMENT_ALIAS_ADD | Project Alpha | [Alpha]',
  ]);
  assert.match(preview.updatedText, /ENGAGEMENT_CREATE \| Project Alpha \| academic \| active \|\nENGAGEMENT_ALIAS_ADD \| Project Alpha \| \[Alpha\]/);
});

test('always terminates staged commands before the EH Form end marker', () => {
  const preview = prepareAdminEventStage(input(`#### EH Form
##### Admin Events
ENTRIES:
#### END`));
  assert.match(preview.updatedText, /ENGAGEMENT_COMPLETE \| Project Alpha\n#### END/);
  assert.doesNotMatch(preview.updatedText, /Project Alpha#### END/);
});

test('does not treat a private Admin Events heading outside EH Form as writable', () => {
  const source = `##### Admin Events\nENTRIES:\nPRIVATE_COMMAND\n\n#### EH Form\n\n##### Sessions\nENTRIES:\n\n#### END`;
  const preview = prepareAdminEventStage(input(source));
  assert.match(preview.updatedText, /PRIVATE_COMMAND/);
  assert.match(preview.updatedText, /##### Admin Events\nENTRIES:\nENGAGEMENT_COMPLETE \| Project Alpha\n#### END/);
});

test('rejects a duplicate command and malformed EH Form bounds', () => {
  assert.throws(
    () => prepareAdminEventStage(input(`#### EH Form\n\n##### Admin Events\nENTRIES:\n${command}\n\n#### END`)),
    /already staged/,
  );
  assert.throws(() => prepareAdminEventStage(input('##### Admin Events\nENTRIES:')), /no #### EH Form/);
  assert.throws(() => prepareAdminEventStage(input('#### EH Form\n##### Admin Events')), /no matching #### END/);
});
