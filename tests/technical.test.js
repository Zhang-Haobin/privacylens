import test from 'node:test';
import assert from 'node:assert/strict';
import { textPayload, localSuggestions, suggestionsToFields } from '../dist/ocr-core.js';
import { credentialFindings, sanitizeOCRLines } from '../dist/technical-detection.js';
import { classifyDocument } from '../dist/document-context.js';
import { recommendField, applyRecommendations } from '../dist/sharing-context.js';
import { sharingProfiles } from '../dist/workflow.js';
import { handleAI } from '../lib/ai.js';
import { reconcileFields } from '../dist/field-state.js';

function doc(rows) {
  let id = 0;
  const lines = rows.map((row, index) => {
    let x = 10;
    const words = (Array.isArray(row) ? row : row.split(' ')).map(text => {
      const word = { id: `w${++id}`, text, bbox: { x0:x, x1:x + text.length * 8, y0:10 + index * 30, y1:30 + index * 30 } }; x = word.bbox.x1 + 8; return word;
    });
    return { id:`l${index + 1}`, text:words.map(w => w.text).join(' '), words };
  });
  return {width:2000,height:1500,lines,words:lines.flatMap(l => l.words)};
}

test('browser payload screens labelled, split, repeated and URL credentials without mutating OCR IDs or boxes', () => {
  const source = doc([
    ['API_KEY=', 'FAKEalpha77', 'betaSecret88'],
    ['echo', 'FAKEalpha77betaSecret88', 'FAKEalpha77betaSecret88'],
    ['Authorization:', 'Bearer', 'FAKEbearer42', 'payloadSignature99'],
    ['password="two', 'synthetic', 'words!"'],
    ['postgresql://demo:FAKEdbPassword77@database.corp.local/demo'],
    ['https://service.example/callback?access_token=FAKEquerySecret88'],
    ['Door', 'code:', '4821'],
    ['TypeError:', 'Cannot', 'read', 'properties'],
    ['Docs:', 'https://developer.mozilla.org'],
    ['Node.js', 'v22.9.0']
  ]);
  const before = JSON.stringify(source), payload = textPayload(source), serialized = JSON.stringify(payload);
  for (const value of ['FAKEalpha77','betaSecret88','FAKEbearer42','payloadSignature99','synthetic','words!','FAKEdbPassword77','FAKEquerySecret88','4821']) assert.ok(!serialized.includes(value), 'A fixture credential leaked');
  assert.equal(JSON.stringify(source),before);
  assert.deepEqual(payload.lines.flatMap(l => l.words.map(w => w.id)),source.words.map(w => w.id));
  assert.equal(payload.lines.at(-1).words[1].text,'v22.9.0');
  assert.equal(payload.lines.at(-2).words[1].text,'https://developer.mozilla.org');
  assert.ok(serialized.includes('[SECRET_'));
  assert.deepEqual(payload.lines[0].words[0].box,[0.005,0.0067,0.032,0.0133]);
});

test('wrapped values and private key blocks use conservative structural placeholders', () => {
  const source=doc(['access_token=', 'WRAPPEDfakeSecretLong88', 'TypeError: failed', '-----BEGIN PRIVATE KEY-----', 'FAKEencodedPrivateMaterial99', '-----END PRIVATE KEY-----', 'public documentation']);
  const body=JSON.stringify(textPayload(source));
  assert.ok(!body.includes('WRAPPEDfakeSecretLong88')); assert.ok(!body.includes('FAKEencodedPrivateMaterial99'));
  assert.ok(body.includes('TypeError:')); assert.ok(body.includes('documentation'));
});

test('short next-row passwords and wrapped credential-bearing connection strings are screened',()=>{
  const source=doc(['password=', 'abc', 'TypeError: invalid input','DATABASE_URL=postgresql://demo:', 'FAKEwrappedPass77@db.corp.local/app','Node.js v22.9.0']);
  const body=JSON.stringify(textPayload(source));
  assert.ok(!body.includes('"abc"'));assert.ok(!body.includes('FAKEwrappedPass77'));
  assert.ok(body.includes('TypeError:'));assert.ok(body.includes('v22.9.0'));
});

