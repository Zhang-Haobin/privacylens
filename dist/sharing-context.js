import { documentTypes, purposesFor, purposeRegistry } from './document-context.js';
export const audiences = {
  public: { label: 'A public audience', detail: 'Social posts · forums', note: 'Review details that identify you or anyone else before posting.' },
  circle: { label: 'Friends & family', detail: 'Private chats · small groups', note: 'A small group can still forward an image. Review other people’s details too.' },
  team: { label: 'Classmates & colleagues', detail: 'Study groups · work channels', note: 'Review internal messages and project details before sharing.' },
  support: { label: 'Official support', detail: 'Verify the service channel', note: 'The app cannot verify this recipient. Check the service channel first.' },
  organization: { label: 'An organization', detail: 'HR · university · authorized team', note: 'Confirm who will receive this copy and which details they require.' }
};
// Legacy purposes remain exported for existing integrations and regression checks.
export const purposes = { share: purposeRegistry.share, advice: purposeRegistry.advice, issue: { label: 'Explain a problem', keep: 'The issue and relevant non-private messages.' }, lookup: purposeRegistry.lookup };
export function recommendField(field, { documentType = 'general', context = '', purpose = '' } = {}) {
  const type = field.category || field.id;
  const result = (action, reason) => ({ action, reason });
  const allowed = Object.hasOwn(documentTypes, documentType) && (documentTypes[documentType].audiences.includes(context)) && purposesFor(documentType).includes(purpose);
  if (type === 'secret') return result('redact', 'Keep passwords, access codes and tokens out of the shared copy. Masking does not revoke an exposed credential; rotate or revoke it if it was disclosed.');
  if (field.retained) return result('review', 'Kept from earlier coverage because this region or choice could not be matched reliably in the latest scan. Recheck it.');
  if (type === 'personal_path') return result('redact', 'A personal directory can disclose a username or private project. The whole OCR word is covered; adjust the box if needed.');
  if (type === 'internal_endpoint') return result('review', 'This may be an internal host or private network address, but that alone does not establish confidentiality. Confirm whether this recipient needs it.');
  if (allowed && documentType === 'technical_screenshot' && context === 'support' && purpose === 'software_support' && type === 'account') return result('review', 'Software support may need an account identifier. Verify the channel and request before revealing it; credentials should remain hidden.');
  const academic = ['university', 'course', 'grade', 'gpa'].includes(type);
  if (allowed && documentType === 'transcript' && ['showcase', 'job', 'submission'].includes(purpose)) {
    if (academic) return result('keep', purpose === 'showcase' ? 'This academic information is relevant to showcasing your achievements.' : 'This academic information is relevant to the selected application or submission.');
    if (type === 'name' && context !== 'public' && ['job', 'submission'].includes(purpose)) return result('review', 'The recipient may need your name to identify the applicant. Confirm their requirements before revealing it.');
    if (type === 'student_id' && context === 'organization' && purpose === 'submission') return result('review', 'The university may require a student ID. Confirm both the recipient and whether a redacted copy is accepted.');
  }
  if (allowed && documentType === 'delivery' && ['order', 'tracking'].includes(type) && context === 'support') {
    if (purpose === 'lookup') return result('keep', 'Helps verified support find the order or delivery. Confirm this is the number they need.');
    if (purpose === 'return') return result('review', 'Support may need this number for a return. Confirm it is required before revealing it.');
  }
  if (allowed && documentType === 'chat' && purpose === 'report' && context === 'organization' && ['name', 'private_message'].includes(type)) return result('review', 'An authorized report may need this identity or message. Confirm what is necessary; protect unrelated people.');
  if (academic) return result('review', 'Academic records can disclose personal information. Choose a relevant academic purpose or review this detail manually.');
  if (type === 'private_message') return result('review', 'Private message content may identify or disclose information about someone. Confirm it is needed for this audience.');
  const reasons = {
    order: 'An order identifier is unnecessary here. Only include it for an explicit request to verified support.',
    tracking: 'A tracking number can identify a delivery. It is unnecessary for this sharing purpose.',
    student_id: 'A student ID is not needed for public sharing or an initial job application.',
    name: context === 'public' ? 'A public audience does not need a personal name to understand the situation.' : 'Keep personal names private unless the selected task requires them.',
    birth_date: 'A date of birth identifies someone and is unnecessary for this sharing purpose.',
    phone: 'A screenshot does not need to expose someone’s phone number.', email: 'Keep personal contact details out of the shared copy.',
    address: 'An exact address can identify where someone lives or receives deliveries.', payment: 'Payment credentials are unrelated to the sharing purpose.',
    transaction: 'A transaction ID identifies a specific payment. Include it only after reviewing the recipient’s request.',
    reference: 'Keep this reference private unless you explicitly choose to include it.', id: 'Identity document details are unnecessary in this shared copy.', account: 'Account identifiers can link the screenshot to a person.'
  };
  return result('redact', reasons[type] || 'This detail may identify someone. Keep it hidden until you review its relevance.');
}
export function applyRecommendations(fields, context) {
  return fields.map(field => {
    const recommendation = recommendField(field, context);
    const userOverride = ['redact', 'keep'].includes(field.userOverride) ? field.userOverride : null;
    const pendingReveal = Boolean(field.pendingReveal && !userOverride && recommendation.action === 'keep');
    return { ...field, recommendation, userOverride, pendingReveal, hidden: userOverride ? userOverride === 'redact' : pendingReveal || recommendation.action !== 'keep' };
  });
}
export function shouldHide(field, audience, purpose) {
  // Backwards-compatible delivery policy; the UI passes all dimensions to recommendField.
  if (purpose === 'issue') return true;
  return recommendField(field, { documentType: 'delivery', context: audience, purpose }).action !== 'keep';
}
export function fieldReason(field, audience, purpose) { return recommendField(field, { documentType: 'delivery', context: audience, purpose }).reason; }
export function contextDifference(previous, current) {
  const visibility = new Map(previous.map(field => [field.id, Boolean(field.hidden)]));
  const changed = current.filter(field => visibility.has(field.id) && visibility.get(field.id) !== Boolean(field.hidden));
  return { hidden: changed.filter(field => field.hidden).map(field => field.name), visible: changed.filter(field => !field.hidden).map(field => field.name) };
}
export function sharingPlan(audience, purpose, documentType = 'delivery') {
  const recipient = Object.hasOwn(audiences, audience) ? audiences[audience] : null;
  const task = Object.hasOwn(purposeRegistry, purpose) ? purposeRegistry[purpose] : Object.hasOwn(purposes, purpose) ? purposes[purpose] : null;
  const lookup = documentType === 'delivery' && audience === 'support' && purpose === 'lookup';
  return {
    label: `${recipient?.label || 'Recipient not selected'} · ${task?.label || 'Purpose not selected'}`,
    keep: lookup ? 'Order / tracking numbers, delivery status and relevant dates.' : task?.keep || 'Choose a recipient and purpose. Uncertain private fields stay masked.',
    hide: 'Unnecessary identifiers, contact details, credentials and private content.',
    note: `${recipient?.note || 'No recipient has been assumed.'}${purpose === 'custom' ? ' Custom descriptions stay on this device; generic conservative rules apply.' : ''}${documentType === 'transcript' && purpose === 'submission' ? ' Check whether the recipient accepts a redacted copy.' : ''}`
  };
}

// A change of context or a rescan must never silently uncover an existing mask.
export function guardSuggestedReveals(previous, current) {
  const old = new Map(previous.map(field => [field.id, field]));
  return current.map(field => {
    const before = old.get(field.id);
    if (before?.hidden && !field.hidden && !field.userOverride) return { ...field, hidden: true, pendingReveal: true };
    return field;
  });
}
