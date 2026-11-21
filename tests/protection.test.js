import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAI } from '../lib/ai.js';
import { recommendField } from '../dist/sharing-context.js';
import {
  createProtectionInput, protectionMaskChange, safeProtectionRecommendation, sameProtectionVersion,
  validateProtectionDecisions, validateProtectionRequest
} from '../dist/protection.js';
import { deliveryFields, deliveryRequest, orderField, purposeCases } from '../accuracy-lab/protection/fixtures.mjs';

const env = { OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: 'https://provider.example.test/v1' };
const endpoint = 'https://site.example/api/ai?action=recommend-protection';
const request = (body, options = {}) => new Request(endpoint, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...options
});
const completion = content => Response.json({
  choices: [{ finish_reason: 'stop', message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }]
});
const decision = (field_id, action, reason_code) => ({ field_id, action, reason_code });
const orderReview = decision('f4', 'review', 'task_relevant');
const orderHide = decision('f4', 'hide', 'unnecessary');
const noProviderCall = () => assert.fail('Rejected input reached the provider');

test('protection sends scoped IDs and screened purpose without field values, OCR, edits, or image data', () => {
  const fields = [
    { id: 'scan-88', category: 'name', anchor: 'Casey Example', wordIds: ['w19'], rect: [22, 4, 40, 9], hidden: true },
    { id: 'scan-91', category: 'order', anchor: 'SYNTH-18452', userOverride: 'keep' },
    { id: 'scan-92', category: 'address', anchor: '55 Sample Way', geometryOverride: true }
  ];
  const state = {
    documentType: 'delivery', context: 'support', recipientDetail: 'local fixture',
    customPurpose: 'Locate SYNTH-18452 for Casey Example at 55 Sample Way. Phone: +1 555 010 0123. Email: sample@example.test. API key: demoSyntheticValue.'
  };
  const { body, fieldIds } = createProtectionInput(state, fields);
  const wire = JSON.stringify(body);
  assert.deepEqual(body.fields, [{ id: 'f1', category: 'name' }, { id: 'f2', category: 'order' }, { id: 'f3', category: 'address' }]);
  assert.deepEqual([...fieldIds.values()], fields.map(field => field.id));
  for (const privateValue of ['Casey Example', 'SYNTH-18452', '55 Sample Way', '555 010', 'sample@example.test', 'demoSyntheticValue', 'local fixture', 'w19', 'scan-88', 'userOverride', 'rect']) {
    assert.ok(!wire.includes(privateValue), `Unexpected payload content: ${privateValue}`);
  }
  const { consent, ...providerPayload } = body;
  assert.equal(consent, true);
  assert.deepEqual(validateProtectionRequest(body), providerPayload);
});

test('protection rejects missing consent, incompatible audiences, unreviewed data, and malformed fields', async () => {
  const input = deliveryRequest(purposeCases[0].purpose);
  const invalidBodies = [
    { ...input, consent: 'true' }, { ...input, audience: 'organization' }, { ...input, documentType: 'constructor' },
    { ...input, purpose: ' ' }, { ...input, purpose: 'Check order for demo@example.test' },
    { ...input, image: 'synthetic' }, { ...input, lines: [] }, { ...input, recipientDetail: 'local memo' },
    { ...input, fields: [] }, { ...input, fields: [deliveryFields[0], deliveryFields[0]] },
    { ...input, fields: [{ id: 'scan-15', category: 'order' }] },
    { ...input, fields: [{ id: 'f1', category: 'unknown' }] },
    { ...input, fields: [{ ...orderField, value: 'SYNTH-18452', box: [0, 0, 1, 1] }] },
    { ...input, fields: Array.from({ length: 101 }, (_, index) => ({ id: `f${index + 1}`, category: 'other' })) }
  ];
  for (const body of invalidBodies) assert.equal((await handleAI(request(body), { env, fetchImpl: noProviderCall })).status, 400);
  assert.equal((await handleAI(request({ ...input, purpose: 'x'.repeat(18_000) }), { env, fetchImpl: noProviderCall })).status, 413);
  assert.equal((await handleAI(request(input, { headers: { 'content-type': 'application/json', origin: 'https://elsewhere.example' } }), { env, fetchImpl: noProviderCall })).status, 403);
  assert.equal((await handleAI(new Request(endpoint), { env, fetchImpl: noProviderCall })).status, 405);
});

test('same image, audience and field set can yield different validated field advice when only the purpose changes', async () => {
  const outbound = [];
  for (const [i, fixture] of purposeCases.entries()) {
    const input = deliveryRequest(fixture.purpose);
    const order = fixture.order === 'review' ? orderReview : orderHide;
    const response = await handleAI(request(input), { env, fetchImpl: async (url, options) => {
      assert.equal(url, 'https://provider.example.test/v1/chat/completions');
      const provider = JSON.parse(options.body);
      assert.equal(provider.response_format.json_schema.strict, true);
      const body = JSON.parse(provider.messages[1].content);
      outbound.push(body);
      assert.deepEqual(Object.keys(body), ['documentType', 'audience', 'purpose', 'fields']);
      return completion({ decisions: [decision('f1', 'hide', 'unnecessary'), order] });
    }});
    assert.equal(response.status, 200);
    const parsed = await response.json();
    assert.deepEqual(parsed.decisions.at(-1), order);
    const contextual = safeProtectionRecommendation(orderField, input, order);
    assert.equal(contextual.source, 'ai_protection');
    assert.equal(contextual.canReveal, fixture.order === 'review');
    const local = recommendField(orderField, { documentType: input.documentType, context: input.audience, purpose: 'custom' });
    assert.equal(local.action, 'redact');
    assert.deepEqual(outbound[i], { ...outbound[0], purpose: input.purpose });
  }
});

