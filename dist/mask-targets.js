export function ocrWordRegion(words, width, height) {
  const boxes = words.map(word => word.bbox);
  const left = Math.min(...boxes.map(box => box.x0)), top = Math.min(...boxes.map(box => box.y0));
  const right = Math.max(...boxes.map(box => box.x1)), bottom = Math.max(...boxes.map(box => box.y1));
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
  const padding = Math.max(4, Math.ceil((bottom - top) * 0.18));
  const x = Math.max(0, Math.floor(left) - padding), y = Math.max(0, Math.floor(top) - padding);
  const w = Math.min(width, Math.ceil(right) + padding) - x, h = Math.min(height, Math.ceil(bottom) + padding) - y;
  return w > 0 && h > 0 ? [x, y, w, h] : null;
}

export function textLineTargets(document) {
  if (!document) return [];
  return document.lines.map(line => ({ ...line, rect: ocrWordRegion(line.words, document.width, document.height) }))
    .filter(line => line.rect).map(({ text, rect }, index) => {
      return { key: `${rect.join(',')}:${text}`, name: `Text line ${index + 1}`, text, rect };
  });
}
export function maskTargetAtPoint([x, y], fields, manual, textLines = []) {
  const contains = ({ rect: [left, top, width, height] }) => x >= left && x < left + width && y >= top && y < top + height;
  // Prefer a visible mask in paint order; otherwise restore the region under the pointer.
  for (const hidden of [true, false]) {
    const mask = manual.findLast(mask => (mask.hidden !== false) === hidden && contains(mask));
    if (mask) return { mask, hidden, name: mask.name || `Manual mask ${mask.id}` };
    const field = fields.findLast(field => Boolean(field.hidden) === hidden && contains(field));
    if (field) return { mask: field, hidden, name: field.name };
    if (hidden) {
      const line = textLines.find(contains);
      if (line) return { line, hidden: false, name: line.name };
    }
  }
  return null;
}
