// Local-only screening. Detection views are normalized; original OCR stays local.
const spaced = value => [...value].join(String.raw`\s*`);
const pair = (a, b) => `${spaced(a)}[\\s_-]*${spaced(b)}`;
const strongLabels = [
  pair('api','key'), pair('access','token'), pair('refresh','token'), pair('auth','token'), pair('session','token'), pair('client','secret'), ...['password','passwd','pwd'].map(spaced), pair('secret','key'), pair('private','key'), pair('database','url'), pair('connection','string'), spaced('dsn'), pair('access','code'), pair('door','code'), pair('verification','code'), String.raw`密\s*[碼码]|驗\s*證\s*碼|验\s*证\s*码`
].join('|');
const labelSource = `(?:${strongLabels}|${['token','secret','authorization','cookie'].map(spaced).join('|')}|${pair('proxy','authorization')}|${pair('set','cookie')})`;
const prefix = String.raw`(?:[a-z][a-z0-9]*\s*[_-]\s*)*`;
const labels = () => new RegExp(String.raw`(?<![a-z0-9_])${prefix}${labelSource}["']?\s*[:=]\s*`, 'giu');
const risks = () => new RegExp(String.raw`(?<![a-z0-9_])${prefix}(?:${strongLabels})(?![a-z0-9_])`, 'giu');
const placeholder = /^\[SECRET_[A-Z_]*\d+\]$/;
const normalized = text => text.normalize('NFKC').replace(/[\u2010-\u2015\u2212\uFE63]/g, '-').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
function rowView(line) {
  let offset = 0;
  const spans = line.words.map(word => {
    const text = normalized(word.text), span = { word, text, start: offset, end: offset + text.length };
    offset = span.end + 1; return span;
  });
  return { line, text: spans.map(s => s.text).join(' '), spans };
}
function inSpan(row, start, end) { return row.spans.filter(s => s.start < end && s.end > start).map(s => s.word.id); }
function compactView(row) {
  let text = ''; const ids = [];
  for (const span of row.spans) for (const char of span.text) if (!/\s/.test(char)) {
    text += char; for (let i = 0; i < char.length; i++) ids.push(span.word.id);
  }
  return { text, ids };
}
function clearBoundary(row) {
  return !row || !row.text.trim() || /^(?:[\w ._-]+:\s|\s*at\s|Traceback\b|(?:Node\.js|Python|Java version)\s|(?:PUBLIC_|const |let |var ))/i.test(row.text) || labels().test(row.text);
}
function nextIsContinuation(row, ambiguous = false) {
  if (clearBoundary(row)) return false;
  return ambiguous || /^(?:[A-Za-z0-9+/_=.@:-]{12,}\s*){1,6}["'`\\,;]?\s*$/.test(row.text) && !/[=:](?![=\s]*$)/.test(row.text);
}
function closingQuote(text, quote, start) {
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    if (escaped) escaped = false;
    else if (text[i] === '\\') escaped = true;
    else if (text[i] === quote) return i;
  }
  return -1;
}

