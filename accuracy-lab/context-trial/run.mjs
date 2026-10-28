import { createWorker } from 'tesseract.js';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as before from './baseline-ocr-core.js';
import * as current from '../../dist/ocr-core.js';
import { classifyDocument } from '../../dist/document-context.js';
import { applyRecommendations } from '../../dist/sharing-context.js';
import { activeMasks } from '../../dist/field-state.js';

const root = new URL('../ground-truth/', import.meta.url);
const holdout = process.argv.includes('--holdout');
let documents;
if (holdout && !process.argv.includes('--replay')) {
  const manifest = JSON.parse(await readFile(new URL('runs/holdout-inputs.json', root)));
  const worker = await createWorker('eng+chi_tra+chi_sim', 1, { langPath: fileURLToPath(new URL('../../dist/vendor/ocr/lang', root)), cachePath: fileURLToPath(new URL('../results', root)) });
  documents = [];
  try {
    for (const sample of manifest) {
      const pages = [], image = fileURLToPath(new URL(`runs/input/${sample.id}.png`, root));
      for (const mode of ['3','11']) {
        await worker.setParameters({ tessedit_pageseg_mode: mode });
        pages.push((await worker.recognize(image, {}, { blocks:true, text:true })).data);
      }
      const document = current.makeDocument(pages, sample.width, sample.height, sample.inputWidth, sample.inputHeight);
      const type = classifyDocument(document).type;
      const purpose = { delivery:'share', transcript:'showcase', chat:'post', general:'share' }[type];
      documents.push({ ...sample, document, type, purpose });
      console.log(`${sample.id}: ${document.words.length} OCR words`);
    }
  } finally { await worker.terminate(); }
  await writeFile(new URL('runs/context-holdout-documents.json', root), JSON.stringify(documents, null, 2));
} else {
  documents = JSON.parse(await readFile(new URL(holdout ? 'runs/context-holdout-documents.json' : 'runs/ocr-pipeline.json', root)));
}
const result = documents.map(sample => {
  const ctx = { documentType:sample.type, context:'public', purpose:sample.purpose };
  const build = core => {
    const fields = applyRecommendations(core.suggestionsToFields(core.localSuggestions(sample.document), sample.document), ctx);
    return { fields, masks:activeMasks(fields, []) };
  };
  return { ...sample, before:build(before), current:build(current) };
});
const name = holdout ? 'context-holdout.json' : 'context-existing.json';
await writeFile(new URL(`runs/${name}`, root), JSON.stringify(result, null, 2));
console.log(`Saved ${name}: ${result.length} images`);
