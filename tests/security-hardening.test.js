import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialAuditCases, auditDocument, auditEnv } from '../accuracy-lab/technical/credential-audit-fixtures.mjs';
import { textPayload } from '../dist/ocr-core.js';
import { sanitizeOCRLines } from '../dist/technical-detection.js';
import { handleAI } from '../lib/ai.js';
import { AI_BUDGET } from '../dist/ai-policy.js';
import { readAPI } from '../dist/api-client.js';
import { readFile } from 'node:fs/promises';
const request = body => new Request('https://site.example/api/ai?action=classify-text',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const completion = fields => Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({fields})}}]});
const invalid = [{category:'secret',role:'unknown',wordIds:['w99999']}];
for (const fixture of credentialAuditCases.filter(c=>!c.limitation)) {
  test(`outgoing credential screening: ${fixture.id}`, async()=>{
    const doc=auditDocument(fixture.rows), original=JSON.stringify(doc), client=textPayload(doc);
    const check=lines=>{
      const byID=new Map(lines.flatMap(l=>l.words).map(w=>[w.id,w.text]));
      for (const [row,col] of fixture.sensitive) assert.match(byID.get(doc.lines[row].words[col].id),/^\[SECRET_[A-Z_]+\d+\]$/, 'Unscreened credential fragment');
      for (const [row,col] of fixture.keep||[]) assert.equal(byID.get(doc.lines[row].words[col].id),doc.lines[row].words[col].text,'Unrelated diagnostic was screened');
      const compact=lines.map(l=>l.words.map(w=>w.text).join('')).join('').normalize('NFKC');
      for (const [row,col] of fixture.sensitive) assert.ok(!compact.includes(doc.lines[row].words[col].text.normalize('NFKC')), 'Credential fragment remains in serialized text');
    };
    check(client.lines);
    assert.equal(JSON.stringify(doc),original);
    assert.deepEqual(client.lines.flatMap(l=>l.words.map(w=>w.id)),doc.words.map(w=>w.id));
    const boxes=client.lines.flatMap(l=>l.words.map(w=>w.box));
    assert.deepEqual(sanitizeOCRLines(client.lines).lines.flatMap(l=>l.words.map(w=>w.box)),boxes);
    for (const payload of [client,{...client,lines:doc.lines.map((line,i)=>({id:line.id,words:line.words.map((w,j)=>({id:w.id,text:w.text,box:client.lines[i].words[j].box}))}))}]) {
      const sent=[];
      const response=await handleAI(request(payload),{env:auditEnv,fetchImpl:async(_url,options)=>{
        const lines=JSON.parse(JSON.parse(options.body).messages[1].content).lines; check(lines); sent.push(lines);
        return completion(sent.length===1?invalid:[]);
      }});
      assert.equal(response.status,200); assert.equal(sent.length,2); assert.deepEqual(sent[0],sent[1]);
    }
  });
}

test('unknown unlabelled values are a documented detection limitation',()=>{
  const source=auditDocument([['FAKE_AUDIT_SECRET_8mQ7xP2']]);
  assert.equal(textPayload(source).lines[0].words[0].text,source.words[0].text);
});

test('retry uses remaining budget and a late invalid ID cannot reset the clock',async()=>{
  const body=textPayload(auditDocument([['DB_PASSWORD=','FAKE_timeout_77']]));
  let elapsed=0, calls=0; const signals=[];
  const response=await handleAI(request(body),{env:auditEnv,now:()=>elapsed,fetchImpl:async(_url,options)=>{
    signals.push(options.signal); calls++;
    elapsed=calls===1?34_000:46_000;
    return completion(calls===1?invalid:[]);
  }});
  assert.equal(response.status,200); assert.equal(calls,2);
  // Capture the timers actually handed to AbortSignal, rather than duplicating constants.
  elapsed=0; calls=0;
  const budgets=[]; const originalTimeout=AbortSignal.timeout;
  AbortSignal.timeout=ms=>{budgets.push(ms);return originalTimeout(ms);};
  try {
    const late=await handleAI(request(body),{env:auditEnv,now:()=>elapsed,fetchImpl:async()=>{calls++;elapsed=44_000;return completion(invalid);}});
    assert.equal(late.status,504);assert.equal(calls,1);
    elapsed=0;calls=0;budgets.length=0;
    const retry=await handleAI(request(body),{env:auditEnv,now:()=>elapsed,fetchImpl:async()=>{calls++;elapsed=calls===1?34_000:46_000;return completion(calls===1?invalid:[]);}});
    assert.equal(retry.status,200);assert.deepEqual(budgets,[35_000,14_000]);
    elapsed=0;calls=0;
    const tooLate=await handleAI(request(body),{env:auditEnv,now:()=>elapsed,fetchImpl:async()=>{calls++;elapsed=49_000;return completion([]);}});
    assert.equal(tooLate.status,504);assert.equal(calls,1);
  } finally { AbortSignal.timeout=originalTimeout; }
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url)));
  assert.ok(AI_BUDGET.backendMs<=config.functions['api/ai.js'].maxDuration*1000-5000);
  assert.ok(AI_BUDGET.browserMs>AI_BUDGET.backendMs&&AI_BUDGET.browserMs<config.functions['api/ai.js'].maxDuration*1000);
});

