import { documentTypes } from './document-context.js';

// These defaults drive local rules without inferring a specific support request.
const sharingDefaults = {
  delivery: { public: 'share', circle: 'share', team: 'advice' },
  transcript: { public: 'showcase', circle: 'showcase' },
  chat: { public: 'post', circle: 'advice', team: 'advice' },
  technical_screenshot: { public: 'technical_help', support: 'software_support', team: 'team_debug' },
  general: { public: 'share', circle: 'advice', team: 'advice', support: 'advice' }
};

export function editorSharingChoice(documentType, selection) {
  const custom = selection === 'custom';
  const context = custom ? '' : selection;
  const compatible = !context || documentTypes[documentType].audiences.includes(context);
  const purpose = custom ? 'custom' : context && compatible ? sharingDefaults[documentType][context] || 'custom' : '';
  return { documentType, context, custom, compatible, purpose };
}

// Each visible choice states a concrete task. Ambiguous recipients ask a follow-up.
const publicChoice = (purpose, detail) => ({ id: 'public', label: 'Public', detail, audience: 'public', purpose });
const friends = (purpose) => ({ id: 'friends', label: 'Friends & family', detail: 'Share with a small private group', audience: 'circle', purpose });
const custom = { id: 'custom', label: 'Custom', detail: 'Choose your own audience and purpose', audience: '', purpose: 'custom' };
export function sharingProfiles(type) {
  const profiles = {
    technical_screenshot: [{ id: 'public', label: 'Public forum', detail: 'Ask for technical help online', audience: 'public', purpose: 'technical_help' }, { id: 'support', label: 'Official support', detail: 'Contact software support', audience: 'support', purpose: 'software_support' }, { id: 'team', label: 'Teammates', detail: 'Debug with colleagues', audience: 'team', purpose: 'team_debug' }],
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

const deliverySubject = /\b(?:order|package|parcel|shipment|delivery|item)\b|包裹|貨件|货件|訂單|订单|快遞|快递|配送|物流/u;
const deliveryIntents = [
  { purpose: 'lookup', signal: /\b(?:track|locate|find(?!\s+out)|look up|check\s+(?:the\s+)?(?:status|where)|where\s+(?:is|has)\s+(?:my|the))\b|查件|查(?:詢|询)?物流|追(?:蹤|踪)|查(?:找|詢|询).{0,12}(?:包裹|訂單|订单|配送|快遞|快递)/u },
  { purpose: 'return', signal: /\b(?:refund|return\s+(?:my|the|this|an?|\d+)|money back)\b|退款|退貨|退货|退回/u }
];
const negatedIntent = /\b(?:do not|don['’]t|no need to|not|never|without|instead of)\b[^.!?;。？！；]{0,40}\b(?:track|locate|find|look up|refund|return|share|provide|show|disclose|order number)\b|(?:不想|不要|不用|不需要|無需|无需|無須|无须|不是要)[^。？！；]{0,16}(?:追[蹤踪]|查|退款|退[貨货]|提供|公開|公开)/u;
const generalDeliveryQuestion = /\b(?:weekends?|opening hours|delivery options|availability)\b|周末|週末|營業時間|营业时间/u;

export function matchCustomPurpose(description, documentType, audience) {
  if (documentType !== 'delivery' || audience !== 'support') return { status: 'unsupported' };
  const text = description.normalize('NFKC').trim().toLowerCase();
  const matches = deliveryIntents.filter(({ signal }) => signal.test(text));
  if (matches.length > 1 || (matches.length && (negatedIntent.test(text) || generalDeliveryQuestion.test(text)))) return { status: 'ambiguous' };
  if (matches.length !== 1 || !deliverySubject.test(text)) return { status: 'unknown' };
  return { status: 'matched', purpose: matches[0].purpose };
}

export function resolveSharingChoice({ documentType, context, purpose, customPurpose = '', confirmedPurpose = '' }) {
  const custom = Boolean(customPurpose.trim());
  const match = custom ? matchCustomPurpose(customPurpose, documentType, context) : null;
  const activePurpose = custom ? (match.purpose && match.purpose === confirmedPurpose ? confirmedPurpose : 'custom') : purpose;
  const type = documentTypes[documentType];
  const compatible = (!context || type.audiences.includes(context)) && (!activePurpose || type.purposes.includes(activePurpose));
  return { custom, match, purpose: activePurpose, compatible };
}
