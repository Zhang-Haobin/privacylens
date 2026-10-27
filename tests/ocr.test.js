import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, localSuggestions, textPayload, suggestionsToFields, validateClassifications, shouldHide } from '../dist/ocr-core.js';
import { handleAI } from '../lib/ai.js';

const word = (text, x0, y0, x1, y1, confidence = 90) => ({ text, bbox: { x0, y0, x1, y1 }, confidence });
const page = words => ({ blocks: [{ paragraphs: [{ lines: [{ words }] }] }] });
const document = makeDocument([page([word('Phone:', 20, 100, 80, 120), word('+852', 90, 100, 140, 120), word('9345', 150, 100, 200, 120), word('6721', 210, 100, 260, 120)])], 300, 200, 300, 200);
const env = { OPENAI_API_KEY: 'private-key', OPENAI_BASE_URL: 'https://provider.example/v1' };
const request = (body = textPayload(document)) => new Request('https://site.example/api/ai?action=classify-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const completion = fields => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ fields }) } }] });
const valid = { category: 'phone', role: 'recipient', wordIds: ['w2', 'w3', 'w4'] };
const noFetch = async () => assert.fail('Invalid input must not reach provider');

test('OCR scales each axis to original pixels and keeps the final phone digits covered', () => {
  const scaled = makeDocument([page([word('Phone:', 40, 300, 160, 360), word('+852', 180, 300, 280, 360), word('9345', 300, 300, 400, 360), word('6721', 420, 300, 520, 360)])], 300, 200, 600, 600);
  const fields = suggestionsToFields(localSuggestions(scaled), scaled);
  assert.equal(fields.length, 1);
  const [x, y, width, height] = fields[0].rect;
  assert.ok(x <= 20 && y <= 100 && x + width >= 260 && y + height >= 120);
});

test('two OCR passes deduplicate the same token but retain distinct repeated occurrences', () => {
  const words = [word('Tracking:', 10, 10, 70, 25), word('SF0987654321098', 80, 10, 200, 25), word('SF0987654321098', 10, 100, 200, 115)];
  const doc = makeDocument([page(words), page(words)], 300, 200, 300, 200);
  assert.equal(doc.words.length, 3);
  const fields = suggestionsToFields(localSuggestions(doc), doc);
  assert.equal(fields.length, 2);
  assert.ok(fields.every(f => f.category === 'tracking'));
});

test('maps only selected words and splits multi-line addresses without covering another column', () => {
  const doc = makeDocument([page([word('Room', 10, 10, 40, 25), word('101', 45, 10, 70, 25), word('US$99', 220, 10, 280, 25), word('Example', 10, 40, 80, 55)])], 300, 200, 300, 200);
  const ids = doc.words.filter(w => w.text !== 'US$99').map(w => w.id);
  const fields = suggestionsToFields([{ category: 'address', role: 'recipient', wordIds: ids, source: 'ai' }], doc);
  assert.equal(fields.length, 2);
  assert.ok(fields.every(f => f.rect[0] + f.rect[2] < 220));
});

test('payment transaction and reference identifiers remain hidden in support context', () => {
  for (const category of ['transaction', 'reference', 'payment', 'phone', 'address']) assert.equal(shouldHide({ category }, 'support', 'lookup'), true);
  for (const category of ['order', 'tracking']) {
    assert.equal(shouldHide({ category }, 'support', 'lookup'), false);
    assert.equal(shouldHide({ category }, 'public', 'lookup'), true);
  }
});

test('recognizes transaction and email locally even when AI is unavailable', () => {
  const doc = makeDocument([page([word('Transaction ID: 7H32145678901234C', 10, 10, 280, 25), word('noah.kim@example.com', 10, 50, 200, 65)])], 300, 200, 300, 200);
  assert.deepEqual(localSuggestions(doc).map(f => f.category), ['transaction', 'email']);
});

test('local Chinese labels tolerate spaces inserted between OCR characters', () => {
  const doc = makeDocument([page([word('訂 單 號 : HK20261025001', 10, 10, 280, 25), word('電 話 : 61234567', 10, 50, 200, 65)])], 300, 200, 300, 200);
  assert.deepEqual(localSuggestions(doc).map(f => f.category), ['order', 'phone']);
});

test('client rejects unknown and freely positioned classifications while preserving overlapping fields', () => {
  for (const bad of [[{ ...valid, wordIds: ['w999'] }], [{ ...valid, box: [0, 0, 1, 1] }], [{ ...valid, category: 'face' }]]) {
    assert.throws(() => validateClassifications(bad, document));
  }
  assert.equal(validateClassifications([valid], document).length, 1);
  const overlap = validateClassifications([valid, { ...valid, category: 'account', wordIds: ['w2', 'w2', 'w3'] }], document);
  assert.equal(overlap.length, 2); assert.deepEqual(overlap[1].wordIds, ['w2', 'w3']);
});

test('local and AI phone suggestions combine into one switch without losing the outer coverage', () => {
  const classified = [{ ...valid, source: 'ai' }, ...localSuggestions(document)];
  const fields = suggestionsToFields(classified, document);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].role, 'recipient');
  assert.ok(fields[0].rect[0] <= 20 && fields[0].rect[0] + fields[0].rect[2] >= 260);
});

