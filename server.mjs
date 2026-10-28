import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { handleAI } from './lib/ai.js';
import { readdir } from 'node:fs/promises';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/intro.js', ['intro.js', 'text/javascript; charset=utf-8']],
  ['/intro.css', ['intro.css', 'text/css; charset=utf-8']],
  ['/mask-motion.js', ['mask-motion.js', 'text/javascript; charset=utf-8']],
  ['/mask-targets.js', ['mask-targets.js', 'text/javascript; charset=utf-8']],
  ['/mask-geometry.js', ['mask-geometry.js', 'text/javascript; charset=utf-8']],
  ['/ocr.js', ['ocr.js', 'text/javascript; charset=utf-8']],
  ['/ocr-core.js', ['ocr-core.js', 'text/javascript; charset=utf-8']],
  ['/technical-detection.js', ['technical-detection.js', 'text/javascript; charset=utf-8']],
  ['/contextual-detection.js', ['contextual-detection.js', 'text/javascript; charset=utf-8']],
  ['/sharing-context.js', ['sharing-context.js', 'text/javascript; charset=utf-8']],
  ['/editor-geometry.js', ['editor-geometry.js', 'text/javascript; charset=utf-8']],
  ['/privacy-types.js', ['privacy-types.js', 'text/javascript; charset=utf-8']],
  ['/document-context.js', ['document-context.js', 'text/javascript; charset=utf-8']],
  ['/field-state.js', ['field-state.js', 'text/javascript; charset=utf-8']],
  ['/samples.js', ['samples.js', 'text/javascript; charset=utf-8']],
  ['/workflow.js', ['workflow.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);
// Explicitly inventory public OCR assets; never expose arbitrary filesystem paths.
async function addAssets(directory = 'vendor/ocr') {
  for (const entry of await readdir(new URL(`./dist/${directory}/`, import.meta.url), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await addAssets(path);
    else files.set(`/${path}`, [path, path.endsWith('.js') ? 'text/javascript; charset=utf-8' : path.endsWith('.gz') ? 'application/gzip' : 'text/plain; charset=utf-8']);
  }
}
await addAssets();
const port = Number(process.env.PORT || 4173);
createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    if (url.pathname === '/api/ai') {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(name, value);
      const request = new Request(url, {
        method: incoming.method, headers,
        ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: incoming, duplex: 'half' } : {})
      });
      const response = await handleAI(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const file = files.get(url.pathname);
    if (!file || !['GET', 'HEAD'].includes(incoming.method)) { outgoing.writeHead(404); outgoing.end('Not found'); return; }
    const content = await readFile(new URL(`./dist/${file[0]}`, import.meta.url));
    outgoing.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
    outgoing.end(incoming.method === 'HEAD' ? undefined : content);
  } catch {
    outgoing.writeHead(500, { 'Content-Type': 'text/plain' }); outgoing.end('Request failed.');
  }
}).listen(port, '127.0.0.1', () => console.log(`PrivacyLens: http://localhost:${port}`));
