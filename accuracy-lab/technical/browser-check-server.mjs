// Local QA only. This server never calls a remote provider and never reads .env.
// It captures the real browser POST and exercises handleAI's invalid-ID retry.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAI } from '../../lib/ai.js';
import { fixtures } from './fixtures.mjs';
const root=resolve(fileURLToPath(new URL('../../dist/',import.meta.url)));
const resultRoot=new URL('results/',import.meta.url);await mkdir(resultRoot,{recursive:true});
const forbidden=[...fixtures.flatMap(f=>f.fields.filter(v=>v.category==='secret').map(v=>v.value)), 'demo_SECRET_K7p4x9Q2','K7p4x9Q2'];
const safe=body=>{
  const data=JSON.parse(body),lines=data.lines||JSON.parse(data.messages[1].content).lines;
  const compact=lines.map(line=>line.words.map(w=>w.text).join('')).join('').replace(/\s/g,'');
  return !forbidden.some(value=>body.includes(value)||compact.includes(value.replace(/\s/g,'')));
};
const captures=[];
const server=createServer(async(incoming,outgoing)=>{
  try {
    const url=new URL(incoming.url,'http://localhost');
    if(url.pathname==='/api/ai'&&incoming.method==='POST'){
      let body='';for await(const chunk of incoming){body+=chunk;if(body.length>4_000_000)throw new Error('oversized');}
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
      const clientSafe=safe(body),providerSafe=providerBodies.every(safe);
      const sameRetry=providerBodies.length===2&&JSON.parse(providerBodies[0]).messages[1].content===JSON.parse(providerBodies[1]).messages[1].content;
      captures.push({clientSafe,providerSafe,sameRetry,attempts,...(clientSafe&&providerSafe?{clientBody:JSON.parse(body),providerBodies:providerBodies.map(JSON.parse)}:{})});
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
    const data=await readFile(file);outgoing.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});outgoing.end(data);
  }catch{outgoing.writeHead(404);outgoing.end('Not found');}
});
server.listen(Number(process.env.PORT||4175),'127.0.0.1',()=>console.log('Local mock-provider QA: http://localhost:'+(process.env.PORT||4175)));
