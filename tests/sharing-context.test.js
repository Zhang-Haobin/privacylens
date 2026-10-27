import test from 'node:test';
import assert from 'node:assert/strict';
import { audiences, purposes, shouldHide, sharingPlan, fieldReason, contextDifference } from '../dist/sharing-context.js';
import { textCategories } from '../dist/ocr-core.js';

test('all audiences and purposes mask personal details except order lookup for official support', () => {
  for (const audience of Object.keys(audiences)) for (const purpose of Object.keys(purposes)) {
    const kept = textCategories.filter(category => !shouldHide({ category }, audience, purpose));
    assert.deepEqual(kept, audience === 'support' && purpose === 'lookup' ? ['order', 'tracking'] : [], `${audience}/${purpose}`);
  }
});

test('context feedback reports newly exposed and newly masked fields, including overridden choices', () => {
  const before = [{ id: 'order', hidden: true }, { id: 'name', hidden: false }, { id: 'phone', hidden: true }];
  const after = [{ id: 'order', name: 'Order number', hidden: false }, { id: 'name', name: 'Full name', hidden: true }, { id: 'phone', name: 'Phone number', hidden: true }];
  assert.deepEqual(contextDifference(before, after), { hidden: ['Full name'], visible: ['Order number'] });
  assert.deepEqual(contextDifference(after, after), { hidden: [], visible: [] });
  assert.deepEqual(contextDifference([], after), { hidden: [], visible: [] });
});

test('missing or unknown sharing choices cannot expose an identifier', () => {
  for (const audience of [undefined, 'unknown', 'circle', 'team']) {
    for (const category of textCategories) assert.equal(shouldHide({ category }, audience, 'lookup'), true);
  }
  assert.equal(shouldHide({ category: 'order' }, 'support'), true);
  assert.equal(shouldHide({ category: 'tracking' }, 'support', 'unknown'), true);
  assert.equal(shouldHide({ category: 'unknown' }, 'support', 'lookup'), true);
});

test('sample fields and OCR fields follow the same rule when changing purpose or audience', () => {
  for (const field of [{ id: 'order' }, { id: 'ocr-1', category: 'order' }]) {
    assert.equal(shouldHide(field, 'support', 'lookup'), false);
    assert.equal(shouldHide(field, 'support', 'issue'), true);
    assert.equal(shouldHide(field, 'team', 'lookup'), true);
    assert.equal(shouldHide(field, 'public', 'share'), true);
  }
});

test('visible-field explanations and sharing summary agree with the selection', () => {
  const lookup = sharingPlan('support', 'lookup');
  assert.match(lookup.keep, /Order \/ tracking/);
  assert.match(fieldReason({ category: 'order' }, 'support', 'lookup'), /verified support/);
  for (const audience of Object.keys(audiences)) for (const purpose of Object.keys(purposes)) {
    const plan = sharingPlan(audience, purpose);
    assert.ok(plan.label.includes(audiences[audience].label));
    assert.ok(plan.label.includes(purposes[purpose].label));
    assert.ok(plan.hide && plan.keep && plan.note);
    for (const category of textCategories) assert.ok(fieldReason({ category }, audience, purpose));
  }
  assert.equal(sharingPlan('unknown', 'unknown').label, 'Recipient not selected · Purpose not selected');
});
