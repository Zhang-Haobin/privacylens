import test from 'node:test';
import assert from 'node:assert/strict';
import { activeMasks } from '../dist/field-state.js';
import { applyRecommendations } from '../dist/sharing-context.js';
import { editorSharingChoice } from '../dist/workflow.js';
import { safeProtectionRecommendation, validateProtectionRequest } from '../dist/protection.js';
import {
  createInstructionRequest, instructionFieldCategories, instructionRectangles, parsePrivacyInstruction,
  validKeepArea, validateInstructionOperations
} from '../dist/privacy-instruction.js';
import { handleAI } from '../lib/ai.js';

test('standard sharing options retain their audience and default to conservative support without a purpose', () => {
  for (const type of ['delivery', 'general']) {
    const support = editorSharingChoice(type, 'support');
    assert.equal(support.context, 'support');
    assert.equal(support.compatible, true);
    assert.notEqual(support.purpose, 'lookup');
    const fields = ['order', 'tracking', 'phone', 'secret'].map(category => ({ category }));
    assert.ok(applyRecommendations(fields, support).every(field => field.hidden));
  }
  assert.equal(editorSharingChoice('delivery', 'custom').context, '');
  assert.equal(editorSharingChoice('transcript', 'support').compatible, false);
  assert.equal(editorSharingChoice('transcript', 'team').compatible, false);
});

test('privacy commands recognize English, Chinese, and multiline field lists', () => {
  for (const [text, type] of [
    ['  Hide all text. ', 'mask_text'], ['请遮擋全部文字。', 'mask_text'],
    ['Hide all personal information', 'mask_personal'], ['遮挡所有个人信息', 'mask_personal'],
    ['Hide everything', 'mask_image'], ['隱藏整張截圖', 'mask_image'],
    ['Hide all numbers', 'mask_numbers'], ['隱藏全部數字', 'mask_numbers'],
    ['Hide a specific area', 'draw_area'], ['遮擋指定區域', 'draw_area'],
    ['Keep only the delivery status', 'keep_area'], ['Hide everything except the order status', 'keep_area'],
    ['只保留物流狀態', 'keep_area'], ['Hide personal details but keep the delivery status', 'mask_personal']
  ]) assert.equal(parsePrivacyInstruction(text)?.type, type, text);
  for (const text of ['Hide phone numbers and addresses.', 'Hide phone numbers\nHide addresses', '請遮擋電話號碼和地址。']) {
    assert.deepEqual(parsePrivacyInstruction(text), { type: 'mask_fields', categories: ['phone', 'address'] });
  }
  assert.deepEqual(parsePrivacyInstruction('Hide the top half of the screenshot.'), { type: 'mask_half', side: 'top' });
  assert.deepEqual(parsePrivacyInstruction('遮擋截圖的下半部分。'), { type: 'mask_half', side: 'bottom' });
});

test('unrecognized, contradictory, and qualifying clauses do not silently execute a partial command', () => {
  for (const text of [
    'Hide all text except the tracking status.', 'Hide everything but show my phone number',
    'Hide a blue circle near the bottom.', 'Hide phone numbers\nKeep my credentials visible.',
    'Hide the top half or the bottom half', 'Do not hide all text', 'Hide [1,2,3,4]', ''
  ]) assert.equal(parsePrivacyInstruction(text), null, text);
});

const width = 101, height = 61;
const word = (text, x0, y0, x1, y1) => ({ text, bbox: { x0, y0, x1, y1 } });
const words = [word('Sample', 1, 4, 18, 12), word('order 23', 22, 4, 54, 13), word('Delivered', 57, 23, 100, 33)];
const document = { width, height, words, lines: [{ words: words.slice(0, 2) }, { words: words.slice(2) }] };
const image = { width, height, document };
const contains = ([x, y, w, h], a, b) => a >= x && a < x + w && b >= y && b < y + h;

test('OCR masks cover original word extents and keep distinct full-image and half-image masks', () => {
  const rects = instructionRectangles({ type: 'mask_text' }, image);
  for (const { bbox } of words) {
    assert.ok(rects.some(rect => contains(rect, bbox.x0, bbox.y0) && contains(rect, bbox.x1 - 1, bbox.y1 - 1)));
  }
  const numeric = instructionRectangles({ type: 'mask_numbers' }, image);
  assert.equal(numeric.length, 1);
  assert.ok(contains(numeric[0], 25, 8));
  assert.equal(contains(numeric[0], 1, 5), false);
  assert.deepEqual(instructionRectangles({ type: 'mask_text' }, { ...image, width: 102 }), []);
  assert.deepEqual(instructionRectangles({ type: 'mask_image' }, image), [[0, 0, 101, 61]]);
  assert.deepEqual(instructionRectangles({ type: 'mask_half', side: 'top' }, image), [[0, 0, 101, 31]]);
});

test('keep-only rules require a validated user selection and cover every pixel outside it', () => {
  const operation = { type: 'keep_area' };
  assert.deepEqual(instructionRectangles(operation, image), []);
  for (const area of [[0, 0, width, height], [-1, 4, 10, 10], [1, 1, width, height], [1.5, 1, 2, 3]]) {
    assert.equal(validKeepArea(area, width, height), false);
    assert.deepEqual(instructionRectangles(operation, { ...image, keepArea: area }), []);
  }
  const keepArea = [20, 10, 30, 12];
  const outside = instructionRectangles(operation, { ...image, keepArea });
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
    assert.equal(outside.filter(rect => contains(rect, x, y)).length, contains(keepArea, x, y) ? 0 : 1);
  }
});

