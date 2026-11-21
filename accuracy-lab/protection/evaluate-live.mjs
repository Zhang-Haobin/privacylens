import { handleAI } from '../../lib/ai.js';
import { safeProtectionRecommendation, validateProtectionDecisions } from '../../dist/protection.js';
import { deliveryRequest, orderField, purposeCases } from './fixtures.mjs';

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error('The configured provider key is missing.');
  process.exit(1);
}

let passed = 0;
for (const fixture of purposeCases) {
  const body = deliveryRequest(fixture.purpose);
  const start = performance.now();
  const response = await handleAI(new Request('https://privacy-test.example/api/ai?action=recommend-protection', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }));
  const elapsedMs = Math.round(performance.now() - start);
  if (!response.ok) {
    console.log(JSON.stringify({ case: fixture.id, status: response.status, elapsedMs, pass: false }));
    continue;
  }
  const decisions = validateProtectionDecisions(await response.json(), body.fields);
  const order = decisions.find(item => item.field_id === orderField.id);
  const constrained = order && safeProtectionRecommendation(orderField, body, order);
  const pass = fixture.order === 'review' ? constrained?.canReveal === true : constrained?.action === 'hide';
  if (pass) passed++;
  console.log(JSON.stringify({
    case: fixture.id, status: response.status, elapsedMs, pass,
    model: Object.fromEntries(decisions.map(item => [body.fields.find(field => field.id === item.field_id).category, [item.action, item.reason_code]])),
    orderSuggestion: constrained?.action ?? 'local', orderEligibleForConfirmation: constrained?.canReveal ?? false
  }));
}
console.log(JSON.stringify({ passed, total: purposeCases.length }));
if (passed !== purposeCases.length) process.exitCode = 1;
