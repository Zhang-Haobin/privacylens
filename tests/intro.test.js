import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntroDemo, demoRecommendations, initialEntry, introPreferenceKey, rememberIntro } from '../dist/intro.js';

test('first visits show intro, returning visits bypass it, and explicit links take precedence', () => {
  const entries = new Map();
  const storage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
  assert.equal(initialEntry('', storage), 'intro');
  rememberIntro(storage);
  assert.deepEqual([...entries], [[introPreferenceKey, '1']]);
  assert.equal(initialEntry('', storage), 'landing');
  assert.equal(initialEntry('#intro', storage), 'intro');
  assert.equal(initialEntry('#upload', undefined), 'landing');
  assert.equal(initialEntry('#workspace', storage), 'landing'); // No image survives a reload.
});

test('denied browser storage never blocks intro or upload access', () => {
  const unavailable = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(initialEntry('', unavailable), 'intro');
  assert.equal(initialEntry('#upload', unavailable), 'landing');
  assert.doesNotThrow(() => rememberIntro(unavailable));
});

test('demo keeps personal identifiers hidden and only reveals order ID for a support lookup', () => {
  for (const scenario of ['public', 'friends', 'support', 'unknown']) {
    const demo = demoRecommendations(scenario);
    for (const category of ['name', 'phone', 'address']) assert.equal(demo.fields[category].action, 'redact');
    assert.equal(demo.fields.order.action, scenario === 'support' ? 'keep' : 'redact');
  }
  assert.match(demoRecommendations('support').explanation, /Verify the official support channel yourself/);
});

function fixture(reduced = false) {
  const classes = new Set();
  const listeners = {};
  let mediaChange;
  const root = {
    classList: { add: key => classes.add(key), remove: key => classes.delete(key) },
    querySelectorAll: () => [], querySelector: () => ({}),
    addEventListener: (name, callback) => { listeners[name] = callback; }
  };
  const media = { matches: reduced, addEventListener: (name, callback) => { mediaChange = callback; } };
  return { root, media, classes, listeners, change: () => mediaChange() };
}

test('intro animation stops on exit, does not restart, and responds to reduced motion', () => {
  const f = fixture();
  const demo = createIntroDemo(f.root, f.media);
  demo.setActive(true);
  assert.ok(f.classes.has('demo-playing'));
  demo.setActive(false);
  assert.equal(f.classes.has('demo-playing'), false);
  demo.setActive(true);
  assert.equal(f.classes.has('demo-playing'), false);
  const live = fixture();
  createIntroDemo(live.root, live.media).setActive(true);
  live.media.matches = true; live.change();
  assert.equal(live.classes.has('demo-playing'), false);
  const reduced = fixture(true);
  createIntroDemo(reduced.root, reduced.media).setActive(true);
  assert.equal(reduced.classes.has('demo-playing'), false);
});