export function credentialFindings(lines) {
  const rows = lines.map(rowView), findings = [], seeds = new Set();
  const add = (wordIds, kind = 'TOKEN') => {
    const ids = [...new Set(wordIds)];
    if (ids.length && !findings.some(f => f.wordIds.length === ids.length && f.wordIds.every(id => ids.includes(id)))) findings.push({ category: 'secret', role: 'unknown', source: 'local', kind, wordIds: ids });
  };
  const seedValue = value => {
    if (/\[SECRET_/.test(value)) return;
    const seed = value.replace(/^(?:Bearer|Basic)\s+/i, '').replace(/\s/g, '');
    if (seed.length >= 4 && !/^(?:Bearer|Basic)$/i.test(seed)) seeds.add(seed);
    // Also catch duplicated fragments after OCR splits or escaped punctuation.
    for (const piece of value.match(/[a-z0-9_+/.=-]{8,}/gi) || []) seeds.add(piece);
  };
  let pem = false;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], text = row.text, consumed = [];
    if (/-----\s*BEGIN\s+(?:[A-Z]+\s+)*PRIVATE\s+KEY\s*-----/i.test(text)) pem = true;
    if (pem) { add(row.line.words.map(w => w.id), 'PRIVATE_KEY'); if (/-----\s*END\s+(?:[A-Z]+\s+)*PRIVATE\s+KEY\s*-----/i.test(text)) pem = false; continue; }
    const matches = [...text.matchAll(labels())];
    for (let m = 0; m < matches.length; m++) {
      const match = matches[m];
      if (consumed.some(([start,end]) => match.index >= start && match.index < end)) continue;
      const start = match.index + match[0].length, tail = text.slice(start);
      const quote = tail.match(/^\s*(["'`])/);
      const close = quote ? closingQuote(text, quote[1], start + quote[0].length) : -1;
      let end = quote ? (close < 0 ? text.length : close + 1) : matches[m + 1]?.index ?? text.length;
      if (!quote && !/cookie/i.test(match[0].replace(/\s/g, ''))) {
        const stop = text.slice(start,end).search(/;|\s+(?:#|\/\/)\s/); if (stop >= 0) end = start + stop;
      }
      consumed.push([match.index,end]);
      const value = text.slice(start,end).trim().replace(/^["'`]|["'`,;\\]+$/g, '').trim();
      if (placeholder.test(value)) continue;
      const kind = /password|passwd|pwd|密/.test(match[0].replace(/\s/g,'').toLowerCase()) ? 'PASSWORD' : /authorization/i.test(match[0].replace(/\s/g,'')) ? 'AUTH' : 'TOKEN';
      add(inSpan(row,start,end),kind); seedValue(value);
      const ambiguous = !value || /^(?:Bearer|Basic)$/i.test(value) || !!quote && close < 0;
      if (ambiguous || /\\\s*$/.test(tail) || nextIsContinuation(rows[index+1])) {
        let combined = value.replace(/\s/g,'');
        for (let j = index+1; j < rows.length && nextIsContinuation(rows[j],ambiguous); j++) {
          // No reliable character boundary: screen the whole relevant OCR region.
          add(rows[j].line.words.map(w => w.id),kind); seedValue(rows[j].text);
          combined += rows[j].text.replace(/[\s"'`,;\\]/g,'');
          if (quote && closingQuote(rows[j].text,quote[1],0) >= 0) break;
        }
        seedValue(combined);
      }
    }
    // Fail closed on recognisable credential labels without parseable assignment
    // syntax (e.g. OCR dropped '='). Generic discussion of 'token' is excluded.
    for (const match of text.matchAll(risks())) {
      if (consumed.some(([start,end]) => match.index >= start && match.index < end)) continue;
      add(inSpan(row,match.index,text.length),'UNPARSED'); seedValue(text.slice(match.index+match[0].length));
      if (!text.slice(match.index+match[0].length).trim()) {
        for (let j=index+1;j<rows.length&&nextIsContinuation(rows[j],true);j++) { add(rows[j].line.words.map(w=>w.id),'UNPARSED'); seedValue(rows[j].text); }
      }
    }
    // Authentication scheme names are case insensitive, including standalone use.
    for (const match of text.matchAll(/\b(?:Bearer|Basic)\s+([^\s;"'`]+(?:\s+[A-Za-z0-9+/_=.-]{6,})*)/gi)) {
      const start = match.index + match[0].indexOf(match[1]);
      if (!placeholder.test(match[1])) { add(inSpan(row,start,start+match[1].length),'AUTH'); seedValue(match[1]); }
    }
    for (const match of text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s@]+@[^\s"'<>]+/gi)) {
      add(inSpan(row,match.index,match.index+match[0].length),'CONNECTION');
      seedValue(match[0].match(/:\/\/[^:]+:([^@]+)@/)?.[1] || '');
    }
    const compact = compactView(row);
    // Do not require a boundary in a view that removes OCR word separators:
    // 'echo sk-proj-...' becomes 'echosk-proj-...'. IDs still map to original words.
    for (const match of compact.text.matchAll(/(?:sk[-_](?:proj[-_])?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})/gi)) {
      add(compact.ids.slice(match.index,match.index+match[0].length)); seedValue(match[0]);
    }
    if (/[a-z][a-z0-9+.-]*\s*:\s*\/\s*\//i.test(text)) {
      for (const match of compact.text.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^/@]+:[^@]+@[^"'<>]+/gi)) {
        add(compact.ids.slice(match.index,match.index+match[0].length),'CONNECTION');
        seedValue(match[0].match(/:\/\/[^:]+:([^@]+)@/)?.[1] || '');
      }
    }
  }
  for (const row of rows) {
    const compact = compactView(row);
    for (const seed of seeds) {
      let start = compact.text.indexOf(seed);
      while (start >= 0) { add(compact.ids.slice(start,start+seed.length)); start = compact.text.indexOf(seed,start+1); }
    }
  }
  return findings;
}

export function sanitizeOCRLines(lines) {
  const findings = credentialFindings(lines), replacements = new Map();
  let next = 1;
  for (const finding of findings) {
    const tag = `[SECRET_${finding.kind}${next++}]`;
    for (const id of finding.wordIds) if (!replacements.has(id)) replacements.set(id, tag);
  }
  return {
    // Whitelist the wire representation: never copy raw line.text, alternative
    // transcripts or arbitrary properties from an OCR result into a request.
    lines: lines.map(line => ({ id: line.id, words: line.words.map(word => ({ id: word.id, text: replacements.get(word.id) || word.text, ...(word.box ? { box: [...word.box] } : {}) })) })),
    screenedWords: replacements.size
  };
}

export function technicalSuggestions(document) {
  const findings = credentialFindings(document.lines);
  for (const line of document.lines) {
    const row = rowView(line);
    const addMatches = (category, regex) => { for (const match of row.text.matchAll(regex)) findings.push({ category, role: 'unknown', source: 'local', wordIds: inSpan(row, match.index, match.index + match[0].length) }); };
    addMatches('personal_path', /(?:\/(?:Users|home)\/[^\s/]+(?:\/[^\s"'<>)]*)?|[A-Z]:\\Users\\[^\s\\]+(?:\\[^\s"'<>)]*)?)/gi);
    addMatches('internal_endpoint', /\b(?:[a-z0-9_-]+\s*\.\s*)+(?:local|internal|corp|lan)\b|\b(?:internal|intranet)\.[a-z0-9_.-]+|\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/gi);
    addMatches('account', /^(?:username|login[\s_-]*user)\s*[:=]\s*[A-Za-z0-9_.@-]+/gi);
  }
  return findings;
}
