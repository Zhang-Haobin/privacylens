import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaskAnimator } from '../dist/mask-motion.js';

function fixture(progress = 0) {
  let time = 0; let nextId = 0;
  const frames = new Map();
  const animator = createMaskAnimator({
    now: () => time,
    requestFrame: callback => { frames.set(++nextId, callback); return nextId; },
    cancelFrame: id => frames.delete(id)
  });
  const record = { element: { style: {} }, progress, visible: progress === 1, motion: null };
  const step = timestamp => {
    time = timestamp;
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(callback => callback(time));
  };
  return { animator, record, step, frames };
}

test('covering renders intermediate widths anchored to the left for 600 ms', () => {
  const { animator, record, step } = fixture();
  let finished = 0;
  animator.set(record, true, true, () => finished++);
  step(150); assert.ok(record.progress > 0 && record.progress < 0.5);
  step(300); assert.equal(record.progress, 0.5);
  assert.equal(record.element.style.clipPath, 'inset(0 50% 0 0)');
  assert.equal(finished, 0);
  step(600); assert.equal(record.progress, 1); assert.equal(finished, 1);
});

test('removal reveals the right half before the left and finishes only after the wipe', () => {
  const { animator, record, step } = fixture(1);
  let removed = false;
  animator.set(record, false, true, () => { removed = true; });
  step(300); assert.equal(record.progress, 0.5); assert.equal(removed, false);
  assert.equal(record.element.style.clipPath, 'inset(0 50% 0 0)');
  step(600); assert.equal(record.progress, 0); assert.equal(removed, true);
});

test('rapid reversal continues from current progress and cancels stale removal', () => {
  const { animator, record, step } = fixture(1);
  let removed = false; let covered = false;
  animator.set(record, false, true, () => { removed = true; });
  step(300);
  animator.set(record, true, true, () => { covered = true; });
  assert.equal(record.progress, 0.5);
  step(450); assert.ok(record.progress > 0.5 && record.progress < 1);
  step(600); assert.equal(record.progress, 1);
  assert.equal(removed, false); assert.equal(covered, true);
});

test('animation off completes immediately and cancels outstanding frames', () => {
  const { animator, record, step, frames } = fixture(1);
  animator.set(record, false, true, () => assert.fail('Stale animation finished'));
  step(100);
  let finished = false;
  animator.set(record, false, false, () => { finished = true; });
  assert.equal(record.progress, 0); assert.equal(finished, true); assert.equal(frames.size, 0);
});

test('image changes can cancel motion without invoking an old completion callback', () => {
  const { animator, record, step, frames } = fixture(1);
  animator.set(record, false, true, () => assert.fail('Old image callback finished'));
  animator.cancel(record); step(1000);
  assert.equal(frames.size, 0); assert.equal(record.motion, null);
});