test('address padding includes adjacent postal-code words omitted by AI, without crossing columns', () => {
  const doc = makeDocument([page([word('Singapore', 110, 205, 197, 224), word('079903', 204, 205, 269, 220), word('HKG', 430, 205, 500, 225)])], 538, 742, 538, 742);
  const city = doc.words.find(w => w.text === 'Singapore');
  const fields = suggestionsToFields([{ category: 'address', role: 'sender', wordIds: [city.id], source: 'ai' }], doc);
  assert.equal(fields.length, 1);
  assert.ok(fields[0].rect[0] + fields[0].rect[2] >= 269);
  assert.ok(fields[0].rect[0] + fields[0].rect[2] < 430);
});

test('text API sends only sanitized text and layout, with fixed model and strict ID schema', async () => {
  const response = await handleAI(request(), { env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://provider.example/v1/chat/completions');
    const sent = JSON.parse(options.body);
    assert.equal(sent.model, 'gpt-6-luna'); assert.equal(sent.reasoning_effort, 'none'); assert.equal(sent.max_completion_tokens, 2048);
    assert.equal(typeof sent.messages[1].content, 'string');
    assert.ok(!options.body.includes('image_url') && !options.body.includes('data:image'));
    assert.deepEqual(sent.response_format.json_schema.schema.properties.fields.items.required, ['category', 'role', 'wordIds']);
    assert.match(sent.messages[0].content, /untrusted data/);
    assert.ok(!options.body.includes('private-key'));
    return completion([valid]);
  } });
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).fields, [valid]);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('text API rejects missing consent, duplicate IDs, images, wrong model and invalid coordinates', async () => {
  const payload = textPayload(document);
  for (const body of [null, { ...payload, consent: false }, { ...payload, model: 'other' }, { ...payload, image: 'secret image' }, { ...payload, lines: [] }, { ...payload, lines: [...payload.lines, ...payload.lines] }, { ...payload, lines: [{ id: 'l1', words: [{ id: 'w1', text: 'x', box: [0, 0, 2, 1] }] }] }]) {
    const response = await handleAI(request(body), { env, fetchImpl: noFetch }); assert.equal(response.status, 400);
  }
});

test('text API preserves legitimate overlapping classifications without losing coverage', async () => {
  const overlap = { ...valid, category: 'account', wordIds: ['w2', 'w2', 'w3'] };
  const response = await handleAI(request(), { env, fetchImpl: async () => completion([valid, overlap]) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).fields, [valid, { ...overlap, wordIds: ['w2', 'w3'] }]);
});

test('unknown AI word IDs trigger one complete retry and never return partial fields', async () => {
  let calls = 0;
  const response = await handleAI(request(), { env, fetchImpl: async (_url, options) => {
    calls++;
    if (calls === 2) assert.match(JSON.parse(options.body).messages[0].content, /previous answer contained an unknown word ID/i);
    return completion(calls === 1 ? [{ ...valid, wordIds: ['w2', 'w999'] }] : [valid]);
  } });
  assert.equal(response.status, 200); assert.equal(calls, 2); assert.deepEqual((await response.json()).fields, [valid]);
  let failures = 0;
  const invalid = await handleAI(request(), { env, fetchImpl: async () => { failures++; return completion([{ ...valid, wordIds: ['w2', 'w999'] }]); } });
  assert.equal(invalid.status, 502); assert.equal(failures, 2);
  const body = await invalid.json(); assert.ok(!body.fields && !JSON.stringify(body).includes('w999'));
});

test('malformed or extra-coordinate AI results fail atomically without retry', async () => {
  for (const fields of [[{ ...valid, box: [0, 0, 1, 1] }], [{ ...valid, wordIds: [] }], [{ ...valid, category: 'code' }]]) {
    let calls = 0;
    const response = await handleAI(request(), { env, fetchImpl: async () => { calls++; return completion(fields); } });
    assert.equal(response.status, 502); assert.equal(calls, 1);
    const body = await response.json(); assert.ok(!body.fields && !JSON.stringify(body).includes('private-key'));
  }
});

test('text API refuses oversized OCR text before calling the provider', async () => {
  const lines = Array.from({ length: 260 }, (_, i) => ({ id: `l${i + 1}`, words: [{ id: `w${i + 1}`, text: 'x'.repeat(160), box: [0, 0, 0.1, 0.1] }] }));
  const response = await handleAI(request({ ...textPayload(document), lines }), { env, fetchImpl: noFetch });
  assert.equal(response.status, 413);
});
