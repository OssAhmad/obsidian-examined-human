import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareValuationRateStage } from './valuation-rate-stage.ts';

function input(sourceText) {
  return {
    noteDate: '2026-09-01', fileName: '2026-09-01.md', filePath: 'Journal/2026-09-01.md', sourceText,
    lines: ['APARTMENT | 2300000', 'EUR | 1.1'],
  };
}

test('stages one bounded Valuation Rates set in its existing template section', async () => {
  const preview = await prepareValuationRateStage(input(`#### EH Daily Form
date: 2026-09-01
##### Valuation Rates
ENTRIES:
##### Transactions
ENTRIES:
#### END`));
  assert.match(preview.updatedText, /##### Valuation Rates\nENTRIES:\nAPARTMENT \| 2300000\nEUR \| 1\.1\n+##### Transactions/);
  assert.doesNotMatch(preview.updatedText, /1\.1#### END/);
});

test('rejects a second rate set in the same Daily Note', async () => {
  await assert.rejects(
    prepareValuationRateStage(input(`#### EH Daily Form
date: 2026-09-01
##### Valuation Rates
ENTRIES:
USD | 1
#### END`)),
    /only one rate set/i,
  );
});
