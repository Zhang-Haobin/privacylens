import test from 'node:test';
import assert from 'node:assert/strict';
import { maskTargetAtPoint } from '../dist/mask-targets.js';

test('the same image position can remove and restore a suggested mask repeatedly', () => {
  const field = { id: 'name', name: 'Full name', rect: [10, 20, 100, 30], hidden: true };
  for (const hidden of [true, false, true, false]) {
    const target = maskTargetAtPoint([50, 30], [field], []);
    assert.equal(target.mask, field); assert.equal(target.hidden, hidden);
    target.mask.hidden = !target.hidden;
  }
});

test('manual regions remain available for restoring after their mask is disabled', () => {
  const mask = { id: 1, rect: [10, 20, 100, 30], hidden: true };
  let target = maskTargetAtPoint([50, 30], [], [mask]);
  target.mask.hidden = false;
  target = maskTargetAtPoint([50, 30], [], [mask]);
  assert.equal(target.mask, mask); assert.equal(target.hidden, false);
  target.mask.hidden = true;
  assert.equal(maskTargetAtPoint([50, 30], [], [mask]).hidden, true);
});

test('overlap removes visible masks in paint order before restoring inactive regions', () => {
  const field = { name: 'Phone', rect: [0, 0, 100, 30], hidden: true };
  const first = { id: 1, rect: [0, 0, 100, 30], hidden: true };
  const last = { id: 2, rect: [0, 0, 100, 30], hidden: true };
  const target = () => maskTargetAtPoint([20, 10], [field], [first, last]);
  assert.equal(target().mask, last); last.hidden = false;
  assert.equal(target().mask, first); first.hidden = false;
  assert.equal(target().mask, field); field.hidden = false;
  assert.equal(target().mask, last); assert.equal(target().hidden, false);
});

test('kept suggestions can be covered, and blank image areas never create masks', () => {
  const field = { name: 'Order', rect: [10, 20, 100, 30], hidden: false };
  assert.equal(maskTargetAtPoint([10, 20], [field], []).hidden, false);
  for (const position of [[9, 20], [110, 30], [50, 50], [300, 300]]) {
    assert.equal(maskTargetAtPoint(position, [field], []), null);
  }
});
