import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAI } from '../lib/ai.js';

const env = { PRIVACYLENS_ENABLE_LEGACY_IMAGE_AI: 'true', OPENAI_API_KEY: 'test-key-never-in-response', OPENAI_BASE_URL: 'https://ai.novacode.top/v1/' };
// A minimal JPEG envelope is enough here; provider image decoding is outside these HTTP-contract tests.
const image = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 224, 0, 255, 217]).toString('base64')}`;
const payload = { image, width: 1200, height: 800, consent: true };
const field = { category: 'phone', name: 'Phone number', box: [0.2, 0.3, 0.25, 0.06] };
function request(body = payload, action = 'detect', extra = {}) {
  return new Request(`https://privacylens.example/api/ai?action=${action}`, {
    method: action === 'models' ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...extra },
    ...(action !== 'models' ? { body: JSON.stringify(body) } : {})
  });
}
function completion(fields = [field], finish_reason = 'stop') {
  return Response.json({ choices: [{ finish_reason, message: { content: JSON.stringify({ fields }) } }] });
}
const noFetch = async () => { assert.fail('Invalid requests must not reach the provider'); };

test('missing key fails with an actionable message before contacting provider', async () => {
  const response = await handleAI(request(), { env: { PRIVACYLENS_ENABLE_LEGACY_IMAGE_AI: 'true' }, fetchImpl: noFetch });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /OPENAI_API_KEY/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('model listing is disabled and never contacts the provider', async () => {
  const response = await handleAI(request(null, 'models'), { env, fetchImpl: noFetch });
  assert.equal(response.status, 404);
});

test('passes the image through the server using the configured OpenAI-compatible endpoint', async () => {
  const response = await handleAI(request(), {
    env,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://ai.novacode.top/v1/chat/completions');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'gpt-6-luna');
      assert.equal(body.response_format.type, 'json_schema');
      assert.equal(body.response_format.json_schema.strict, true);
      const schema = body.response_format.json_schema.schema;
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, ['fields']);
      assert.equal(schema.properties.fields.items.properties.box.minItems, 4);
      assert.equal(schema.properties.fields.items.properties.box.maxItems, 4);
      assert.equal(options.headers.Authorization, `Bearer ${env.OPENAI_API_KEY}`);
      assert.equal(options.redirect, 'error');
      assert.equal(body.messages[1].content[1].image_url.url, image);
      assert.equal(body.messages[1].content[1].type, 'image_url');
      assert.match(body.messages[0].content, /untrusted data/);
      return completion();
    }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { fields: [{ ...field, id: 'ai-1' }], model: 'gpt-6-luna', provider: 'ai.novacode.top' });
});

test('environment configuration cannot switch the fixed model', async () => {
  const response = await handleAI(request(), {
    env: { ...env, OPENAI_MODEL: 'server-vision' },
    fetchImpl: async (_url, options) => { assert.equal(JSON.parse(options.body).model, 'gpt-6-luna'); return completion([]); }
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).fields, []);
});

test('tampered model parameters are rejected before reaching the provider', async () => {
  for (const model of ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-image-2', '', null, ['gpt-6-luna'], { id: 'gpt-6-luna' }]) {
    const response = await handleAI(request({ ...payload, model }), { env, fetchImpl: noFetch });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Only gpt-6-luna/);
  }
  const response = await handleAI(request({ ...payload, model: 'gpt-6-luna' }), { env, fetchImpl: async () => completion([]) });
  assert.equal(response.status, 200);
});

test('defaults to the economy model with bounded output and no reasoning when no model is configured', async () => {
  const body = { ...payload }; delete body.model;
  const response = await handleAI(request(body), {
    env: { ...env, OPENAI_MODEL: '' },
    fetchImpl: async (_url, options) => {
      const sent = JSON.parse(options.body);
      assert.equal(sent.model, 'gpt-6-luna');
      assert.equal(sent.reasoning_effort, 'none');
      assert.equal(sent.max_completion_tokens, 2048);
      assert.ok(!sent.messages[0].content.includes('"name":'));
      return completion([{ category: 'phone', box: field.box }]);
    }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).fields[0].category, 'phone');
});

