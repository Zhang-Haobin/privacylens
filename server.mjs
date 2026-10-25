import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { handleAI } from './lib/ai.js';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);
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
