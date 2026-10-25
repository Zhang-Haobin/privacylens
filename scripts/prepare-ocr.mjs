import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const vendor = new URL('dist/vendor/ocr/', root);
await mkdir(new URL('core/', vendor), { recursive: true });
await mkdir(new URL('lang/', vendor), { recursive: true });
const copy = (source, target) => copyFile(new URL(`node_modules/${source}`, root), new URL(target, vendor));
await copy('tesseract.js/dist/tesseract.esm.min.js', 'tesseract.esm.min.js');
await copy('tesseract.js/dist/worker.min.js', 'worker.min.js');
for (const name of ['tesseract-core', 'tesseract-core-simd', 'tesseract-core-lstm', 'tesseract-core-simd-lstm']) {
  await copy(`tesseract.js-core/${name}.wasm.js`, `core/${name}.wasm.js`);
}
for (const lang of ['eng', 'chi_sim', 'chi_tra']) await copy(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, `lang/${lang}.traineddata.gz`);
const licenses = [];
for (const name of ['tesseract.js', 'tesseract.js-core']) {
  const info = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, root)));
  const license = await readFile(new URL(`node_modules/${name}/${name === 'tesseract.js' ? 'LICENSE.md' : 'LICENSE'}`, root), 'utf8');
  licenses.push(`${name} ${info.version}\n${license}`);
}
licenses.push('Language data: @tesseract.js-data/{eng,chi_sim,chi_tra} 1.0.0 (MIT packaging), https://github.com/naptha/tessdata. Tesseract trained data: Apache-2.0, https://github.com/tesseract-ocr/tessdata_best.');
await writeFile(new URL('LICENSES.txt', vendor), licenses.join('\n\n'));
console.log('Self-hosted OCR worker, WASM and three language models prepared in dist/vendor/ocr.');
