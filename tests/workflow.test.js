import test from 'node:test';
import assert from 'node:assert/strict';
import { sharingProfiles, profileForContext } from '../dist/workflow.js';
import { documentTypes, purposeRegistry } from '../dist/document-context.js';
import { recommendField } from '../dist/sharing-context.js';
import { recognitionLanguage } from '../dist/ocr.js';

test('sharing choices map only to supported recipients and purposes for each type', () => {
  for (const [type, config] of Object.entries(documentTypes)) {
    const profiles = sharingProfiles(type);
    assert.equal(new Set(profiles.map(profile => profile.id)).size, profiles.length);
    assert.equal(profiles.at(-1).id, 'custom');
    for (const profile of profiles) {
      if (profile.audience) assert.ok(config.audiences.includes(profile.audience));
      if (profile.purpose) assert.ok(config.purposes.includes(profile.purpose));
      for (const option of profile.followup || []) { assert.ok(config.purposes.includes(option.value)); assert.ok(purposeRegistry[option.value]); }
    }
  }
  assert.equal(sharingProfiles('unsupported')[0].purpose, 'share');
  assert.equal(sharingProfiles('constructor')[0].purpose, 'share');
});

test('ambiguous recipients ask a purpose instead of assuming a lookup or job application', () => {
  const employer = sharingProfiles('transcript').find(profile => profile.id === 'employer');
  const support = sharingProfiles('delivery').find(profile => profile.id === 'support');
  assert.equal(employer.purpose, ''); assert.equal(support.purpose, '');
  assert.deepEqual(employer.followup.map(option => option.value), ['job', 'custom']);
  assert.deepEqual(support.followup.map(option => option.value), ['lookup', 'return']);
  assert.equal(recommendField({ category: 'order' }, { documentType: 'delivery', context: support.audience, purpose: support.purpose }).action, 'redact');
  assert.equal(profileForContext('transcript', 'organization', 'submission'), 'university');
  assert.equal(profileForContext('transcript', 'organization', 'job'), 'employer');
  assert.equal(profileForContext('chat', '', ''), '');
});

test('simple sharing choices retain conservative name/ID rules and default Review behavior', () => {
  const publicProfile = sharingProfiles('transcript').find(profile => profile.id === 'public');
  const university = sharingProfiles('transcript').find(profile => profile.id === 'university');
  const context = profile => ({ documentType: 'transcript', context: profile.audience, purpose: profile.purpose });
  assert.equal(recommendField({ category: 'name' }, context(publicProfile)).action, 'redact');
  assert.equal(recommendField({ category: 'student_id' }, context(university)).action, 'review');
  assert.equal(recommendField({ category: 'gpa' }, context(publicProfile)).action, 'keep');
  assert.equal(profileForContext('transcript', 'circle', 'submission'), 'custom');
});

test('default recognition explicitly reads English and both Chinese scripts without a false language claim', () => {
  assert.equal(recognitionLanguage('auto'), 'eng+chi_tra+chi_sim');
  assert.equal(recognitionLanguage('eng'), 'eng');
  assert.equal(recognitionLanguage('eng+chi_tra'), 'eng+chi_tra');
  assert.throws(() => recognitionLanguage('unknown'));
});

test('merged label/value OCR tokens still preserve a matching GPA choice', async () => {
  const { reconcileFields } = await import('../dist/field-state.js');
  const previous = [{ id: 'gpa', category: 'gpa', anchor: '3.63 / 4.30', name: 'GPA', rect: [160, 650, 200, 45], hidden: true, userOverride: 'redact' }];
  const incoming = [{ id: 'scan-1', category: 'gpa', anchor: 'CGPA:3.63/4.30', name: 'GPA 1', rect: [90, 650, 270, 45] }];
  const result = reconcileFields(previous, incoming);
  assert.equal(result.restored, 1); assert.equal(result.retained, 0); assert.equal(result.fields[0].id, 'gpa');
});
