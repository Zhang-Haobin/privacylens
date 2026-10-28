import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustMaskRect } from '../dist/mask-geometry.js';
import { reconcileFields, activeMasks } from '../dist/field-state.js';
import { applyRecommendations } from '../dist/sharing-context.js';
import { makeDocument, suggestionsToFields, validateClassifications } from '../dist/ocr-core.js';

test('corner and move edits stay inside original pixels with a usable minimum area', () => {
  assert.deepEqual(adjustMaskRect([10, 20, 40, 30], 'se', 20, 15, 100, 90), [10, 20, 60, 45]);
  assert.deepEqual(adjustMaskRect([10, 20, 40, 30], 'nw', 999, 999, 100, 90), [45, 45, 5, 5]);
  assert.deepEqual(adjustMaskRect([10, 20, 40, 30], 'move', 999, -999, 100, 90), [60, 0, 40, 30]);
});

test('unmatched adjusted geometry survives an AI reclassification even if the field was visible', () => {
  const prior = { id: 'old', category: 'name', anchor: 'Example Person', rect: [50, 30, 70, 20], hidden: false, geometryOverride: true, userOverride: null };
  const ai = { id: 'new', category: 'address', anchor: 'Different text', rect: [50, 30, 70, 20] };
  const { fields, retained } = reconcileFields([prior], [ai]);
  assert.equal(retained, 1);
  assert.deepEqual(fields.find(field => field.id === 'old').rect, prior.rect);
  assert.equal(fields.find(field => field.id === 'old').retained, true);
  const reviewed = applyRecommendations(fields, { documentType: 'general', context: 'public', purpose: 'share' });
  assert.equal(reviewed.find(field => field.id === 'old').hidden, true);
});

test('sharing and document recommendations do not alter edited geometry', () => {
  const field = { id: 'old', category: 'order', anchor: 'AB12345678', rect: [51, 42, 87, 23], geometryOverride: true };
  for (const context of [{ documentType: 'delivery', context: 'public', purpose: 'share' }, { documentType: 'delivery', context: 'support', purpose: 'lookup' }, { documentType: 'general', context: 'circle', purpose: 'share' }]) {
    assert.deepEqual(applyRecommendations([field], context)[0].rect, field.rect);
  }
});

test('AI word-ID reanalysis preserves a manually adjusted matching field', () => {
  const raw = { text: 'AB12345678', confidence: 95, bbox: { x0: 100, y0: 20, x1: 190, y1: 40 } };
  const doc = makeDocument([{ blocks: [{ paragraphs: [{ lines: [{ words: [raw] }] }] }] }], 400, 200, 400, 200);
  const ai = validateClassifications([{ category: 'order', role: 'unknown', wordIds: [doc.words[0].id] }], doc);
  const incoming = suggestionsToFields(ai, doc);
  const old = { ...incoming[0], id: 'edited', matchingRect: [...incoming[0].rect], rect: [95, 15, 110, 30], geometryOverride: true, hidden: true };
  const result = reconcileFields([old], incoming);
  assert.deepEqual(result.fields[0].rect, old.rect);
  assert.equal(result.fields[0].id, 'edited');
  assert.equal(result.retained, 0);
});

test('an adjusted detected mask survives OCR reconciliation and remains the export rectangle', () => {
  const prior = { id: 'old', category: 'order', anchor: 'AB12345678', rect: [300, 80, 80, 20], matchingRect: [100, 20, 80, 20], hidden: true, geometryOverride: true, userOverride: null };
  const incoming = { id: 'new', category: 'order', anchor: 'AB12345678', rect: [98, 19, 85, 23], hidden: true };
  const { fields } = reconcileFields([prior], [incoming]);
  assert.deepEqual(fields[0].rect, prior.rect);
  assert.deepEqual(fields[0].matchingRect, incoming.rect);
  assert.equal(fields[0].geometryOverride, true);
  assert.deepEqual(activeMasks(fields, [])[0].rect, prior.rect);
});
