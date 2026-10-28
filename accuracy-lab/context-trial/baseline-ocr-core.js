// Pure coordinate / policy helpers, shared by the browser and regression tests.
export { shouldHide } from '../../dist/sharing-context.js';
import { textCategories, categoryNames } from '../../dist/privacy-types.js';
export { textCategories, categoryNames };
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
function wordsInSpan(line, start, end) {
  let offset = 0;
  return line.words.filter(word => {
    const first = offset, last = first + word.text.length;
    offset = last + 1;
    return first < end && last > start;
  });
}
const identifierLabels = {
  transaction: /(?:transaction\s*(?:id|number|#)|交\s*易\s*(?:編\s*號|编\s*号|號\s*碼|号\s*码))\s*[:：#.]?/i,
  tracking: /(?:tracking(?:\s*(?:number|no\.?))?|waybill|trk\s*#|運\s*單\s*(?:號)?|运\s*单\s*(?:号)?|快\s*遞\s*單|快\s*递\s*单)\s*[:：#.]?/i,
  order: /(?:order\s*(?:number|no\.?|#)|訂\s*單\s*(?:號|编|編)?|订\s*单\s*(?:号|编)?)\s*[:：#.]?/i,
  reference: /(?:shipment\s*ref(?:erence)?|reference|ref\s*:)\s*[:：#.]?/i
};
function valueWords(line, category) {
  const original = line.words.map(word => word.text).join(' ');
  if (identifierLabels[category]) {
    const label = original.match(identifierLabels[category]);
    if (!label) return null;
    const tail = original.slice(label.index + label[0].length);
    const tokens = [...tail.matchAll(/\S+/g)];
    const accepted = [];
    for (const token of tokens) {
      const cleaned = token[0].replace(/^[#：:]+|[.,;：:]+$/g, '');
      if (!accepted.length && !cleaned && /^[#.:：]+$/.test(token[0])) continue;
      if (!/^(?=[A-Z0-9-]*\d)[A-Z0-9-]{2,}$/i.test(cleaned) || (/^\d+$/.test(cleaned) && cleaned.length < 3)) break;
      accepted.push(token);
      if (accepted.length === 6) break;
    }
    if (!accepted.length) return [];
    const start = label.index + label[0].length + accepted[0].index;
    const last = accepted.at(-1);
    return wordsInSpan(line, start, label.index + label[0].length + last.index + last[0].length);
  }
  if (category === 'phone') {
    const match = original.match(/\+?\d[\d() .-]{5,}\d/);
    return match ? wordsInSpan(line, match.index, match.index + match[0].length) : [];
  }
  if (category === 'payment') {
    const matches = [...original.matchAll(/\b\d{4}\b/g)];
    const last = matches.at(-1);
    return last ? wordsInSpan(line, last.index, last.index + last[0].length) : [];
  }
  return null;
}
export function localSuggestions(document) {
  const fields = [];
  const allText = document.lines.map(line => line.text).join('\n');
  const academicContext = /academic\s+transcript|grade\s+point\s+average|\b(?:course|credits|semester|gpa|student\s*(?:id|number)|grade)\b|成績單|成绩单|學號|学号|課程|课程|平均績點|平均绩点/i.test(allText);
  for (const line of document.lines) {
    const text = line.text.replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '');
    // Match labelled value spans before broad legacy line rules. One token may
    // contain several values; the first (private) category wins conservatively.
    const original = line.words.map(word => word.text).join(' ');
    const occupied = new Set();
    const spans = [];
    let offset = 0;
    for (const word of line.words) { spans.push({ word, start: offset, end: offset + word.text.length }); offset += word.text.length + 1; }
    const rules = [
      ['secret', /(?:password|access\s*code|door\s*code|api\s*key|auth\s*token|verification\s*code|密\s*碼|密\s*码|驗\s*證\s*碼|验\s*证\s*码)\s*[:：]\s*(\S+)/igu],
      ['student_id', /(?:student\s*(?:id|number|no\.?)|學\s*號|学\s*号)\s*[:：#]?\s*([A-Z0-9][A-Z0-9-]{4,})/igu],
      ['birth_date', /(?:date\s*of\s*birth|dob|出\s*生\s*日\s*期)\s*[:：]\s*([0-9][0-9/ .-]{5,20})/igu],
      ['name', /(?:student\s*name|name|姓\s*名)\s*[:：]\s*([\p{L}][\p{L} .'-]*?)(?=\s+(?:student\s*id|gpa|phone|email)\s*[:：]|$)/igu],
      ['private_message', /(?:private\s*note|private\s*message|私\s*人\s*訊\s*息|私\s*人\s*消\s*息)\s*[:：]\s*(.+)/igu],
      ['gpa', /(?:\bc?gpa\b|grade\s*point\s*average|平\s*均\s*績\s*點|平\s*均\s*绩\s*点)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?(?:\s*\/\s*[0-9]+(?:\.[0-9]+)?)?)/igu],
      ['grade', /(?:grade|成\s*績|成\s*绩)\s*[:：]\s*([A-F][+-]?|[0-9]{1,3}(?:\.[0-9]+)?)/igu],
      ['course', /\b([A-Z]{2,8}\s?[0-9]{3,5})\b/gu],
      ['university', /((?:[\p{L}][\p{L} &'’.-]{0,100}\s)?(?:university|college)(?:\s+of\s+[\p{L}][\p{L} &'’.-]{0,80})?|[\p{Script=Han}]{2,20}大學|[\p{Script=Han}]{2,20}大学)/igu]
    ];
    for (const [category, rule] of rules) for (const match of original.matchAll(rule)) {
      if (['course', 'university'].includes(category) && !academicContext) continue;
      if (category === 'university' && (/not\s+an?\s+official|fictional|demonstration/i.test(original) || /^(?:university|college)$/i.test(match[1].trim()))) continue;
      const start = match.index + match[0].lastIndexOf(match[1]), end = start + match[1].length;
      const words = spans.filter(span => span.start < end && span.end > start).map(span => span.word);
      if (!words.length || words.some(word => occupied.has(word.id))) continue;
      words.forEach(word => occupied.add(word.id));
      fields.push({ category, role: 'unknown', wordIds: words.map(word => word.id), source: 'local' });
    }
    let category;
    if (/transaction\s*(?:id|number|#)|交易(?:編號|编号|號碼|号码)/i.test(text)) category = 'transaction';
    else if (/\b(?:tracking|waybill|trk\s*#)|運單|运单|快遞單|快递单/i.test(text)) category = 'tracking';
    else if (/\border\s*(?:number|no\.?|#|:)|訂單(?:號|编|編)|订单(?:号|编)/i.test(text)) category = 'order';
    else if (/\b(?:reference|shipment\s*ref|ref\s*:)/i.test(text)) category = 'reference';
    else if (/[\w.+-]+\s*@\s*[\w.-]+\.[a-z]{2,}/i.test(text) || /\bemail\s*[:：]|電郵|电邮|郵箱|邮箱/i.test(text)) category = 'email';
    else if (/\b(?:tel|phone|mobile)\s*[.:：]|電話|电话|手機|手机/i.test(text) || /(?:\+\d[\d ()-]{6,}\d)/.test(text)) category = 'phone';
    else if (/(?:[*•·xX]{2,}|visa|mastercard|amex).{0,12}\d{4}\b/i.test(text)) category = 'payment';
    if (category) {
      const email = category === 'email' ? original.match(/[\w.+-]+\s*@\s*[\w.-]+\.[a-z]{2,}/i) : null;
      const candidates = email ? wordsInSpan(line, email.index, email.index + email[0].length) : valueWords(line, category) ?? line.words;
      const wordIds = candidates.filter(word => !occupied.has(word.id)).map(word => word.id);
      if (wordIds.length) fields.push({ category, role: 'unknown', wordIds, source: 'local' });
    }
  }
  // OCR may split a label and its value into separate columns on one baseline.
  // Link only a nearby value to its right, with a category-specific value shape.
  for (const label of document.lines) {
    const text = label.text.replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '').trim();
    const category = /^(?:student\s*name|name|姓名)\s*[:：]$/i.test(text) ? 'name'
      : /^(?:student\s*(?:id|number)|學號|学号)\s*[:：#]?$/i.test(text) ? 'student_id'
      : /^(?:date\s*of\s*birth|dob|出生日期)\s*[:：]$/i.test(text) ? 'birth_date'
      : /^(?:order\s*(?:details|number|no\.?)|訂單(?:號|編號)?|订单(?:号|编号)?)\s*[:：#.]?$/i.test(text) ? 'order'
      : /^(?:tracking(?:\s*number)?|waybill|運單號|运单号)\s*[:：#]?$/i.test(text) ? 'tracking' : null;
    if (!category || !label.words.length) continue;
    const right = Math.max(...label.words.map(word => word.bbox.x1));
    const top = Math.min(...label.words.map(word => word.bbox.y0)), bottom = Math.max(...label.words.map(word => word.bbox.y1));
    const candidates = document.lines.filter(line => line !== label && line.words.length).map(line => ({ line, left: Math.min(...line.words.map(word => word.bbox.x0)), top: Math.min(...line.words.map(word => word.bbox.y0)), bottom: Math.max(...line.words.map(word => word.bbox.y1)) }))
      .filter(value => value.left >= right && value.left - right <= document.width * (['order', 'tracking'].includes(category) ? 0.5 : 0.3) && Math.max(0, Math.min(bottom, value.bottom) - Math.max(top, value.top)) / Math.max(1, Math.min(bottom - top, value.bottom - value.top)) >= 0.65).sort((a, b) => a.left - b.left);
    const value = candidates[0]?.line;
    if (!value || fields.some(field => field.wordIds.some(id => value.words.some(word => word.id === id)))) continue;
    const valid = category === 'student_id' ? /^[A-Z0-9][A-Z0-9 -]{4,}$/i.test(value.text) : ['order', 'tracking'].includes(category) ? /^#?[A-Z0-9][A-Z0-9-]{5,}$/i.test(value.text) : category === 'birth_date' ? /^\d[\d/ .-]{5,20}$/.test(value.text) : /^[\p{L}][\p{L} .'-]{1,100}$/u.test(value.text) && !/\b(?:grade|course|gpa|semester|university)\b/i.test(value.text);
    if (valid) fields.push({ category, role: 'unknown', wordIds: value.words.map(word => word.id), source: 'local' });
  }
  // Link every occurrence of a locally identified number, not just its labelled line.
  const numbered = fields.filter(f => ['order', 'tracking', 'transaction', 'reference'].includes(f.category));
  for (const field of numbered) {
    const selected = document.words.filter(w => field.wordIds.includes(w.id));
    const candidates = [...selected.map(w => normalized(w.text)), normalized(selected.map(w => w.text).join(''))].filter(value => value.length >= 8 && /\d/.test(value));
    for (const line of document.lines) {
      for (const value of candidates) {
        let matched = null;
        for (let start = 0; start < line.words.length && !matched; start++) {
          let joined = '';
          for (let end = start; end < line.words.length && joined.length <= value.length; end++) {
            joined += normalized(line.words[end].text);
            if (joined === value) { matched = line.words.slice(start, end + 1); break; }
            if (!value.startsWith(joined)) break;
          }
        }
        if (matched && !fields.some(f => f.category === field.category && matched.some(word => f.wordIds.includes(word.id)))) {
          fields.push({ category: field.category, role: 'unknown', wordIds: matched.map(word => word.id), source: 'local' });
        }
      }
    }
  }
  return fields;
}
export function validateClassifications(fields, document) {
  if (!Array.isArray(fields) || fields.length > 150) throw new Error('Invalid text classifications. Existing masks retained.');
  const known = new Set(document.words.map(word => word.id));
  return fields.map(field => {
    if (!textCategories.includes(field?.category) || !Object.hasOwn(roleNames, field.role) || !Array.isArray(field.wordIds) || !field.wordIds.length || field.wordIds.length > 200 || field.box !== undefined) throw new Error('Invalid text classification. Existing masks retained.');
    for (const id of field.wordIds) {
      if (!known.has(id)) throw new Error('AI could not match some text to this image. Existing masks are unchanged.');
    }
    return { category: field.category, role: field.role, wordIds: [...new Set(field.wordIds)], source: 'ai' };
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
      let words = line.words.filter(word => ids.has(word.id));
      const precise = valueWords(line, suggestion.category);
      if (precise?.some(word => ids.has(word.id))) words = precise.filter(word => ids.has(word.id));
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
    return { ...field, id: `ocr-${index + 1}`, name: `${label} ${counts[label]}`, anchor: document.words.filter(word => field.wordIds.includes(word.id)).map(word => word.text).join(' ') };
  });
}