test('ambiguous and contradictory purposes with uncertain advice offer no reveal action', async () => {
  const purposes = [
    'I want help with a delivery.',
    'This is only a general question about weekend deliveries, but I also want to look up my specific parcel.'
  ];
  const field = { ...orderField, hidden: true };
  for (const purpose of purposes) {
    const input = deliveryRequest(purpose);
    const response = await handleAI(request(input), { env, fetchImpl: async () => completion({
      decisions: [decision('f4', 'review', 'unclear')]
    }) });
    assert.equal(response.status, 200);
    const { decisions: [advice] } = await response.json();
    const recommendation = safeProtectionRecommendation(field, input, advice);
    assert.equal(recommendation.action, 'review');
    assert.equal(protectionMaskChange(field, recommendation), null);
    assert.equal(field.hidden, true);
  }
});

test('malformed model results fail atomically without retries or echoed values', async () => {
  const input = deliveryRequest(purposeCases[0].purpose);
  const malformed = [
    { decisions: [orderReview, orderHide] },
    { decisions: [orderReview, decision('f900', 'keep', 'task_relevant')] },
    { decisions: [decision('f4', 'show', 'task_relevant')] },
    { decisions: [decision('f4', 'keep', 'unnecessary')] },
    { decisions: [decision('f4', 'review', 'invented')] },
    { decisions: [{ ...orderReview, value: 'private-part-of-response' }] },
    { decisions: [orderReview], explanation: 'private-part-of-response' },
    { decisions: { item: orderReview } },
    'Here are decisions: {"decisions":[]}',
    '{"decisions":[{"field_id":"f4"'
  ];
  for (const result of malformed) {
    let calls = 0;
    const response = await handleAI(request(input), { env, fetchImpl: async () => { calls++; return completion(result); } });
    assert.equal(response.status, 502);
    assert.equal(calls, 1);
    assert.doesNotMatch(await response.text(), /private-part-of-response|"decisions"/);
  }
  const oversized = await handleAI(request(input), { env, fetchImpl: async () => completion(' '.repeat(70_000)) });
  assert.equal(oversized.status, 502);
  const refused = await handleAI(request(input), { env, fetchImpl: async () => Response.json({
    choices: [{ finish_reason: 'content_filter', message: { refusal: 'private-part-of-response' } }]
  }) });
  assert.equal(refused.status, 502);
  assert.doesNotMatch(await refused.text(), /private-part-of-response/);
});

test('missing decisions leave the local advice available and provider errors have a bounded fallback', async () => {
  const input = deliveryRequest(purposeCases[0].purpose);
  const accepted = await handleAI(request(input), { env, fetchImpl: async () => completion({ decisions: [] }) });
  assert.equal(accepted.status, 200);
  assert.deepEqual(validateProtectionDecisions(await accepted.json(), input.fields), []);
  const failed = await handleAI(request(input), { env, fetchImpl: async () => new Response('private upstream message', { status: 503 }) });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /private upstream message/);
  let elapsed = 0;
  const late = await handleAI(request(input), { env, now: () => elapsed, fetchImpl: async () => {
    elapsed = 49_000;
    return completion({ decisions: [orderReview] });
  }});
  assert.equal(late.status, 504);
  const controller = new AbortController();
  const cancelled = await handleAI(request(input, { signal: controller.signal }), { env, fetchImpl: async () => {
    controller.abort();
    return completion({ decisions: [orderReview] });
  }});
  assert.equal(cancelled.status, 504);
});

test('local policy gates high-risk, public, unverified and retained fields without editing the existing masks', () => {
  const keep = decision('f4', 'keep', 'task_relevant');
  const support = { documentType: 'delivery', audience: 'support' };
  for (const category of ['secret', 'payment', 'id', 'birth_date', 'personal_path']) {
    const protectedField = safeProtectionRecommendation({ category }, support, keep);
    assert.equal(protectedField.action, 'hide');
    assert.equal(protectedField.canReveal, false);
  }
  assert.equal(safeProtectionRecommendation({ category: 'name' }, { ...support, audience: 'public' }, keep).canReveal, false);
  assert.equal(safeProtectionRecommendation(orderField, { documentType: 'general', audience: 'organization' }, keep).action, 'hide');
  assert.equal(safeProtectionRecommendation({ ...orderField, retained: true }, support, keep).canReveal, false);
  assert.equal(safeProtectionRecommendation(orderField, support, decision('f4', 'review', 'unclear')).canReveal, false);

  const rect = Object.freeze([12, 15, 133, 27]);
  const current = Object.freeze({ ...orderField, hidden: true, userOverride: 'redact', geometryOverride: true, rect });
  assert.equal(safeProtectionRecommendation(current, support, keep).canReveal, true);
  assert.equal(current.hidden, true);
  assert.equal(current.userOverride, 'redact');
  assert.equal(current.rect, rect);
});

test('protection snapshots expire on a replacement image, OCR document, field set, or sharing settings', () => {
  const snapshot = { loadId: 2, ocrDocument: { words: [] }, fieldsVersion: 3, sharingVersion: 5 };
  assert.equal(sameProtectionVersion(snapshot, { ...snapshot }), true);
  for (const change of [{ loadId: 4 }, { ocrDocument: { words: [] } }, { fieldsVersion: 4 }, { sharingVersion: 6 }]) {
    assert.equal(sameProtectionVersion(snapshot, { ...snapshot, ...change }), false);
  }
});
