import { makeDocument } from './ocr-core.js';
let cached = null;
const aborted = () => new DOMException('Cancelled', 'AbortError');
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted());
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
export function recognitionLanguage(language) {
  if (!['auto', 'eng', 'eng+chi_tra', 'eng+chi_sim'].includes(language)) throw new Error('Choose a supported recognition language.');
  return language === 'auto' ? 'eng+chi_tra+chi_sim' : language;
}
export async function recognizeLocal(image, { language = 'auto', signal, onProgress = () => {} }) {
  language = recognitionLanguage(language);
  if (signal.aborted) throw aborted();
  let entry = cached;
  if (entry && entry.language !== language) { cached = null; entry.promise.then(worker => worker.terminate()).catch(() => {}); entry = null; }
  if (!entry) {
    entry = { language, onProgress, promise: null };
    entry.promise = import('./vendor/ocr/tesseract.esm.min.js').then(({ default: Tesseract }) => Tesseract.createWorker(language, 1, {
      workerPath: new URL('./vendor/ocr/worker.min.js', import.meta.url).href,
      corePath: new URL('./vendor/ocr/core/', import.meta.url).href,
      langPath: new URL('./vendor/ocr/lang', import.meta.url).href,
      workerBlobURL: false,
      logger: message => entry.onProgress(message),
      errorHandler: () => {} // Errors are handled through the operation's rejected promise.
    }));
    cached = entry;
  }
  entry.onProgress = onProgress;
  const cancel = () => {
    if (cached === entry) cached = null;
    entry.onProgress = () => {};
    entry.promise.then(worker => worker.terminate()).catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const worker = await abortable(entry.promise, signal);
    const scale = Math.min(2, 2600 / Math.max(image.width, image.height), Math.sqrt(6_000_000 / (image.width * image.height)));
    const input = document.createElement('canvas'); input.width = Math.max(1, Math.round(image.width * scale)); input.height = Math.max(1, Math.round(image.height * scale));
    input.getContext('2d').drawImage(image, 0, 0, input.width, input.height);
    const pages = [];
    for (const mode of ['3', '11']) {
      if (signal.aborted) throw aborted();
      onProgress({ status: mode === '3' ? 'Reading text · pass 1 of 2' : 'Checking missed text · pass 2 of 2', progress: 0 });
      await abortable(worker.setParameters({ tessedit_pageseg_mode: mode }), signal);
      const result = await abortable(worker.recognize(input, {}, { blocks: true, text: true }), signal);
      pages.push(result.data);
    }
    return makeDocument(pages, image.width, image.height, input.width, input.height);
  } catch (error) {
    cancel();
    if (signal.aborted) throw aborted();
    throw new Error(error instanceof Error ? error.message : 'Local text recognition failed. Existing masks retained; add masks manually.');
  } finally {
    signal.removeEventListener('abort', cancel);
    entry.onProgress = () => {};
  }
}