test('instruction masks preserve independent manual visibility, adjusted boxes and field overrides', () => {
  const operation = parsePrivacyInstruction('Hide personal information');
  const fields = [
    { id: 'phone', category: 'phone', rect: [21, 8, 29, 10], geometryOverride: true },
    { id: 'email', category: 'email', rect: [2, 2, 10, 10], userOverride: 'keep' },
    { id: 'secret', category: 'secret', rect: [9, 2, 16, 12] }
  ];
  const manual = [{ id: 1, rect: [1, 18, 7, 13] }, { id: 2, rect: [8, 25, 4, 8], hidden: false }];
  const protectedFields = applyRecommendations(fields, { maskCategories: instructionFieldCategories(operation) });
  assert.deepEqual(protectedFields.map(field => field.hidden), [true, false, true]);
  assert.equal(protectedFields[0].rect, fields[0].rect);
  assert.equal(protectedFields[1].userOverride, 'keep');
  assert.ok(instructionFieldCategories(operation).has('phone'));
  assert.equal(instructionFieldCategories(operation).has('course'), false);
  assert.deepEqual(activeMasks(protectedFields, manual, [[0, 0, width, height]]).map(mask => mask.rect),
    [fields[0].rect, fields[2].rect, manual[0].rect, [0, 0, width, height]]);
  const keepDecision = { action: 'keep', reason_code: 'task_relevant' };
  for (const category of ['order', 'phone', 'secret']) {
    assert.equal(safeProtectionRecommendation({ category }, { documentType: 'delivery', audience: 'unspecified' }, keepDecision).canReveal, false);
  }
});

const endpoint = 'https://editor.example/api/ai?action=interpret-instruction';
const env = { OPENAI_API_KEY: 'fixture', OPENAI_BASE_URL: 'https://fixture.example/v1' };
const request = body => new Request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const providerResponse = content => Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });

test('AI interpretation requires consent and forwards only screened input and supported metadata', async () => {
  const fields = [{ id: 'private-id', category: 'name', anchor: 'Alex Example', rect: [1, 2, 3, 4] }];
  const body = createInstructionRequest('delivery', 'Please hide the customer details for Alex Example. Email: alex@example.test', fields);
  assert.doesNotMatch(JSON.stringify(body), /Alex Example|alex@example|private-id|rect/);
  for (const invalid of [
    { ...body, consent: false }, { ...body, image: 'data:image/png;base64,test' }, { ...body, lines: [] },
    { ...body, categories: ['name', 'name'] }, { ...body, categories: ['made_up'] },
    { ...body, instruction: 'Try alex@example.test' }, { ...body, instruction: ' ' }
  ]) {
    const response = await handleAI(request(invalid), { env, fetchImpl: () => assert.fail('Invalid input reached the provider') });
    assert.equal(response.status, 400);
  }
  const expected = { operations: [{ type: 'mask_fields', categories: ['name'] }] };
  const response = await handleAI(request(body), { env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://fixture.example/v1/chat/completions');
    const submitted = JSON.parse(options.body);
    assert.equal(submitted.response_format.json_schema.strict, true);
    assert.deepEqual(JSON.parse(submitted.messages[1].content), {
      documentType: 'delivery', instruction: body.instruction, categories: ['name']
    });
    return providerResponse(JSON.stringify(expected));
  } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expected);
  const fieldsRequest = { consent: true, documentType: 'delivery', audience: 'unspecified', purpose: body.instruction, fields: [{ id: 'f1', category: 'name' }] };
  assert.equal(validateProtectionRequest(fieldsRequest).audience, 'unspecified');
});

test('both interpretation validators reject untrusted commands, invented references, and incompatible operations', async () => {
  const body = createInstructionRequest('delivery', 'Keep customer data private', [{ category: 'name' }]);
  const invalid = [
    { operations: [{ type: 'keep_area', box: [1, 2, 3, 4] }] },
    { operations: [{ type: 'mask_text', code: 'expression' }] },
    { operations: [{ type: 'mask_fields', categories: ['secret'] }] },
    { operations: [{ type: 'mask_fields', categories: ['name', 'name'] }] },
    { operations: [{ type: 'mask_fields', categories: ['name'], field_id: 'f7' }] },
    { operations: [{ type: 'mask_image' }, { type: 'mask_image' }] },
    { operations: [{ type: 'mask_image' }, { type: 'mask_text' }] },
    { operations: [{ type: 'mask_half', side: 'top' }] },
    { operations: [{ type: 'mask_region', rect: [1, 2, 3, 4] }] }
  ];
  for (const result of invalid) {
    assert.throws(() => validateInstructionOperations(result, ['name']));
    const response = await handleAI(request(body), { env, fetchImpl: async () => providerResponse(JSON.stringify(result)) });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).operations, undefined);
  }
  const malformed = await handleAI(request(body), { env, fetchImpl: async () => providerResponse('{"operations":[') });
  assert.equal(malformed.status, 502);
  assert.deepEqual(validateInstructionOperations({ operations: [] }, []), []);
});
