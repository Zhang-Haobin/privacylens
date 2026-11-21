import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRecommendations, guardSuggestedReveals } from '../dist/sharing-context.js';
import { reconcileFields, preserveEditedRegions, aiInsights, activeMasks, coverageSummary } from '../dist/field-state.js';

test('context changes keep previously masked suggestions hidden until explicitly reviewed', () => {
  const fields = [{ id: 'course', category: 'course', name: 'Course', hidden: true }, { id: 'name', category: 'name', hidden: true, userOverride: 'keep' }];
  const context = { documentType: 'transcript', context: 'public', purpose: 'showcase' };
  const result = guardSuggestedReveals(fields, applyRecommendations(fields, context));
  assert.equal(result[0].hidden, true); assert.equal(result[0].pendingReveal, true);
  assert.equal(result[1].hidden, false); assert.equal(result[1].userOverride, 'keep');
  assert.equal(applyRecommendations(result, context)[0].hidden, true);
  const confirmed = applyRecommendations([{ ...result[0], userOverride: 'keep', pendingReveal: false }], context);
  assert.equal(confirmed[0].hidden, false);
  const privateAgain = applyRecommendations(result, { documentType: 'transcript', context: '', purpose: '' });
  assert.equal(privateAgain[0].hidden, true); assert.equal(privateAgain[0].pendingReveal, false);
});

test('matched rescans preserve pending review and earlier mask boundaries', () => {
  const old = [{ id:'old', category:'course', anchor:'Math', rect:[10,10,80,20], hidden:true, pendingReveal:true }];
  const next = [{ id:'new', category:'course', anchor:'Math', rect:[15,10,70,20] }];
  const result = reconcileFields(old, next).fields[0];
  assert.equal(result.id, 'old'); assert.equal(result.pendingReveal, true); assert.deepEqual(result.rect, [10,10,80,20]);
});

test('explicit reapply restores recommended masks to visible fields and preserves other coverage', () => {
  const context = { documentType: 'delivery', context: 'support', purpose: 'lookup' };
  const previous = [
    { id: 'recipient', category: 'name', anchor: 'Demo Recipient', rect: [8, 9, 84, 22], matchingRect: [10, 10, 80, 20], geometryOverride: true, hidden: false, userOverride: 'keep' },
    { id: 'order', category: 'order', anchor: 'DEMO-001', rect: [10, 40, 80, 20], hidden: false, userOverride: 'keep' },
    { id: 'tracking', category: 'tracking', anchor: 'DEMO-002', rect: [10, 70, 80, 20], hidden: true, userOverride: 'redact' },
    { id: 'other-order', category: 'order', anchor: 'DEMO-003', rect: [10, 100, 80, 20], hidden: true },
    { id: 'earlier-address', category: 'address', anchor: 'Demo Address', rect: [10, 130, 80, 20], hidden: false, userOverride: 'keep' }
  ];
  const incoming = previous.slice(0, 4).map(({ id, category, anchor, rect, matchingRect }) => (
    { id: `scan-${id}`, category, anchor, rect: matchingRect || rect }
  ));
  const { fields } = reconcileFields(previous, incoming);
  assert.deepEqual(applyRecommendations(fields, context).map(field => field.hidden), [false, false, true, false, false]);

  const applied = guardSuggestedReveals(previous, applyRecommendations(fields, context, { applySuggestedMasks: true }));
  assert.deepEqual(applied.map(({ id, hidden, userOverride, pendingReveal }) => [id, hidden, userOverride, pendingReveal]), [
    ['recipient', true, null, false],
    ['order', false, 'keep', false],
    ['tracking', true, 'redact', false],
    ['other-order', true, null, true],
    ['earlier-address', true, null, false]
  ]);
  const manual = [{ id: 1, rect: [110, 20, 40, 40], hidden: true }];
  assert.deepEqual(activeMasks(applied, manual).map(mask => mask.rect), [previous[0].rect, previous[2].rect, previous[3].rect, previous[4].rect, manual[0].rect]);
  assert.equal(coverageSummary(applied, manual).hidden, 4);
});

test('AI findings respect a revealed region and its latest adjusted geometry, with other new fields masked', () => {
  const context = { documentType: 'delivery', context: 'public', purpose: 'share' };
  const originalRect = [10, 20, 90, 20];
  const latestRect = [9, 20, 94, 25];
  const previous = [
    { id: 'order', category: 'order', anchor: 'DEMO-001', rect: latestRect, matchingRect: originalRect,
      geometryOverride: true, hidden: false, userOverride: 'keep' }
  ];
  const incoming = [
    { id: 'reclassified', category: 'account', anchor: 'DEMO-001', rect: originalRect },
    { id: 'new', category: 'name', anchor: 'Demo Recipient', rect: [10, 85, 95, 25] }
  ];
  const candidates = preserveEditedRegions(previous, reconcileFields(previous, incoming).fields);
  const fields = guardSuggestedReveals(previous, applyRecommendations(candidates, context));
  assert.equal(fields[0].hidden, false);
  assert.equal(fields[0].userOverride, 'keep');
  assert.equal(fields[0].recommendation.action, 'redact');
  assert.deepEqual(fields[0].rect, latestRect);
  assert.equal(fields[1].hidden, true);
  assert.equal(fields.find(field => field.id === 'order').hidden, false);
});

test('AI insights distinguish prior regions and skip ambiguous mappings', () => {
  const previous = [{ id:'a', category:'email', rect:[0,0,100,20] }];
  const candidates = [{ category:'email', rect:[0,0,100,20] }, { category:'phone', rect:[0,50,100,20] }, { category:'name', rect:[0,90,100,20] }];
  const current = [{ id:'a', name:'Email', category:'email', rect:[0,0,100,20] }, { id:'b', name:'Phone', category:'phone', rect:[0,50,100,20] }, { id:'c', category:'name', rect:[0,90,100,20] }, { id:'d', category:'name', rect:[0,90,100,20] }];
  assert.deepEqual(aiInsights(previous, candidates, current), [{ id:'a', name:'Email', kind:'existing' }, { id:'b', name:'Phone', kind:'new' }]);
});

test('review counts and exported rectangles share the same active mask selection', () => {
  const fields = [
    { id: 'a', rect: [1,2,3,4], hidden: true, recommendation: { action: 'redact' } },
    { id: 'b', rect: [5,6,7,8], hidden: false, userOverride: 'keep', recommendation: { action: 'redact' } },
    { id: 'c', rect: [9,10,11,12], hidden: true, pendingReveal: true, recommendation: { action: 'keep' } }
  ];
  const manual = [{ id: 1, rect: [15,16,17,18], hidden: true }, { id: 2, rect: [20,21,22,23], hidden: false }];
  assert.deepEqual(coverageSummary(fields, manual), { detected: 3, hidden: 2, markedVisible: 1, manual: 1, needsReview: 1, masks: 3 });
  assert.deepEqual(activeMasks(fields, manual).map(item => item.rect), [[1,2,3,4],[9,10,11,12],[15,16,17,18]]);
});
