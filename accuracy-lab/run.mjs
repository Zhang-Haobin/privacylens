import { createWorker } from 'tesseract.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeDocument, localSuggestions, suggestionsToFields } from '../dist/ocr-core.js';

const root = new URL('./', import.meta.url);
const cases = JSON.parse(await readFile(new URL('cases.json', root), 'utf8'));
const results = new URL('results/', root);
await mkdir(results, { recursive: true });
let worker = null, currentLanguage = null;
const reports = [];
try {
  for (const sample of cases) {
    const language = sample.language || 'eng';
    if (language !== currentLanguage) {
      if (worker) await worker.terminate();
      worker = await createWorker(language, 1, {
        langPath: fileURLToPath(new URL('../dist/vendor/ocr/lang', root)),
        cachePath: fileURLToPath(results)
      });
      currentLanguage = language;
    }
    const input = fileURLToPath(new URL(`fixtures/${sample.label}.png`, root));
    const pages = [];
    for (const mode of ['3', '11']) {
      await worker.setParameters({ tessedit_pageseg_mode: mode });
      pages.push((await worker.recognize(input, {}, { blocks: true, text: true })).data);
    }
    const scale = sample.scale || 2;
    const document = makeDocument(pages, sample.width, sample.height, sample.width * scale, sample.height * scale);
    const fields = suggestionsToFields(localSuggestions(document), document);
    const checks = sample.checks.map(check => {
      const matches = document.words.filter(word => word.text.toLowerCase() === check.word.toLowerCase());
      const ratio = Math.max(0, ...matches.map(word => Math.min(1, fields.reduce((covered, field) => {
        if (field.category !== check.category) return covered;
        const [x, y, width, height] = field.rect;
        const b = word.bbox;
        const overlap = Math.max(0, Math.min(x + width, b.x1) - Math.max(x, b.x0)) * Math.max(0, Math.min(y + height, b.y1) - Math.max(y, b.y0));
        return covered + overlap / ((b.x1 - b.x0) * (b.y1 - b.y0));
      }, 0))));
      const pass = matches.length > 0 && (check.covered ? ratio >= 0.95 : ratio <= 0.05);
      return { ...check, foundByOCR: matches.length > 0, coverage: Number(ratio.toFixed(3)), pass };
    });
    reports.push({ label: sample.label, words: document.words.length, fields, checks });
    console.log(`${sample.label}: ${checks.filter(check => check.pass).length}/${checks.length} checks`);
  }
} finally { if (worker) await worker.terminate(); }
const passed = reports.flatMap(report => report.checks).filter(check => check.pass).length;
const total = reports.flatMap(report => report.checks).length;
await writeFile(new URL('latest.json', results), JSON.stringify({ passed, total, reports }, null, 2));
console.log(`Total: ${passed}/${total}; saved to accuracy-lab/results/latest.json`);
if (passed !== total) process.exitCode = 1;
