// Pure coordinate / policy helpers, shared by the browser and regression tests.
export const textCategories = ['order', 'tracking', 'transaction', 'reference', 'name', 'phone', 'address', 'email', 'payment', 'id', 'account', 'other'];
export const categoryNames = { order: 'Order number', tracking: 'Tracking number', transaction: 'Payment transaction ID', reference: 'Reference number', name: 'Personal name', phone: 'Phone number', address: 'Address', email: 'Email address', payment: 'Payment details', id: 'Identity document', account: 'Account identifier', other: 'Sensitive detail' };
const roleNames = { sender: 'Sender', recipient: 'Recipient', unknown: '', merchant: 'Merchant' };
const area = b => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
function overlaps(a, b) {
  const intersection = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return intersection / Math.max(1, area(a) + area(b) - intersection);
}
export function makeDocument(pages, width, height, inputWidth, inputHeight) {
  const words = [];
  for (const page of pages) for (const block of page.blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) for (const raw of line.words || []) {
    const text = raw.text?.trim();
    if (!text || !raw.bbox || !Object.values(raw.bbox).every(Number.isFinite)) continue;
    const bbox = { x0: Math.max(0, raw.bbox.x0 * width / inputWidth), y0: Math.max(0, raw.bbox.y0 * height / inputHeight), x1: Math.min(width, raw.bbox.x1 * width / inputWidth), y1: Math.min(height, raw.bbox.y1 * height / inputHeight) };
    if (!area(bbox)) continue;
    const previous = words.find(word => overlaps(word.bbox, bbox) > 0.55);
    if (previous) {
      // Keep the union even if a second pass recognizes a shorter token.
      const union = { x0: Math.min(previous.bbox.x0, bbox.x0), y0: Math.min(previous.bbox.y0, bbox.y0), x1: Math.max(previous.bbox.x1, bbox.x1), y1: Math.max(previous.bbox.y1, bbox.y1) };
      if (raw.confidence > previous.confidence) { previous.text = text; previous.confidence = raw.confidence; }
      previous.bbox = union;
    } else {
      words.push({ text, bbox, confidence: raw.confidence || 0 });
      if (words.length > 2000) throw new Error('Too much text for one detection. Crop the screenshot into smaller sections. Existing masks retained.');
    }
  }
  words.sort((a, b) => (a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2 || a.bbox.x0 - b.bbox.x0);
  const rows = [];
  for (const word of words) {
    const middle = (word.bbox.y0 + word.bbox.y1) / 2;
    const row = rows.find(r => Math.abs(r.middle - middle) < Math.max(3, Math.min(r.height, word.bbox.y1 - word.bbox.y0) * 0.45));
    if (row) row.words.push(word);
    else rows.push({ middle, height: word.bbox.y1 - word.bbox.y0, words: [word] });
  }
  const lines = []; let nextWord = 1;
  for (const row of rows) {
    row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    let current = [];
    const add = () => { if (current.length) lines.push({ id: `l${lines.length + 1}`, words: current, text: current.map(w => w.text).join(' ') }); };
    for (const word of row.words) {
      const last = current.at(-1);
      if (last && word.bbox.x0 - last.bbox.x1 > Math.max(45, row.height * 3)) { add(); current = []; }
      current.push({ ...word, id: `w${nextWord++}` });
    }
    add();
  }
  if (lines.length > 300 || words.length > 2000 || words.some(word => word.text.length > 160) || words.reduce((n, word) => n + word.text.length, 0) > 40000) throw new Error('Too much text for one detection. Crop the screenshot into smaller sections. Existing masks retained.');
  return { width, height, lines, words: lines.flatMap(line => line.words) };
}
export function textPayload(document) {
  const { width, height } = document;
  return { width, height, consent: true, lines: document.lines.map(line => ({ id: line.id, words: line.words.map(word => {
    const b = word.bbox;
    return { id: word.id, text: word.text, box: [b.x0 / width, b.y0 / height, (b.x1 - b.x0) / width, (b.y1 - b.y0) / height].map(n => Math.round(n * 10000) / 10000) };
  }) })) };
}
const normalized = text => text.toUpperCase().replace(/[^A-Z0-9]/g, '');
export function localSuggestions(document) {
  const fields = [];
  for (const line of document.lines) {
    const text = line.text.replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '');
    let category;
    if (/transaction\s*(?:id|number|#)|交易(?:編號|编号|號碼|号码)/i.test(text)) category = 'transaction';
    else if (/\b(?:tracking|waybill|trk\s*#)|運單|运单|快遞單|快递单/i.test(text)) category = 'tracking';
    else if (/\border\s*(?:number|no\.?|#|:)|訂單(?:號|编|編)|订单(?:号|编)/i.test(text)) category = 'order';
    else if (/\b(?:reference|shipment\s*ref|ref\s*:)/i.test(text)) category = 'reference';
    else if (/[\w.+-]+\s*@\s*[\w.-]+\.[a-z]{2,}/i.test(text) || /\bemail\s*[:：]|電郵|电邮|郵箱|邮箱/i.test(text)) category = 'email';
    else if (/\b(?:tel|phone|mobile)\s*[.:：]|電話|电话|手機|手机/i.test(text) || /(?:\+\d[\d ()-]{6,}\d)/.test(text)) category = 'phone';
    else if (/(?:[*•·xX]{2,}|visa|mastercard|amex).{0,12}\d{4}\b/i.test(text)) category = 'payment';
    if (category) fields.push({ category, role: 'unknown', wordIds: line.words.map(w => w.id), source: 'local' });
  }
  // Link every occurrence of a locally identified number, not just its labelled line.
  const numbered = fields.filter(f => ['order', 'tracking', 'transaction', 'reference'].includes(f.category));
  for (const field of numbered) {
    const selected = document.words.filter(w => field.wordIds.includes(w.id));
    const candidates = selected.filter(w => /\d/.test(w.text)).map(w => normalized(w.text)).filter(value => value.length >= 8);
    for (const line of document.lines) if (!fields.some(f => f.wordIds.some(id => line.words.some(w => w.id === id)))) {
      if (candidates.some(value => normalized(line.text).includes(value))) fields.push({ category: field.category, role: 'unknown', wordIds: line.words.map(w => w.id), source: 'local' });
    }
  }
  return fields;
}
export function validateClassifications(fields, document) {
  if (!Array.isArray(fields) || fields.length > 150) throw new Error('Invalid text classifications. Existing masks retained.');
  const known = new Set(document.words.map(word => word.id)); const used = new Set();
  return fields.map(field => {
    if (!textCategories.includes(field?.category) || !Object.hasOwn(roleNames, field.role) || !Array.isArray(field.wordIds) || !field.wordIds.length || field.wordIds.length > 200 || field.box !== undefined) throw new Error('Invalid text classification. Existing masks retained.');
    for (const id of field.wordIds) {
      if (!known.has(id) || used.has(id)) throw new Error('Unknown or conflicting text ID. Existing masks retained.');
      used.add(id);
    }
    return { category: field.category, role: field.role, wordIds: [...field.wordIds], source: 'ai' };
  });
}
export function suggestionsToFields(suggestions, document) {
  const result = [];
  for (const suggestion of suggestions) {
    const ids = new Set(suggestion.wordIds);
    if (suggestion.category === 'address') {
      // OCR artifacts can split one baseline into multiple logical lines. Include
      // adjacent address words (not a distant column), even if AI omitted them.
      let added = true;
      while (added) {
        added = false;
        const selected = document.words.filter(word => ids.has(word.id));
        for (const word of document.words) if (!ids.has(word.id) && selected.some(other => {
          const a = word.bbox, b = other.bbox;
          const vertical = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
          const minHeight = Math.min(a.y1 - a.y0, b.y1 - b.y0);
          const gap = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
          return vertical / Math.max(1, minHeight) >= 0.65 && gap <= Math.max(12, minHeight * 1.5);
        })) { ids.add(word.id); added = true; }
      }
    }
    for (const line of document.lines) {
      const words = line.words.filter(word => ids.has(word.id));
      if (!words.length) continue;
      const box = { x0: Math.min(...words.map(w => w.bbox.x0)), y0: Math.min(...words.map(w => w.bbox.y0)), x1: Math.max(...words.map(w => w.bbox.x1)), y1: Math.max(...words.map(w => w.bbox.y1)) };
      const padding = Math.max(4, Math.ceil((box.y1 - box.y0) * 0.18));
      const x = Math.max(0, Math.floor(box.x0) - padding), y = Math.max(0, Math.floor(box.y0) - padding);
      const right = Math.min(document.width, Math.ceil(box.x1) + padding), bottom = Math.min(document.height, Math.ceil(box.y1) + padding);
      result.push({ category: suggestion.category, role: suggestion.role, source: suggestion.source, rect: [x, y, right - x, bottom - y], wordIds: words.map(w => w.id) });
    }
  }
  // AI can refine a local candidate, but must never erase a rule-based candidate.
  const unique = [];
  for (const field of result) {
    const previous = unique.find(f => f.category === field.category && (f.wordIds.some(id => field.wordIds.includes(id)) || (field.category === 'address' && f.role === field.role && (() => {
      const a = f.rect, b = field.rect;
      const vertical = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
      const gap = Math.max(0, Math.max(a[0], b[0]) - Math.min(a[0] + a[2], b[0] + b[2]));
      return vertical / Math.min(a[3], b[3]) >= 0.65 && gap <= 12;
    })())));
    if (!previous) { unique.push(field); continue; }
    const x = Math.min(previous.rect[0], field.rect[0]), y = Math.min(previous.rect[1], field.rect[1]);
    const right = Math.max(previous.rect[0] + previous.rect[2], field.rect[0] + field.rect[2]);
    const bottom = Math.max(previous.rect[1] + previous.rect[3], field.rect[1] + field.rect[3]);
    previous.rect = [x, y, right - x, bottom - y]; previous.wordIds = [...new Set([...previous.wordIds, ...field.wordIds])];
    if (previous.role === 'unknown' && field.role !== 'unknown') previous.role = field.role;
  }
  const counts = {};
  return unique.map((field, index) => {
    const label = `${roleNames[field.role] ? `${roleNames[field.role]} · ` : ''}${categoryNames[field.category]}`;
    counts[label] = (counts[label] || 0) + 1;
    return { ...field, id: `ocr-${index + 1}`, name: `${label} ${counts[label]}`, publicReason: field.source === 'local' ? 'Found locally in the text. Review this whole region for missed characters.' : 'AI classified this text; its position comes from local OCR. Review the coverage.', supportReason: ['order', 'tracking'].includes(field.category) ? 'Can help verified support locate the delivery. Confirm this is the number they need.' : 'Keep private for an initial delivery enquiry. Review this whole region.' };
  });
}
export function shouldHide(field, context) {
  return context === 'public' || !['order', 'tracking'].includes(field.category || field.id);
}
