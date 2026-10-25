export function maskTargetAtPoint([x, y], fields, manual) {
  const contains = ({ rect: [left, top, width, height] }) => x >= left && x < left + width && y >= top && y < top + height;
  // Prefer a visible mask in paint order; otherwise restore the region under the pointer.
  for (const hidden of [true, false]) {
    const mask = manual.findLast(mask => (mask.hidden !== false) === hidden && contains(mask));
    if (mask) return { mask, hidden, name: `Manual mask ${mask.id}` };
    const field = fields.findLast(field => Boolean(field.hidden) === hidden && contains(field));
    if (field) return { mask: field, hidden, name: field.name };
  }
  return null;
}
