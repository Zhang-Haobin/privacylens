// Identify compact delivery contact blocks from labels and nearby OCR lines.
// Each line remains an independently editable mask; no image or OCR box is invented.
const marker = /^\s*(?:(ship\s*from|sender|寄\s*件\s*人)|(ship\s*to|deliver\s*to|delivery\s*address|shipping\s*address|billing\s*address|收\s*貨\s*地\s*址|收\s*货\s*地\s*址|收\s*件\s*人|地\s*址)|(from|to))(?=\s|[:：]|$)\s*[:：]?\s*/iu;
const delivery = /\b(?:tracking|waybill|shipment|ship(?:ping)?|deliver(?:ed|y)?|parcel|order)\b|訂\s*單|订\s*单|運\s*單|运\s*单|快\s*遞|快\s*递|收\s*貨|收\s*货/iu;
const addressEvidence = /\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|blvd|boulevard|plaza|building|tower|room|flat|apt|apartment|suite|unit|floor|block|campus)\b|\b\d+\s+[\p{L}]{2,}|(?:街|道|路|樓|楼|室|巷|區|区)/iu;
const stop = /^(?:order|tracking|waybill|shipment|payment|paid|item(?:s)?|description|product|quantity|qty|weight|total|subtotal|date|service|status|estimated\s+delivery|merchant|merchandise|billing|shipping|address\s+type|訂\s*單|订\s*单|商\s*品|物\s*品|付款|總\s*額|总\s*额)\b/iu;
const contact = /^(?:(?:tel|phone|mobile|email|e-mail)\b|[+＋]\s*\d)|@|^(?:電\s*話|电\s*话|手\s*機|手\s*机|電\s*郵|电\s*邮)\s*[:：]/iu;
const notName = /\b(?:address|shipping|billing|payment|order|delivery|recipient|sender|university|college|company|supplies|limited|support|service|customer|method|street|road|building|tower|apartment|suite|district|country|city|united|hong|kong)\b/iu;
const box = words => ({ left:Math.min(...words.map(w=>w.bbox.x0)), top:Math.min(...words.map(w=>w.bbox.y0)), right:Math.max(...words.map(w=>w.bbox.x1)), bottom:Math.max(...words.map(w=>w.bbox.y1)) });
const normalize = text => text.replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '').trim();
const textOf = words => normalize(words.map(w=>w.text).join(' '));
function wordsAfter(line, offset) {
  let position = 0;
  return line.words.filter(word => { const start = position; position += word.text.length + 1; return position - 1 > offset && /[\p{L}\p{N}]/u.test(word.text) && start >= offset; });
}
function isName(words) {
  const text = textOf(words).replace(/^[\s:：]+|[\s:：]+$/g, '');
  if (!text || text.length > 75 || notName.test(text) || /\d|@/.test(text)) return false;
  if (/^[\p{Script=Han}]{2,5}$/u.test(text)) return true;
  return /^[\p{L}\p{M}][\p{L}\p{M}.'’\-]*(?:\s+[\p{L}\p{M}][\p{L}\p{M}.'’\-]*){1,4}$/u.test(text);
}

export function contextualDeliverySuggestions(document, existing = []) {
  const lineData = document.lines.filter(line => line.words.length).map(line => ({ line, ...box(line.words) }));
  const hasDelivery = delivery.test(document.lines.map(line=>line.text).join('\n'));
  const headers = lineData.map(entry => {
    const match = entry.line.text.match(marker);
    if (!match || (match[3] && !hasDelivery) || (/^地\s*址/u.test(match[0]) && !hasDelivery)) return null;
    return { ...entry, match, role:match[1] || /^from/i.test(match[3] || '') ? 'sender' : 'recipient' };
  }).filter(Boolean);
  const suggestions = [], used = new Set(existing.flatMap(field => field.wordIds));
  function add(category, role, words) {
    const fresh = words.filter(word => !used.has(word.id));
    if (!fresh.length) return;
    fresh.forEach(word=>used.add(word.id));
    suggestions.push({ category, role, wordIds:fresh.map(word=>word.id), source:'local', lineBounded:true });
  }
  for (const header of headers) {
    const height = Math.max(10, header.bottom - header.top);
    const after = wordsAfter(header.line, header.match[0].length);
    let nameWords = isName(after) ? after : null;
    let anchor = nameWords ? box(nameWords) : null;
    const labelIsExplicitPerson = /(?:收\s*件\s*人|寄\s*件\s*人|recipient|sender)/iu.test(header.match[0]);
    const nearby = lineData.filter(entry => entry.line !== header.line && entry.top >= header.top - height * .6 && entry.top <= header.bottom + Math.max(35, height * 2.5))
      .filter(entry => entry.left >= header.left - height && entry.left <= header.right + Math.max(80, document.width * .32))
      .sort((a,b)=>a.top-b.top || a.left-b.left);
    if (!nameWords) {
      const name = nearby.find(entry => isName(entry.line.words) && !marker.test(entry.line.text) && !stop.test(entry.line.text));
      if (name) { nameWords = name.line.words; anchor = box(nameWords); }
    }
    // An explicit Chinese address label can carry its value on the same line.
    const inlineAddress = after.length && !nameWords && addressEvidence.test(textOf(after)) ? after : null;
    const base = anchor || (inlineAddress ? box(inlineAddress) : header);
    const maxLeft = base.left + Math.max(28, height * 2.4);
    const nextHeader = headers.filter(other => other !== header && other.top > header.top + height * .65 && other.left <= maxLeft).reduce((y, other) => Math.min(y, other.top), Infinity);
    let lastBottom = base.bottom;
    const body = [];
    const later = lineData.filter(entry => entry.line !== header.line && (!nameWords || !entry.line.words.some(word => nameWords.includes(word))) && entry.top >= base.top + Math.min(7, height * .35) && entry.top < nextHeader - Math.max(4, height * .5) && entry.left >= base.left - Math.max(18, height * 1.2) && entry.left <= maxLeft && entry.right <= base.left + document.width * .68).sort((a,b)=>a.top-b.top || a.left-b.left);
    for (const entry of later) {
      if (entry.top - lastBottom > Math.max(40, height * 2.2) || body.length >= 8) break;
      const text = normalize(entry.line.text);
      if (marker.test(text) || stop.test(text)) break;
      if (contact.test(text) || existing.some(field => ['phone','email'].includes(field.category) && entry.line.words.some(word => field.wordIds.includes(word.id)))) {
        if (body.some(words => addressEvidence.test(textOf(words)))) break;
        lastBottom = Math.max(lastBottom, entry.bottom); continue;
      }
      if (!/[\p{L}\p{N}]{3}/u.test(text.replace(/\s/g, ''))) continue;
      // Ignore duplicate OCR words on the name baseline, but allow multiple
      // fragments of an address row to remain separate.
      if (nameWords && entry.top < base.bottom - height * .35 && entry.bottom <= base.bottom + height * .5) continue;
      body.push(entry.line.words); lastBottom = Math.max(lastBottom, entry.bottom);
    }
    const addressRows = [...(inlineAddress ? [inlineAddress] : []), ...body];
    const evidence = addressRows.some(words => addressEvidence.test(textOf(words)));
    if (nameWords && (evidence || labelIsExplicitPerson)) add('name', header.role, nameWords);
    if (evidence) for (const words of addressRows) add('address', header.role, words);
  }
  return suggestions;
}