test('global deadline covers stalled request input and aborts before any provider call',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let cancelled=false,calls=0;
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}});
  const pending=handleAI(new Request('https://site.example/api/ai?action=classify-text',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'}),{env:auditEnv,fetchImpl:async()=>{calls++;return completion([]);}});
  t.mock.timers.tick(AI_BUDGET.backendMs);
  assert.equal((await pending).status,504);assert.equal(calls,0);assert.equal(cancelled,true);
});

test('global deadline covers slow provider response body and cancels transport',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let signal; let started;
  const ready=new Promise(resolve=>{started=resolve;});
  const pending=handleAI(request(textPayload(auditDocument([['Name:','Alex']]))),{env:auditEnv,fetchImpl:async(_url,options)=>{
    signal=options.signal;started();return {ok:true,json:()=>new Promise(()=>{})};
  }});
  await ready;t.mock.timers.tick(AI_BUDGET.backendMs);
  assert.equal((await pending).status,504);assert.equal(signal.aborted,true);
});

test('image endpoint is disabled by default even with consent and configured provider',async()=>{
  for(const consent of [true,false]) {
    const response=await handleAI(new Request('https://site.example/api/ai?action=detect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({consent,image:'synthetic'})}),{env:auditEnv,fetchImpl:()=>assert.fail('Disabled endpoint contacted provider')});
    assert.equal(response.status,410);
  }
});

for(const [status,expected] of [[413,/too large/],[429,/rate limited/],[502,/unavailable/],[503,/unavailable/],[504,/timed out/],[500,/HTTP 500/]]) {
  test(`non-JSON HTTP ${status} explains the real failure`,async()=>{
    for(const body of ['<html>gateway error</html>','upstream error']) await assert.rejects(readAPI(new Response(body,{status})),error=>expected.test(error.message)&&/masks are unchanged/.test(error.message)&&!/npm run dev/.test(error.message));
  });
}
test('JSON API messages survive and malformed successful responses fail safely',async()=>{
  await assert.rejects(readAPI(Response.json({error:'Provider quota exceeded'},{status:429})),/Provider quota exceeded/);
  await assert.rejects(readAPI(new Response('gateway html')),/invalid response/);
  await assert.rejects(readAPI(Response.json(null)),/invalid response/);
});

test('a schema failure anywhere in the result prevents ID-recovery retries',async()=>{
  let calls=0;
  const response=await handleAI(request(textPayload(auditDocument([['Name:','Alex']]))),{env:auditEnv,fetchImpl:async()=>{
    calls++;return completion([...invalid,{category:'secret',role:'unknown',wordIds:['w1'],box:[0,0,1,1]}]);
  }});
  assert.equal(response.status,502);assert.equal(calls,1);assert.ok(!(await response.json()).fields);
});

test('OCR-split Cookie labels screen every cookie value across semicolons',async()=>{
  const client=textPayload(auditDocument([['Coo','kie:','session=FAKE_COOKIE_77;','csrf=FAKE_CSRF_88']]));
  const serialized=JSON.stringify(client);
  assert.ok(!serialized.includes('FAKE_COOKIE_77')&&!serialized.includes('FAKE_CSRF_88'));
  let calls=0;
  const response=await handleAI(request(client),{env:auditEnv,fetchImpl:async(_url,options)=>{
    calls++;assert.ok(!options.body.includes('FAKE_COOKIE_77')&&!options.body.includes('FAKE_CSRF_88'));
    return completion(calls===1?invalid:[]);
  }});
  assert.equal(response.status,200);assert.equal(calls,2);
});