test('cookie headers and common token assignments do not leave later session values on the wire',()=>{
  const source=doc(['Cookie: session=FAKEcookieA99; csrf=FAKEcookieB88','token=FAKEgenericToken77','private_key=FAKEprivateKey77']);
  const body=JSON.stringify(textPayload(source));
  for(const secret of ['FAKEcookieA99','FAKEcookieB88','FAKEgenericToken77','FAKEprivateKey77']) assert.ok(!body.includes(secret));
});

test('OCR spaces inside connection strings are screened without consuming the following public config line',()=>{
  const source=doc([['DATABASE_URL=postgresql://demo:','FAKE_DB_pw77@db.corp.','local/app'],['client_secret=FAKE_client_Secret_78'],['PUBLIC_DOCS=https://developer.mozilla.org']]);
  const payload=textPayload(source);
  assert.ok(!JSON.stringify(payload).includes('FAKE_DB_pw77'));
  assert.equal(payload.lines[2].words[0].text,'PUBLIC_DOCS=https://developer.mozilla.org');
  assert.ok(localSuggestions(doc(['Host: build.corp. local'])).find(f=>f.category==='internal_endpoint').wordIds.length===2);
});

test('technical classification needs independent contextual signals and keeps negative cases general or chat', () => {
  for (const rows of [
    ['TypeError: Cannot read properties', 'at loadProfile (app.js:42:7)'],
    ['Traceback (most recent call last):','File "main.py", line 17','ValueError: missing input'],
    ['java.lang.NullPointerException: missing user','at demo.Main.start(Main.java:12)'],
    ['POST /api/users 500', 'Chrome/130'],
    ['API_KEY=FAKEconfigSecret42','Node.js v22.9.0']
  ]) assert.equal(classifyDocument(doc(rows)).type,'technical_screenshot');
  for (const text of ['I got an error yesterday','token expired','const username = user.name;','Docs: https://developer.mozilla.org','random123456789abc']) assert.equal(classifyDocument(doc([text])).type,'general');
  assert.equal(classifyDocument(doc(['DemoChat','CHAT CONVERSATION','I got an error yesterday','10:42 Delivered'])).type,'chat');
});

test('personal paths and ambiguous internal hosts are covered while independent debugging content stays useful', () => {
  const source=doc(['File: /Users/alex/private/config.js app.js:42', 'Path: C:\\Users\\Alex\\project\\app.js', 'Host: build.corp.local 192.168.1.10', 'Docs: https://developer.mozilla.org localhost:3000 8.8.8.8','TypeError: undefined','Node.js v22.9.0','const username = user.name;']);
  const fields=suggestionsToFields(localSuggestions(source),source);
  assert.equal(fields.filter(f=>f.category==='personal_path').length,2);
  assert.ok(fields.some(f=>f.category==='internal_endpoint'));
  for(const word of source.words.filter(w=>['app.js:42','https://developer.mozilla.org','localhost:3000','8.8.8.8','TypeError:','v22.9.0','username'].includes(w.text))) assert.ok(!fields.some(f=>f.wordIds.includes(word.id)), 'Useful debugging information was selected');
  for(const profile of sharingProfiles('technical_screenshot').filter(p=>p.id!=='custom')) {
    const context={documentType:'technical_screenshot',context:profile.audience,purpose:profile.purpose};
    assert.equal(recommendField({category:'secret'},context).action,'redact');
    assert.equal(recommendField({category:'personal_path'},context).action,'redact');
    assert.equal(recommendField({category:'internal_endpoint'},context).action,'review');
  }
  assert.equal(recommendField({category:'account'},{documentType:'technical_screenshot',context:'support',purpose:'software_support'}).action,'review');
});

