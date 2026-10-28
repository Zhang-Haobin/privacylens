import { createWorker } from 'tesseract.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeDocument, localSuggestions, suggestionsToFields } from '../../dist/ocr-core.js';
import { classifyDocument } from '../../dist/document-context.js';
import { applyRecommendations } from '../../dist/sharing-context.js';
import { activeMasks } from '../../dist/field-state.js';

const root = new URL('./', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('runs/inputs.json', root), 'utf8'));
// Frozen pre-refinement rules are kept only for repeatable comparisons.
const baseline = await import('./baseline-ocr-core.js');
await mkdir(new URL('../results/', root), { recursive: true });
const worker = await createWorker('eng+chi_tra+chi_sim', 1, {
  langPath: fileURLToPath(new URL('../../dist/vendor/ocr/lang', root)),
  cachePath: fileURLToPath(new URL('../results', root))
});
const results = [];
try {
  for (const sample of manifest) {
    const pages = [];
    const image = fileURLToPath(new URL(`runs/input/${sample.id}.png`, root));
    for (const mode of ['3', '11']) {
      await worker.setParameters({ tessedit_pageseg_mode: mode });
      pages.push((await worker.recognize(image, {}, { blocks: true, text: true })).data);
    }
    const doc = makeDocument(pages, sample.width, sample.height, sample.inputWidth, sample.inputHeight);
    const type = classifyDocument(doc).type;
    const purpose = { delivery: 'share', transcript: 'showcase', chat: 'post', general: 'share' }[type];
    const context = { documentType: type, context: 'public', purpose };
    const build = (detect, convert) => {
      const fields = applyRecommendations(convert(detect(doc), doc), context);
      return { fields, masks: activeMasks(fields, []) };
    };
    const current = build(localSuggestions, suggestionsToFields);
    const before = build(baseline.localSuggestions, baseline.suggestionsToFields);
    results.push({ ...sample, type, purpose, document: doc, current, before });
    console.log(`${sample.id}: ${doc.words.length} OCR words, ${current.fields.length} fields, type ${type}`);
  }
} finally { await worker.terminate(); }
await writeFile(new URL('runs/ocr-pipeline.json', root), JSON.stringify(results, null, 2));
