import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRecommendations, guardSuggestedReveals } from '../dist/sharing-context.js';
import { reconcileFields, aiInsights } from '../dist/field-state.js';

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

test('AI insights distinguish prior regions and skip ambiguous mappings', () => {
  const previous = [{ id:'a', category:'email', rect:[0,0,100,20] }];
  const candidates = [{ category:'email', rect:[0,0,100,20] }, { category:'phone', rect:[0,50,100,20] }, { category:'name', rect:[0,90,100,20] }];
  const current = [{ id:'a', name:'Email', category:'email', rect:[0,0,100,20] }, { id:'b', name:'Phone', category:'phone', rect:[0,50,100,20] }, { id:'c', category:'name', rect:[0,90,100,20] }, { id:'d', category:'name', rect:[0,90,100,20] }];
  assert.deepEqual(aiInsights(previous, candidates, current), [{ id:'a', name:'Email', kind:'existing' }, { id:'b', name:'Phone', kind:'new' }]);
});

test('review counts and exported rectangles share the same active mask selection', async () => {
  const { activeMasks, coverageSummary } = await import('../dist/field-state.js');
  const fields = [
    { id: 'a', rect: [1,2,3,4], hidden: true, recommendation: { action: 'redact' } },
    { id: 'b', rect: [5,6,7,8], hidden: false, userOverride: 'keep', recommendation: { action: 'redact' } },
    { id: 'c', rect: [9,10,11,12], hidden: true, pendingReveal: true, recommendation: { action: 'keep' } }
  ];
  const manual = [{ id: 1, rect: [15,16,17,18], hidden: true }, { id: 2, rect: [20,21,22,23], hidden: false }];
  assert.deepEqual(coverageSummary(fields, manual), { detected: 3, hidden: 2, markedVisible: 1, manual: 1, needsReview: 1, masks: 3 });
  assert.deepEqual(activeMasks(fields, manual).map(item => item.rect), [[1,2,3,4],[9,10,11,12],[15,16,17,18]]);
});
