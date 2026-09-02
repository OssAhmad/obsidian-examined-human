import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareFinanceEntryStage } from './finance-entry-stage.ts';

function input(sourceText) {
  return {
    noteDate: '2026-09-01', fileName: '2026-09-01.md', filePath: 'Journal/2026-09-01.md', sourceText,
    line: '-80 | Main Account | Finance | [EH reconciliation] forgotten expense',
  };
}

test('stages a financial entry on its own line before the EH Daily Form end marker', async () => {
  const preview = await prepareFinanceEntryStage(input(`#### EH Daily Form
date: 2026-09-01
##### Transactions
ENTRIES:
#### END`));
  assert.match(preview.updatedText, /ENTRIES:\n-80 \| Main Account \| Finance \| \[EH reconciliation\] forgotten expense\n+#### END/);
  assert.doesNotMatch(preview.updatedText, /expense#### END/);
});

test('creates a bounded Transactions section without changing private note text', async () => {
  const preview = await prepareFinanceEntryStage(input(`Private header

#### EH Daily Form
date: 2026-09-01
##### Sessions
ENTRIES:

#### END

Private footer`));
  assert.match(preview.updatedText, /##### Transactions\nENTRIES:\n-80 \| Main Account/);
  assert.match(preview.updatedText, /^Private header/m);
  assert.match(preview.updatedText, /Private footer$/);
});
