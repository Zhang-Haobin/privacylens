import { recommendField } from './sharing-context.js';

export const introPreferenceKey = 'privacylens.intro-seen.v1';
export function initialEntry(hash, storage) {
  if (hash === '#intro') return 'intro';
  if (hash === '#upload' || hash === '#workspace') return 'landing';
  try { return storage?.getItem(introPreferenceKey) === '1' ? 'landing' : 'intro'; }
  catch { return 'intro'; }
}
export function rememberIntro(storage) {
  try { storage?.setItem(introPreferenceKey, '1'); } catch { /* Storage is optional. */ }
}
const scenarios = {
  public: { context: 'public', purpose: 'share', explanation: 'A public update needs the delivery status, not a name, phone, address or order number. Review before sharing.' },
  friends: { context: 'circle', purpose: 'advice', explanation: 'Friends can advise on the delay without personal identifiers. The same details stay hidden; a private chat can still be forwarded.' },
  support: { context: 'support', purpose: 'lookup', explanation: 'An order lookup can need the order number. Other personal details stay hidden. Verify the official support channel yourself and confirm what they need.' }
};
export function demoRecommendations(scenario) {
  const selected = Object.hasOwn(scenarios, scenario) ? scenarios[scenario] : scenarios.public;
  return {
    explanation: selected.explanation,
    fields: Object.fromEntries(['order', 'name', 'phone', 'address'].map(category => [category, recommendField({ category }, { documentType: 'delivery', ...selected })]))
  };
}

export function createIntroDemo(root, motionQuery) {
  let active = false;
  let played = false;
  const update = scenario => {
    const demo = demoRecommendations(scenario);
    for (const field of root.querySelectorAll('[data-demo-field]')) {
      const hidden = demo.fields[field.dataset.demoField].action !== 'keep';
      field.classList.toggle('is-covered', hidden);
      // Do not read the fictional value beneath an opaque mask to screen readers.
      field.firstElementChild.setAttribute('aria-hidden', String(hidden));
      field.setAttribute('aria-label', hidden ? `${field.dataset.demoField}: hidden` : `${field.dataset.demoField}: ${field.firstElementChild.textContent}`);
    }
    for (const button of root.querySelectorAll('[data-demo-context]')) button.setAttribute('aria-pressed', String(button.dataset.demoContext === scenario));
    root.querySelector('#demoExplanation').textContent = demo.explanation;
  };
  for (const button of root.querySelectorAll('[data-demo-context]')) button.addEventListener('click', () => {
    root.classList.remove('demo-playing');
    update(button.dataset.demoContext);
  });
  motionQuery.addEventListener('change', () => { if (motionQuery.matches) root.classList.remove('demo-playing'); });
  root.addEventListener('animationend', event => { if (event.animationName === 'welcome-scan') root.classList.remove('demo-playing'); });
  update('public');
  return {
    setActive(visible) {
      if (visible === active) return;
      active = visible;
      if (active && !played && !motionQuery.matches) { root.classList.add('demo-playing'); played = true; }
      if (!active) { root.classList.remove('demo-playing'); played = true; }
    }
  };
}
