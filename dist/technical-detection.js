// Local-only screening. Never log values; callers retain the original OCR document.
const labelSource = String.raw`(?:api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|auth[\s_-]*token|session[\s_-]*token|client[\s_-]*secret|password|passwd|pwd|(?:secret|private)[\s_-]*key|token|secret|authorization|proxy[\s_-]*authorization|cookie|set[\s_-]*cookie|database[\s_-]*url|connection[\s_-]*string|dsn|access[\s_-]*code|door[\s_-]*code|verification[\s_-]*code|密\s*[碼码]|驗\s*證\s*碼|验\s*证\s*码)`;
const labels = () => new RegExp(String.raw`\b${labelSource}["']?\s*[:=]\s*|(?:密\s*[碼码]|驗\s*證\s*碼|验\s*证\s*码)\s*[:：=]\s*`, 'giu');
const placeholder = /^\[SECRET_[A-Z_]*\d+\]$/;
function rowView(line) {
  let offset = 0;
  const spans = line.words.map(word => { const span = { word, start: offset, end: offset + word.text.length }; offset = span.end + 1; return span; });
  return { line, text: line.words.map(word => word.text).join(' '), spans };
}
function inSpan(row, start, end) { return row.spans.filter(s => s.start < end && s.end > start).map(s => s.word.id); }
function compactView(row) {
  let text = ''; const ids = [];
  for (const { word } of row.spans) for (const char of word.text) if (!/\s/.test(char)) { text += char; ids.push(word.id); }
  return { text, ids };
}
function nextIsContinuation(row, allowShort = false) {
  const shape = allowShort ? /^(?:[A-Za-z0-9+/_=.@:-]+\s*){1,6}["'`\\,;]?\s*$/ : /^(?:[A-Za-z0-9+/_=.@:-]{12,}\s*){1,6}["'`\\,;]?\s*$/;
  return row && shape.test(row.text) && !/[=:](?![=\s]*$)/.test(row.text);
}

export function credentialFindings(lines) {
  const rows = lines.map(rowView), findings = [], seeds = new Set();
  const add = (wordIds, kind = 'TOKEN') => {
    const ids = [...new Set(wordIds)];
    if (ids.length && !findings.some(f => f.wordIds.length === ids.length && f.wordIds.every(id => ids.includes(id)))) findings.push({ category: 'secret', role: 'unknown', source: 'local', kind, wordIds: ids });
  };
  let pem = false;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], text = row.text;
    if (/-----\s*BEGIN\s+(?:[A-Z]+\s+)*PRIVATE\s+KEY\s*-----/i.test(text)) pem = true;
    if (pem) { add(row.line.words.map(w => w.id), 'PRIVATE_KEY'); if (/-----\s*END\s+(?:[A-Z]+\s+)*PRIVATE\s+KEY\s*-----/i.test(text)) pem = false; continue; }
    const matches = [...text.matchAll(labels())];
    for (let m = 0; m < matches.length; m++) {
      const match = matches[m], start = match.index + match[0].length;
      let end = matches[m + 1]?.index ?? text.length;
      const tail = text.slice(start, end);
      // A quoted password can contain spaces. An unclosed quote is conservatively
      // screened to the end of the row, plus plausible wrapped continuation rows.
      const quote = tail.match(/^\s*(["'`])/);
      const close = quote ? text.indexOf(quote[1], start + quote[0].length) : -1;
      if (close >= 0 && close < end) end = close + 1;
      else if (!quote && !/cookie/i.test(match[0])) { const stop = tail.search(/;|\s+(?:#|\/\/)\s/); if (stop >= 0) end = start + stop; }
      const value = text.slice(start, end).trim().replace(/^["'`]|["'`,;\\]+$/g, '').trim();
      if (placeholder.test(value)) continue;
      const kind = /password|passwd|pwd|密/.test(match[0].toLowerCase()) ? 'PASSWORD' : /authorization/i.test(match[0]) ? 'AUTH' : 'TOKEN';
      add(inSpan(row, start, end), kind);
      const seed = value.replace(/^(?:Bearer|Basic)\s+/i, '').replace(/\s/g, '');
      if (seed.length >= 4 && !/^(?:Bearer|Basic)$/i.test(seed)) seeds.add(seed);
      // Missing/line-wrapped values: hide whole candidate OCR words rather than
      // inventing character coordinates. Never cross a labelled diagnostic line.
      if (!value || /^(?:Bearer|Basic)$/i.test(value) || /\\\s*$/.test(tail) || close < 0 && quote || nextIsContinuation(rows[index + 1])) {
        let combined = seed;
        for (let j = index + 1; j < Math.min(rows.length, index + 5) && nextIsContinuation(rows[j], !value || /^(?:Bearer|Basic)$/i.test(value)); j++) {
          add(rows[j].line.words.map(w => w.id), kind);
          const piece = rows[j].text.replace(/[\s"'`,;\\]/g, ''); combined += piece;
          if (piece.length >= 4) seeds.add(piece);
        }
        if (combined.length >= 4) seeds.add(combined);
      }
    }
    // Bearer/Basic headers also occur without an Authorization label.
    for (const match of text.matchAll(/\b(?:Bearer|Basic)\s+([A-Za-z0-9+/_=.-]{6,}(?:\s+[A-Za-z0-9+/_=.-]{6,})*)/g)) {
      const start = match.index + match[0].indexOf(match[1]);
      add(inSpan(row, start, start + match[1].length), 'AUTH'); seeds.add(match[1].replace(/\s/g, ''));
    }
    // Connection strings with userinfo are screened as whole OCR regions.
    for (const match of text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s@]+@[^\s"'<>]+/gi)) {
      add(inSpan(row, match.index, match.index + match[0].length), 'CONNECTION');
      const password = match[0].match(/:\/\/[^:]+:([^@]+)@/)?.[1]; if (password?.length >= 4) seeds.add(password);
    }
    const compact = compactView(row);
    // OCR can insert spaces around URL punctuation or inside provider prefixes.
    for (const match of compact.text.matchAll(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g)) {
      add(compact.ids.slice(match.index, match.index + match[0].length)); seeds.add(match[0]);
    }
    if (/[a-z][a-z0-9+.-]*\s*:\s*\/\s*\//i.test(text)) {
      for (const match of compact.text.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^/@]+:[^@]+@[^"'<>]+/gi)) {
        add(compact.ids.slice(match.index, match.index + match[0].length), 'CONNECTION');
        const password = match[0].match(/:\/\/[^:]+:([^@]+)@/)?.[1]; if (password?.length >= 4) seeds.add(password);
      }
    }
  }
  // Repeated values may lack a label, or be split differently by OCR. The compact
  // character map locates every occurrence without changing original IDs/boxes.
  for (const row of rows) {
    const compact = compactView(row);
    for (const seed of seeds) {
      let start = compact.text.indexOf(seed);
      while (start >= 0) { add(compact.ids.slice(start, start + seed.length)); start = compact.text.indexOf(seed, start + 1); }
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
