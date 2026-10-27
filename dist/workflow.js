// Each visible choice states a concrete task. Ambiguous recipients ask a follow-up.
const publicChoice = (purpose, detail) => ({ id: 'public', label: 'Public', detail, audience: 'public', purpose });
const friends = (purpose) => ({ id: 'friends', label: 'Friends & family', detail: 'Share with a small private group', audience: 'circle', purpose });
const custom = { id: 'custom', label: 'Custom', detail: 'Choose your own audience and purpose', audience: '', purpose: 'custom' };
export function sharingProfiles(type) {
  const profiles = {
    transcript: [publicChoice('showcase', 'Showcase academic achievements'), friends('showcase'), { id: 'employer', label: 'Employer', detail: 'Job application or a general discussion', audience: 'organization', purpose: '', followup: [{ value: 'job', label: 'Job or internship application' }, { value: 'custom', label: 'General discussion / another purpose' }] }, { id: 'university', label: 'University', detail: 'Submit academic records', audience: 'organization', purpose: 'submission' }],
    delivery: [publicChoice('share', 'Post a delivery or purchase update'), friends('share'), { id: 'support', label: 'Official support', detail: 'Look up a delivery or request a return', audience: 'support', purpose: '', followup: [{ value: 'lookup', label: 'Find my order or delivery' }, { value: 'return', label: 'Request a return or refund' }] }, { id: 'team', label: 'Classmates & colleagues', detail: 'Ask for advice', audience: 'team', purpose: 'advice' }],
    chat: [publicChoice('post', 'Share a conversation publicly'), friends('advice'), { id: 'report', label: 'Authorized organization', detail: 'Report harassment or misconduct', audience: 'organization', purpose: 'report' }, { id: 'team', label: 'Classmates & colleagues', detail: 'Ask for advice', audience: 'team', purpose: 'advice' }],
    general: [publicChoice('share', 'Share an update publicly'), friends('advice'), { id: 'organization', label: 'An organization', detail: 'Submit the requested information', audience: 'organization', purpose: 'submit' }, { id: 'team', label: 'Classmates & colleagues', detail: 'Ask for advice', audience: 'team', purpose: 'advice' }]
  };
  return [...(Object.hasOwn(profiles, type) ? profiles[type] : profiles.general), custom];
}
export function profileForContext(type, audience, purpose) {
  if (!audience || !purpose) return '';
  return sharingProfiles(type).find(profile => profile.id !== 'custom' && profile.audience === audience && (profile.purpose === purpose || profile.followup?.some(option => option.value === purpose)))?.id || 'custom';
}
