// Only match within the same image. IDs and raw ordinal positions are never identity evidence.
const normalized = value => (value || '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase();
function fieldText(field) {
  const text = normalized(field.anchor);
  const labels = {
    email: /^(?:e-?mail|電郵|电邮|郵箱|邮箱)[:：]/,
    phone: /^(?:phone|tel|mobile|電話|电话|手機|手机)[:：]/,
    gpa: /^(?:c?gpa|gradepointaverage|平均績點|平均绩点)[:：]/,
    course: /^(?:course|課程|课程)[:：]/,
    grade: /^(?:grade|成績|成绩)[:：]/,
    name: /^(?:studentname|name|姓名)[:：]/,
    student_id: /^(?:studentid|studentnumber|學號|学号)[:：#]/,
    birth_date: /^(?:dateofbirth|dob|出生日期)[:：]/
  };
  return labels[field.category || field.id] ? text.replace(labels[field.category || field.id], '') : text;
}
const sameRegion = (a, b) => {
  const intersect = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const smaller = Math.min(a[2] * a[3], b[2] * b[3]), larger = Math.max(a[2] * a[3], b[2] * b[3]);
  return intersect / Math.max(1, larger + smaller - intersect) >= 0.55 || (intersect / Math.max(1, smaller) >= 0.85 && larger / Math.max(1, smaller) <= 10);
};
export function reconcileFields(previous, incoming) {
  const matches = incoming.map(field => previous.filter(old => (old.category || old.id) === field.category && fieldText(old) && fieldText(old) === fieldText(field) && sameRegion(old.rect, field.rect)));
  const used = new Set(); let restored = 0;
  const fields = incoming.map((field, i) => {
    const old = matches[i].length === 1 ? matches[i][0] : null;
    const unique = old && matches.filter(list => list.includes(old)).length === 1;
    if (!unique) return { ...field, userOverride: null };
    used.add(old);
    if (old.userOverride) restored++;
    // Retain all already-covered pixels when a matched detector box shrinks.
    const x = Math.min(old.rect[0], field.rect[0]), y = Math.min(old.rect[1], field.rect[1]);
    const rect = [x, y, Math.max(old.rect[0] + old.rect[2], field.rect[0] + field.rect[2]) - x, Math.max(old.rect[1] + old.rect[3], field.rect[1] + field.rect[3]) - y];
    return { ...field, id: old.id, rect, userOverride: old.userOverride || null, pendingReveal: old.pendingReveal || false };
  });
  const retained = previous.filter(field => !used.has(field) && (field.hidden || field.userOverride));
  fields.push(...retained.map(field => ({ ...field, retained: true })));
  return { fields, restored, retained: retained.length };
}

// Describe only AI regions that can be mapped unambiguously to a review row.
function overlaps(a, b) {
  if (a.wordIds?.some(id => b.wordIds?.includes(id))) return true;
  if (!a.rect || !b.rect) return false;
  const intersection = Math.max(0, Math.min(a.rect[0] + a.rect[2], b.rect[0] + b.rect[2]) - Math.max(a.rect[0], b.rect[0])) * Math.max(0, Math.min(a.rect[1] + a.rect[3], b.rect[1] + b.rect[3]) - Math.max(a.rect[1], b.rect[1]));
  return intersection / Math.max(1, Math.min(a.rect[2] * a.rect[3], b.rect[2] * b.rect[3])) >= 0.6;
}
export function aiInsights(previous, aiFields, current) {
  const items = [], used = new Set();
  for (const candidate of aiFields) {
    const matches = current.filter(field => field.category === candidate.category && overlaps(field, candidate));
    if (matches.length !== 1 || used.has(matches[0].id)) continue;
    const match = matches[0]; used.add(match.id);
    const earlier = previous.filter(field => overlaps(field, candidate));
    items.push({ id: match.id, name: match.name, kind: earlier.length ? (earlier.some(field => field.category === candidate.category) ? 'existing' : 'reclassified') : 'new' });
  }
  return items;
}

// The same active rectangles drive both the preview and the flattened export.
export function activeMasks(fields, manual) {
  return [
    ...fields.filter(field => field.hidden).map(field => ({ key: `field-${field.id}`, rect: field.rect })),
    ...manual.filter(mask => mask.hidden !== false).map(mask => ({ key: `manual-${mask.id}`, rect: mask.rect }))
  ];
}
export function coverageSummary(fields, manual) {
  const hidden = fields.filter(field => field.hidden).length;
  return { detected: fields.length, hidden, markedVisible: fields.length - hidden, manual: manual.filter(mask => mask.hidden !== false).length, needsReview: fields.filter(field => (field.recommendation?.action === 'review' || field.pendingReveal) && !field.userOverride).length, masks: activeMasks(fields, manual).length };
}
