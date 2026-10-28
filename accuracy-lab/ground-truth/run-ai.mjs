// Sends only this lab's fictional OCR text/layout to the already configured provider.
import { readFile, writeFile } from 'node:fs/promises';
import { handleAI } from '../../lib/ai.js';
import { textPayload, validateClassifications, localSuggestions, suggestionsToFields } from '../../dist/ocr-core.js';
import { applyRecommendations, guardSuggestedReveals } from '../../dist/sharing-context.js';
import { activeMasks, reconcileFields } from '../../dist/field-state.js';

const root = new URL('./', import.meta.url);
const samples = JSON.parse(await readFile(new URL('runs/ocr-pipeline.json', root), 'utf8'));
const successes = [], failures = [];
async function analyze(sample) {
  try {
    const body = textPayload(sample.document);
    const response = await handleAI(new Request('http://localhost:4173/api/ai?action=classify-text', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }));
    const data = await response.json();
    if (!response.ok) { failures.push({ id: sample.id, status: response.status, error: data.error }); console.log(`${sample.id}: failed (${response.status})`); return; }
    const classified = validateClassifications(data.fields, sample.document);
    const proposed = suggestionsToFields([...classified, ...localSuggestions(sample.document)], sample.document).map((field, index) => ({ ...field, id: `ai-scan-${index + 1}` }));
    const previous = sample.current.fields;
    const context = { documentType: sample.type, context: 'public', purpose: sample.purpose };
    const reconciled = reconcileFields(previous, proposed);
    const fields = guardSuggestedReveals(previous, applyRecommendations(reconciled.fields, context));
    successes.push({ ...sample, ai: { fields, masks: activeMasks(fields, []) } });
    console.log(`${sample.id}: classified (${classified.length} AI groups, ${fields.length} final fields)`);
  } catch (error) {
    failures.push({ id: sample.id, error: error.message }); console.log(`${sample.id}: failed`);
  }
}
// Bound simultaneous requests; every input is synthetic and no image is sent.
for (let i = 0; i < samples.length; i += 2) await Promise.all(samples.slice(i, i + 2).map(analyze));
await writeFile(new URL('runs/ocr-ai-pipeline.json', root), JSON.stringify(successes, null, 2));
await writeFile(new URL('runs/ai-status.json', root), JSON.stringify({ attempted: samples.length, succeeded: successes.length, failures }, null, 2));
console.log(`AI completed: ${successes.length}/${samples.length}; failures listed in runs/ai-status.json`);
