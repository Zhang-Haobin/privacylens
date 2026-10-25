import test from 'node:test';
import assert from 'node:assert/strict';
import { maskTargetAtPoint, textLineTargets } from '../dist/mask-targets.js';

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

const word = (text, x0, y0, x1, y1) => ({ text, bbox: { x0, y0, x1, y1 } });
const document = { width: 300, height: 200, lines: [
  { id: 'l1', text: 'Alex Chan', words: [word('Alex', 10, 20, 45, 40), word('Chan', 50, 20, 90, 40)] },
  { id: 'l2', text: 'HK$ 299', words: [word('HK$ 299', 220, 20, 290, 40)] }
] };

test('OCR line targets cover every word with padding without crossing distant columns', () => {
  const lines = textLineTargets(document);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].rect, [6, 16, 88, 28]);
  assert.equal(maskTargetAtPoint([47, 30], [], [], lines).line.text, 'Alex Chan');
  assert.equal(maskTargetAtPoint([150, 30], [], [], lines), null);
  assert.equal(maskTargetAtPoint([250, 30], [], [], lines).line.text, 'HK$ 299');
});

test('visible existing masks retain priority, then clicking recognized text adds a whole-line target', () => {
  const lines = textLineTargets(document);
  const field = { name: 'Name', rect: [10, 20, 80, 20], hidden: true };
  assert.equal(maskTargetAtPoint([30, 30], [field], [], lines).mask, field);
  field.hidden = false;
  assert.equal(maskTargetAtPoint([30, 30], [field], [], lines).line, lines[0]);
});

test('OCR line coordinates are clipped to the image and identity is independent of transient line IDs', () => {
  const edge = { width: 30, height: 20, lines: [{ id: 'l1', text: 'Edge', words: [word('Edge', 0, 0, 30, 20)] }] };
  const target = textLineTargets(edge)[0];
  assert.deepEqual(target.rect, [0, 0, 30, 20]);
  assert.equal(textLineTargets({ ...edge, lines: [{ ...edge.lines[0], id: 'l99' }] })[0].key, target.key);
  assert.notEqual(textLineTargets({ ...edge, lines: [{ ...edge.lines[0], text: 'Changed' }] })[0].key, target.key);
  assert.deepEqual(textLineTargets(null), []);
});
