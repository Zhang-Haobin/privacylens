import { documentTypes } from './document-context.js';
import { textCategories } from './privacy-types.js';
import { sanitizeOCRLines } from './technical-detection.js';

export const protectionLimits = Object.freeze({ purpose: 500, fields: 100, requestBytes: 16_384, responseBytes: 65_536, responseChars: 16_384 });
const actions = ['hide', 'keep', 'review'];
const reasons = {
  unnecessary: 'This detail appears unnecessary for the stated purpose.',
  task_relevant: 'The recipient may need this detail for the stated purpose.',
  unverified_recipient: 'Verify the recipient and check what they need.',
  unclear: 'The purpose gives too little information to recommend sharing this detail.',
  high_risk: 'This detail needs stronger privacy protection.'
};
const fieldId = /^f[1-9]\d{0,2}$/u;
const highRisk = new Set(['secret', 'payment', 'id', 'birth_date', 'personal_path']);
const academic = new Set(['university', 'course', 'grade', 'gpa']);
const deliveryIdentifiers = new Set(['order', 'tracking']);

function hasKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function supportedContext(documentType, audience) {
  return typeof documentType === 'string' && Object.hasOwn(documentTypes, documentType)
    && documentTypes[documentType].audiences.includes(audience);
}

export const protectionResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'protection_decisions',
    strict: true,
    schema: {
      type: 'object', additionalProperties: false, required: ['decisions'],
      properties: {
        decisions: {
          type: 'array', maxItems: protectionLimits.fields,
          items: {
            type: 'object', additionalProperties: false, required: ['field_id', 'action', 'reason_code'],
            properties: {
              field_id: { type: 'string' },
              action: { type: 'string', enum: actions },
              reason_code: { type: 'string', enum: Object.keys(reasons) }
            }
          }
        }
      }
    }
  }
};

function screenPurpose(purpose) {
  const lines = purpose.normalize('NFKC').trim().split(/\r\n?|\n/u).map((line, i) => ({
    id: `l${i + 1}`,
    words: (line.match(/\S+/gu) || []).map((text, j) => ({ id: `l${i + 1}w${j + 1}`, text }))
  }));
  const screened = sanitizeOCRLines(lines).lines.map(line => line.words.map(word => word.text).join(' ')).join('\n');
  return screened.replace(/\b(?:(?:https?|file|ftp):\/\/|data:[^,\s]+,)\S+/giu, '[link removed]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu, '[email removed]')
    .replace(/(?<![\p{L}\p{N}])(?:\+?\d[\d(). -]{5,}\d)(?![\p{L}\p{N}])/gu, '[number removed]')
    .replace(/\b(?:[a-z]{2,}[-_]?)\d{4,}[a-z\d_-]*\b/giu, '[identifier removed]');
}

export function validateProtectionRequest(body) {
  if (!hasKeys(body, ['consent', 'documentType', 'audience', 'purpose', 'fields']) || body.consent !== true) {
    throw new Error('Confirm sending only your purpose and field categories for AI sharing suggestions.');
  }
  if (!supportedContext(body.documentType, body.audience)) throw new Error('Choose an audience supported by this document type.');
  if (typeof body.purpose !== 'string' || !body.purpose.trim() || body.purpose.length > protectionLimits.purpose) {
    throw new Error('Enter a sharing purpose of up to 500 characters.');
  }
  if (body.purpose !== screenPurpose(body.purpose)) throw new Error('Use the screened purpose preview before sending.');
  if (!Array.isArray(body.fields) || !body.fields.length || body.fields.length > protectionLimits.fields) {
    throw new Error('Sharing suggestions require between 1 and 100 detected details.');
  }
  const ids = new Set();
  const fields = body.fields.map(field => {
    if (!hasKeys(field, ['id', 'category']) || typeof field.id !== 'string' || !fieldId.test(field.id)
        || ids.has(field.id) || !textCategories.includes(field.category)) {
      throw new Error('The request contains an invalid field category or identifier.');
    }
    ids.add(field.id);
    return { id: field.id, category: field.category };
  });
  return { documentType: body.documentType, audience: body.audience, purpose: body.purpose, fields };
}

export function createProtectionInput({ documentType, context, customPurpose }, fields) {
  const anchors = new Set(fields.map(field => field.anchor?.normalize('NFKC').trim()).filter(value => value?.length >= 2));
  let description = customPurpose.normalize('NFKC');
  for (const anchor of [...anchors].sort((a, b) => b.length - a.length)) {
    const literal = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    description = description.replace(new RegExp(`(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])`, 'giu'), '[detail removed]');
  }
  const body = {
    consent: true,
    documentType,
    audience: context,
    purpose: screenPurpose(description),
    fields: fields.map((field, index) => ({ id: `f${index + 1}`, category: field.category }))
  };
  validateProtectionRequest(body);
  return { body, fieldIds: new Map(body.fields.map((field, index) => [field.id, fields[index].id])) };
}

export function validateProtectionDecisions(response, fields) {
  if (!hasKeys(response, ['decisions']) || !Array.isArray(response.decisions) || response.decisions.length > fields.length) {
    throw new Error('AI returned an invalid list of sharing suggestions.');
  }
  const remaining = new Set(fields.map(field => field.id));
  return response.decisions.map(decision => {
    if (!hasKeys(decision, ['field_id', 'action', 'reason_code']) || !remaining.delete(decision.field_id)
        || !actions.includes(decision.action) || typeof decision.reason_code !== 'string' || !Object.hasOwn(reasons, decision.reason_code)
        || (decision.action === 'keep' && decision.reason_code !== 'task_relevant')) {
      throw new Error('AI returned an invalid or conflicting field suggestion.');
    }
    return { field_id: decision.field_id, action: decision.action, reason_code: decision.reason_code };
  });
}

export function safeProtectionRecommendation(field, { documentType, audience }, decision) {
  const source = 'ai_protection';
  if (highRisk.has(field.category) || decision.reason_code === 'high_risk') {
    return { source, action: 'hide', reason: reasons.high_risk, canReveal: false };
  }
  const deliverySupport = documentType === 'delivery' && audience === 'support';
  if ((audience === 'public' && !academic.has(field.category)) || (deliveryIdentifiers.has(field.category) && !deliverySupport)) {
    return { source, action: 'hide', reason: 'Local protection recommends covering this detail for this audience.', canReveal: false };
  }
  if (field.retained && decision.action !== 'hide') {
    return { source, action: 'review', reason: 'Check the location of this earlier field manually.', canReveal: false };
  }
  return {
    source, action: decision.action, reason: reasons[decision.reason_code],
    canReveal: decision.action !== 'hide' && ['task_relevant', 'unverified_recipient'].includes(decision.reason_code)
  };
}

export function sameProtectionVersion(original, current) {
  return original.loadId === current.loadId && original.ocrDocument === current.ocrDocument
    && original.fieldsVersion === current.fieldsVersion && original.sharingVersion === current.sharingVersion;
}

export function protectionMaskChange(field, recommendation) {
  if (!recommendation) return null;
  if (field.hidden && recommendation.canReveal) return false;
  if (!field.hidden && recommendation.action === 'hide') return true;
  return null;
}
