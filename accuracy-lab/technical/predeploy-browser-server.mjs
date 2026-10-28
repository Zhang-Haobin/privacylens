// Local QA only. This server never calls a remote provider and never reads .env.
// It captures the real browser POST and exercises handleAI's invalid-ID retry.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAI } from '../../lib/ai.js';
import { fixtures } from './fixtures.mjs';
import {credentialAuditCases,auditDocument,payloadSafe} from './credential-audit-fixtures.mjs';
const root=resolve(fileURLToPath(new URL('../../dist/',import.meta.url)));
const resultRoot=new URL('../../qa/hardening-browser/',import.meta.url);await mkdir(resultRoot,{recursive:true});
const forbidden=[...fixtures.flatMap(f=>f.fields.filter(v=>v.category==='secret').map(v=>v.value)), 'demo_SECRET_K7p4x9Q2','K7p4x9Q2'];
const safe=body=>{
  const data=JSON.parse(body),lines=data.lines||JSON.parse(data.messages[1].content).lines;
  const compact=lines.map(line=>line.words.map(w=>w.text).join('')).join('').replace(/\s/g,'');
  return !forbidden.some(value=>body.includes(value)||compact.includes(value.replace(/\s/g,'')));
};
const captures=[];let errorMode=0;
const server=createServer(async(incoming,outgoing)=>{
  try {
    const url=new URL(incoming.url,'http://localhost');
    if(url.pathname==='/qa-audit.html'||url.pathname==='/qa-audit-fixtures.js') {
      const file=url.pathname.endsWith('.html')?'predeploy-browser.html':'credential-audit-fixtures.mjs';
      outgoing.writeHead(200,{'Content-Type':url.pathname.endsWith('.html')?'text/html':'text/javascript'});outgoing.end(await readFile(new URL(file,import.meta.url)));return;
    }
    if(url.pathname==='/qa-mode'&&incoming.method==='POST') { errorMode=Number(url.searchParams.get('status'));outgoing.writeHead(200);outgoing.end('Local error mode set');return; }
    if(url.pathname==='/qa-export-capture.js') { outgoing.writeHead(200,{'Content-Type':'text/javascript'});outgoing.end(await readFile(new URL('predeploy-browser-capture.js',import.meta.url)));return; }
    if(url.pathname==='/qa-export' && incoming.method==='POST') {
      const run=url.searchParams.get('run'); if(!['desktop-adjusted','mobile-adjusted'].includes(run))throw new Error('invalid run');
      const parts=[];let size=0;for await(const chunk of incoming){size+=chunk.length;if(size>20_000_000)throw new Error('oversized');parts.push(chunk);}
      const png=Buffer.concat(parts);if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('not png');
      await writeFile(new URL(run+'.png',resultRoot),png);outgoing.writeHead(200,{'Content-Type':'application/json'});outgoing.end(JSON.stringify({saved:run}));return;
    }
    if(url.pathname==='/api/ai'&&incoming.method==='POST'){
      let body='';for await(const chunk of incoming){body+=chunk;if(body.length>4_000_000)throw new Error('oversized');}
      if(errorMode){outgoing.writeHead(errorMode,{'Content-Type':'text/plain'});outgoing.end('Synthetic gateway error');return;}
      const fixture=credentialAuditCases.find(f=>f.id===incoming.headers['x-qa-case']);
      const fixtureSource=fixture?auditDocument(fixture.rows):null;
      const providerBodies=[];let attempts=0;
      const request=new Request(`http://${incoming.headers.host}${incoming.url}`,{method:'POST',headers:{'content-type':'application/json'},body});
      const response=await handleAI(request,{env:{OPENAI_API_KEY:'local-fixture-only',OPENAI_BASE_URL:'https://mock-provider.example/v1'},fetchImpl:async(_url,options)=>{
        attempts++;providerBodies.push(options.body);
        const input=JSON.parse(JSON.parse(options.body).messages[1].content);
        const fields=attempts===1?[{category:'secret',role:'unknown',wordIds:['w999999']}]:input.lines.flatMap(line=>{
          const wordIds=line.words.filter(w=>w.text.includes('[SECRET_')).map(w=>w.id);
          return wordIds.length?[{category:'secret',role:'unknown',wordIds}]:[];
        });
        return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({fields})}}]});
      }});
      const clientSafe=fixture?payloadSafe(body,fixture,fixtureSource):safe(body),providerSafe=providerBodies.every(b=>fixture?payloadSafe(b,fixture,fixtureSource):safe(b));
      const sameRetry=providerBodies.length===2&&JSON.parse(providerBodies[0]).messages[1].content===JSON.parse(providerBodies[1]).messages[1].content;
      captures.push({caseID:fixture?.id||'editor-ocr',clientSafe,providerSafe,sameRetry,attempts,...(clientSafe&&providerSafe?{clientBody:JSON.parse(body),providerBodies:providerBodies.map(JSON.parse)}:{})});
      await writeFile(new URL('browser-request-captures.json',resultRoot),JSON.stringify(captures,null,2));
      if(!clientSafe||!providerSafe||!sameRetry){outgoing.writeHead(502,{'Content-Type':'application/json'});outgoing.end('{"error":"Synthetic request screening check failed."}');return;}
      outgoing.writeHead(response.status,{'Content-Type':'application/json'});outgoing.end(await response.text());return;
    }
    if(incoming.method!=='GET'&&incoming.method!=='HEAD'){outgoing.writeHead(405);outgoing.end();return;}
    if(url.pathname.startsWith('/qa-fixtures/')){
      const id=url.pathname.slice('/qa-fixtures/'.length).replace(/\.png$/,'');
      if(!fixtures.some(f=>f.id===id))throw new Error('unknown fixture');
      outgoing.writeHead(200,{'Content-Type':'image/png'});outgoing.end(await readFile(new URL(`generated/${id}.png`,import.meta.url)));return;
    }
    const file=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.gz':'application/gzip','.txt':'text/plain','.map':'application/json'}[extname(file)];
    if(!file.startsWith(root+sep)||!mime)throw new Error('not public');
    let data=await readFile(file);if(extname(file)==='.html')data=Buffer.from(data.toString().replace('</body>','<script src="/qa-export-capture.js"></script></body>'));outgoing.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});outgoing.end(data);
  }catch{outgoing.writeHead(404);outgoing.end('Not found');}
});
server.listen(Number(process.env.PORT||4177),'127.0.0.1',()=>console.log('Local mock-provider QA: http://localhost:'+(process.env.PORT||4177)));