test('rejects missing consent, invalid image, oversized request and invalid dimensions', async () => {
  for (const body of [
    { ...payload, consent: false }, { ...payload, image: 'https://example.com/image.png' },
    { ...payload, image: 'data:image/jpeg;base64,aGVsbG8=' }, { ...payload, width: 2401 },
    { ...payload, height: -1 }, null
  ]) {
    const response = await handleAI(request(body), { env, fetchImpl: noFetch });
    assert.equal(response.status, 400);
  }
  const response = await handleAI(request(payload, 'detect', { 'Content-Length': '4500000' }), { env, fetchImpl: noFetch });
  assert.equal(response.status, 413);
});

test('rejects wrong methods, invalid routes and cross-origin browser requests', async () => {
  assert.equal((await handleAI(new Request('https://site.example/api/ai?action=detect'), { env, fetchImpl: noFetch })).status, 405);
  assert.equal((await handleAI(request(null, 'unknown'), { env, fetchImpl: noFetch })).status, 404);
  assert.equal((await handleAI(request(payload, 'detect', { Origin: 'https://another.example' }), { env, fetchImpl: noFetch })).status, 403);
});

test('does not silently drop invalid model regions or accept truncated completions', async () => {
  for (const fields of [
    [field, { ...field, box: [0.9, 0.3, 0.25, 0.1] }],
    [{ ...field, box: [1, 0, 0.0001, 0.1] }],
    [{ ...field, box: [20, 30, 25, 6] }],
    [{ ...field, category: 'unknown' }], [{ ...field, box: [0, 0, 0, 0] }],
    [{ ...field, box: [0, 0, '0.2', 0.1] }]
  ]) {
    const response = await handleAI(request(), { env, fetchImpl: async () => completion(fields) });
    assert.equal(response.status, 502);
  }
  assert.equal((await handleAI(request(), { env, fetchImpl: async () => completion([field], 'length') })).status, 502);
  assert.equal((await handleAI(request(), { env, fetchImpl: async () => Response.json({ choices: [{ message: { content: 'not json' } }] }) })).status, 502);
});

test('reads a complete JSON object surrounded by Markdown or commentary', async () => {
  const json = JSON.stringify({ fields: [field] });
  for (const content of [json, `\ufeff${json}`, `\`\`\`json\n${json}\n\`\`\``, `Detected regions:\n\`\`\`JSON\n${json}\n\`\`\`\nPlease review each mask.`]) {
    let calls = 0;
    const response = await handleAI(request(), { env, fetchImpl: async () => {
      calls++; return Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });
    } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).fields.length, 1);
    assert.equal(calls, 1);
  }
});

test('handles text content parts without mixing in non-text output', async () => {
  const content = JSON.stringify({ fields: [field] });
  const response = await handleAI(request(), { env, fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'stop', message: {
    content: [{ type: 'text', text: content.slice(0, 15) }, { type: 'text', text: content.slice(15) }]
  } }] }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).fields.length, 1);
});

test('rejects malformed, partial and ambiguous JSON without repairing boxes or automatically retrying', async () => {
  const json = JSON.stringify({ fields: [field] });
  for (const content of [json.slice(0, -1), `${json}\n${json}`, '{"fields":[{"category":"phone","box":[0,0,0.2,0.1]},]}', 'Result: {broken} then ' + json, 'I could not locate details.']) {
    let calls = 0;
    const response = await handleAI(request(), { env, fetchImpl: async () => {
      calls++; return Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });
    } });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /Existing masks were retained/);
    assert.equal(calls, 1);
  }
});

test('distinguishes output limits and refusals without echoing provider content', async () => {
  const limited = await handleAI(request(), { env, fetchImpl: async () => completion([field], 'length') });
  assert.match((await limited.json()).error, /output limit/);
  const refused = await handleAI(request(), { env, fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'stop', message: {
    refusal: 'Private upstream message must not be echoed', content: null
  } }] }) });
  const refusedBody = await refused.json();
  assert.equal(refused.status, 502);
  assert.match(refusedBody.error, /declined/);
  assert.ok(!JSON.stringify(refusedBody).includes('Private upstream message'));
});

test('maps quota, authentication, invalid model and timeouts without echoing upstream private data', async () => {
  for (const [status, expected] of [[401, 502], [403, 502], [429, 429], [400, 502], [500, 502]]) {
    const response = await handleAI(request(), { env, fetchImpl: async () => new Response(`private image and ${env.OPENAI_API_KEY}`, { status }) });
    assert.equal(response.status, expected);
    assert.ok(!(await response.text()).includes(env.OPENAI_API_KEY));
  }
  const response = await handleAI(request(), { env, fetchImpl: async () => { throw new DOMException('Timed out', 'TimeoutError'); } });
  assert.equal(response.status, 504);
});
