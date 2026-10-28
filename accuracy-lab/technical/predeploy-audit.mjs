// Synthetic local transport audit. No .env, remote calls, or plaintext captures.
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {textPayload} from '../../dist/ocr-core.js';
import {handleAI} from '../../lib/ai.js';
import {AI_BUDGET} from '../../dist/ai-policy.js';
import {credentialAuditCases,auditDocument,auditEnv,payloadSafe} from './credential-audit-fixtures.mjs';
const request=body=>new Request('https://site.example/api/ai?action=classify-text',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const completion=fields=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({fields})}}]});
const invalid=[{category:'secret',role:'unknown',wordIds:['w99999']}];
const reports=[];
for(const fixture of credentialAuditCases){
  const source=auditDocument(fixture.rows),before=JSON.stringify(source),body=textPayload(source);
  const providerSafe=[],directProviderSafe=[],providerText=[];
  const invoke=async(payload,checks)=>handleAI(request(payload),{env:auditEnv,fetchImpl:async(_url,options)=>{
    checks.push(payloadSafe(options.body,fixture,source));
    if(checks===providerSafe)providerText.push(JSON.parse(options.body).messages[1].content);
    return completion(checks.length===1?invalid:[]);
  }});
  const response=await invoke(body,providerSafe);
  const direct=await invoke({...body,lines:body.lines.map((l,i)=>({...l,words:l.words.map((w,j)=>({...w,text:source.lines[i].words[j].text}))}))},directProviderSafe);
  const kept=(fixture.keep||[]).every(([r,c])=>body.lines[r].words[c].text===source.lines[r].words[c].text);
  reports.push({id:fixture.id,knownLimitation:!!fixture.limitation,clientSafe:fixture.limitation?null:payloadSafe(body,fixture,source),providerSafe:fixture.limitation?null:providerSafe,directProviderSafe:fixture.limitation?null:directProviderSafe,unlabelledValueRemains:fixture.limitation?JSON.stringify(body).includes(source.words[0].text):null,attempts:providerSafe.length,status:response.status,directStatus:direct.status,retryPayloadIdentical:providerText[0]===providerText[1],originalUnchanged:before===JSON.stringify(source),unrelatedTextRetained:kept});
}
let elapsed=0,calls=0;const budgets=[];const nativeTimeout=AbortSignal.timeout;
AbortSignal.timeout=ms=>{budgets.push(ms);return nativeTimeout(ms);};
let timedRetry,late;
try{
 const body=textPayload(auditDocument([['password=','FAKE_DEADLINE_77']]));
 timedRetry=await handleAI(request(body),{env:auditEnv,now:()=>elapsed,fetchImpl:async()=>{calls++;elapsed=calls===1?34_000:46_000;return completion(calls===1?invalid:[]);}});
 assert.equal(timedRetry.status,200);assert.equal(calls,2);
 assert.equal(budgets[0],AI_BUDGET.firstAttemptMs);assert.equal(budgets[1],AI_BUDGET.backendMs-34_000-AI_BUDGET.responseReserveMs);
 elapsed=0;calls=0;
 late=await handleAI(request(body),{env:auditEnv,now:()=>elapsed,fetchImpl:async()=>{calls++;elapsed=AI_BUDGET.backendMs-AI_BUDGET.responseReserveMs-AI_BUDGET.minimumRetryMs+1;return completion(invalid);}});
 assert.equal(late.status,504);assert.equal(calls,1);
}finally{AbortSignal.timeout=nativeTimeout;}
const config=JSON.parse(await readFile(new URL('../../vercel.json',import.meta.url)));
const budgetSafe=AI_BUDGET.backendMs<=config.functions['api/ai.js'].maxDuration*1000-5000&&AI_BUDGET.browserMs>AI_BUDGET.backendMs&&AI_BUDGET.browserMs<config.functions['api/ai.js'].maxDuration*1000;
const result={verification:'Local serialized payloads and simulated provider transport; no production/provider verification',cases:reports,timeoutBudget:{...AI_BUDGET,functionMs:config.functions['api/ai.js'].maxDuration*1000,observedAttemptBudgetsMs:budgets.slice(0,2),lateRetryStatus:late.status,lateRetryAttempts:calls,budgetSafe}};
await mkdir('qa/predeployment',{recursive:true});
await writeFile('qa/predeployment/sanitizer-audit.json',JSON.stringify(result,null,2));
const failed=reports.filter(r=>!r.knownLimitation&&(!r.clientSafe||r.providerSafe.length!==2||!r.providerSafe.every(Boolean)||r.directProviderSafe.length!==2||!r.directProviderSafe.every(Boolean)||r.status!==200||r.directStatus!==200||!r.retryPayloadIdentical||!r.originalUnchanged||!r.unrelatedTextRetained));
console.log(JSON.stringify({supportedCases:reports.filter(r=>!r.knownLimitation).length,failedCaseIDs:failed.map(r=>r.id),knownLimitations:reports.filter(r=>r.knownLimitation).map(r=>r.id),timeoutBudget:result.timeoutBudget},null,2));
process.exitCode=failed.length||!budgetSafe?1:0;