test('generic token discussion and random strings are not credentials', () => {
  const source=doc(['The token expired yesterday','const username = user.name;', 'Example variable: token', 'random123456789abc', 'http://localhost:3000', 'https://docs.example.org']);
  assert.deepEqual(credentialFindings(source.lines),[]);
  assert.equal(sanitizeOCRLines(source.lines).screenedWords,0);
});

test('sanitized wire lines whitelist fields and cannot leak alternative raw transcripts',()=>{
  const lines=[{id:'l1',text:'password=FAKEhiddenProperty88',words:[{id:'w1',text:'password=FAKEhiddenProperty88',originalText:'FAKEhiddenProperty88',box:[0,0,.2,.1]}]}];
  const screened=sanitizeOCRLines(lines).lines;
  assert.ok(!JSON.stringify(screened).includes('FAKEhiddenProperty88'));
  assert.deepEqual(Object.keys(screened[0]),['id','words']);
  assert.deepEqual(Object.keys(screened[0].words[0]),['id','text','box']);
});

test('serialized client request and both provider attempts contain no known fixture secrets', async () => {
  const source=doc([['API_KEY=','FAKE_network_secret77'],['echo','FAKE_network_secret77']]);
  const raw=JSON.stringify(source), clientBody=JSON.stringify(textPayload(source));
  assert.ok(!clientBody.includes('FAKE_network_secret77'));
  const bodies=[];
  const request=new Request('https://site.example/api/ai?action=classify-text',{method:'POST',headers:{'Content-Type':'application/json'},body:clientBody});
  const response=await handleAI(request,{env:{OPENAI_API_KEY:'fixture-key',OPENAI_BASE_URL:'https://provider.example/v1'},fetchImpl:async(url,options)=>{
    bodies.push(options.body);
    assert.ok(!options.body.includes('FAKE_network_secret77'));
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({fields:[{category:'secret',role:'unknown',wordIds:[bodies.length===1?'w999':'w2']}]})}}]});
  }});
  assert.equal(response.status,200); assert.equal(bodies.length,2);
  assert.deepEqual(JSON.parse(bodies[0]).messages[1],JSON.parse(bodies[1]).messages[1]);
  assert.equal(JSON.stringify(source),raw);
});

test('direct text clients are also screened before the provider; consent and ID validation still apply',async()=>{
  const lines=[{id:'l1',words:[{id:'w1',text:'password=FAKEdirectSecret55',box:[0,0,0.5,0.1]}]}];
  let calls=0;
  const invoke=consent=>handleAI(new Request('https://site.example/api/ai?action=classify-text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({width:100,height:100,consent,lines})}),{env:{OPENAI_API_KEY:'fixture-key',OPENAI_BASE_URL:'https://provider.example/v1'},fetchImpl:async(url,options)=>{
    calls++; assert.ok(!options.body.includes('FAKEdirectSecret55'));
    return Response.json({choices:[{finish_reason:'stop',message:{content:'{"fields":[]}'}}]});
  }});
  assert.equal((await invoke(false)).status,400); assert.equal(calls,0);
  assert.equal((await invoke(true)).status,200); assert.equal(calls,1);
});

test('sanitization is independent of a user revealing a field, and adjusted boxes survive reclassification',()=>{
  const source=doc(['API_KEY=FAKEgeometrySecret99','Node.js v22.9.0']);
  const fields=applyRecommendations(suggestionsToFields(localSuggestions(source),source),{documentType:'technical_screenshot',context:'public',purpose:'technical_help'});
  const previous=fields.map(f=>({...f,rect:[f.rect[0],f.rect[1],f.rect[2]+10,f.rect[3]],userOverride:'keep',hidden:false,adjusted:true}));
  const result=reconcileFields(previous,fields);
  assert.ok(result.restored>0); assert.equal(result.fields[0].userOverride,'keep');
  assert.ok(!JSON.stringify(textPayload(source)).includes('FAKEgeometrySecret99'));
});
